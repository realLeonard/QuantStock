"""复盘回填 — v3 持仓跟踪（5天）

改造点：
  1. 单日回填（次日涨跌幅）保持不变
  2. 新增持仓跟踪：查过去5个交易日的 strong_buy/buy 推荐，
     计算推荐日至今的累计涨跌幅，标注状态（持有中/止损/超期）
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client

_BJ_TZ = timezone(timedelta(hours=8))

# 止损阈值（%）
STOP_LOSS_PCT = -3.0
# 持有上限（交易日）
MAX_HOLD_DAYS = 5


def get_today_bj() -> str:
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def backfill_yesterday(sb=None) -> dict:
    """
    回填昨日预测结果（次日涨跌幅）。

    返回: {
      'yesterday': str,
      'total': int,
      'hit': int,
      'hit_rate': float,
      'details': list[dict],
    }
    """
    if sb is None:
        sb = get_supabase_client()

    today = get_today_bj()

    # 查找最近有评分数据的日期（作为"昨日"）
    resp = (
        sb.table('sector_scores')
        .select('trade_date')
        .lt('trade_date', today)
        .order('trade_date', desc=True)
        .limit(1)
        .execute()
    )

    if not resp.data:
        print('[backfill] 无历史评分数据，跳过回填')
        return {'yesterday': '', 'total': 0, 'hit': 0, 'hit_rate': 0, 'details': []}

    yesterday = resp.data[0]['trade_date']
    print(f'[backfill] 回填 {yesterday} 的预测结果（用 {today} 实际数据）')

    # 查昨日所有 strong_buy / buy 记录
    resp = (
        sb.table('sector_scores')
        .select('id,sector_name,signal,total_score,rank')
        .eq('trade_date', yesterday)
        .in_('signal', ['strong_buy', 'buy'])
        .order('rank')
        .execute()
    )
    predictions = resp.data or []

    if not predictions:
        print('[backfill] 昨日无 strong_buy/buy 推荐，跳过')
        return {'yesterday': yesterday, 'total': 0, 'hit': 0, 'hit_rate': 0, 'details': []}

    print(f'[backfill] 昨日推荐: {len(predictions)} 个板块')

    # 查今日这些板块的实际涨跌幅
    sector_names = [p['sector_name'] for p in predictions]
    resp = (
        sb.table('sector_daily')
        .select('sector_name,change_pct')
        .eq('trade_date', today)
        .in_('sector_name', sector_names)
        .execute()
    )
    actual_map = {r['sector_name']: r.get('change_pct', 0) or 0 for r in (resp.data or [])}

    # 回填
    hit = 0
    details = []

    for p in predictions:
        name = p['sector_name']
        actual = actual_map.get(name)

        if actual is None:
            continue

        is_hit = actual > 0
        if is_hit:
            hit += 1

        sb.table('sector_scores').update({
            'next_day_actual': actual,
            'prediction_hit': is_hit,
        }).eq('id', p['id']).execute()

        details.append({
            'sector_name': name,
            'signal': p['signal'],
            'score': p['total_score'],
            'actual': round(actual, 2),
            'hit': is_hit,
        })

    total = len(details)
    hit_rate = hit / total if total > 0 else 0

    print(f'[backfill] 回填完成: {hit}/{total} 命中 ({hit_rate:.1%})')

    return {
        'yesterday': yesterday,
        'total': total,
        'hit': hit,
        'hit_rate': hit_rate,
        'details': details,
    }


def track_positions(sb=None) -> list[dict]:
    """
    持仓跟踪：查过去5个交易日内 signal=strong_buy/buy 的推荐，
    计算推荐日至今的累计涨跌幅。

    返回: [{
      'sector_name': str,
      'signal': str,
      'score': float,
      'rec_date': str,        # 推荐日期
      'days_held': int,       # 持有天数
      'cum_change': float,    # 累计涨跌幅(%)
      'status': str,          # 持有中/已止损/已超期
      'daily_changes': list,  # 每日涨跌幅
    }]
    """
    if sb is None:
        sb = get_supabase_client()

    today = get_today_bj()

    # 查过去10个自然日内的评分日期（覆盖约5个交易日）
    start_date = (datetime.now(_BJ_TZ) - timedelta(days=12)).strftime('%Y-%m-%d')

    resp = (
        sb.table('sector_scores')
        .select('trade_date,sector_name,signal,total_score,stage')
        .gte('trade_date', start_date)
        .lt('trade_date', today)
        .in_('signal', ['strong_buy', 'buy'])
        .order('trade_date', desc=True)
        .execute()
    )
    recommendations = resp.data or []

    if not recommendations:
        return []

    # 按板块+日期去重（同一板块可能连续多天被推荐，只跟踪最早的）
    seen = set()
    unique_recs = []
    for r in recommendations:
        key = r['sector_name']
        if key not in seen:
            seen.add(key)
            unique_recs.append(r)

    # 获取所有需要的板块在推荐日之后的每日涨跌幅
    sector_names = list({r['sector_name'] for r in unique_recs})
    earliest_date = min(r['trade_date'] for r in unique_recs)

    resp = (
        sb.table('sector_daily')
        .select('sector_name,trade_date,change_pct')
        .gte('trade_date', earliest_date)
        .lte('trade_date', today)
        .in_('sector_name', sector_names)
        .order('trade_date', desc=False)
        .execute()
    )

    # 构建 {板块: {日期: change_pct}} 映射
    daily_map: dict[str, dict[str, float]] = {}
    for row in (resp.data or []):
        name = row['sector_name']
        if name not in daily_map:
            daily_map[name] = {}
        daily_map[name][row['trade_date']] = row.get('change_pct', 0) or 0

    # 计算每条推荐的持仓跟踪
    results = []
    for rec in unique_recs:
        name = rec['sector_name']
        rec_date = rec['trade_date']

        if name not in daily_map:
            continue

        # 获取推荐日之后的所有交易日涨跌幅
        all_dates = sorted(daily_map[name].keys())
        after_dates = [d for d in all_dates if d > rec_date]

        daily_changes = []
        cum_change = 0.0
        hit_stop_loss = False
        days_held = 0

        for d in after_dates:
            change = daily_map[name][d]
            cum_change += change
            days_held += 1
            daily_changes.append({'date': d, 'change': round(change, 2), 'cum': round(cum_change, 2)})

            # 检查止损
            if cum_change <= STOP_LOSS_PCT:
                hit_stop_loss = True
                break

        # 判断状态
        if hit_stop_loss:
            status = '已止损'
        elif days_held >= MAX_HOLD_DAYS:
            status = '已超期'
        else:
            status = '持有中'

        results.append({
            'sector_name': name,
            'signal': rec['signal'],
            'score': rec['total_score'],
            'stage': rec.get('stage', ''),
            'rec_date': rec_date,
            'days_held': days_held,
            'cum_change': round(cum_change, 2),
            'status': status,
            'daily_changes': daily_changes,
        })

    # 按推荐日期降序
    results.sort(key=lambda x: x['rec_date'], reverse=True)

    return results


if __name__ == '__main__':
    result = backfill_yesterday()
    if result['details']:
        print()
        print(f'日期: {result["yesterday"]} → 次日实际')
        print(f'命中率: {result["hit"]}/{result["total"]} ({result["hit_rate"]:.1%})')
        for d in result['details']:
            icon = '✅' if d['hit'] else '❌'
            print(f'  {icon} {d["sector_name"]} [{d["signal"]}] {d["score"]:.0f}分 → {d["actual"]:+.2f}%')

    print()
    print('=== 持仓跟踪 ===')
    positions = track_positions()
    if positions:
        for p in positions:
            status_icon = {'持有中': '🟢', '已止损': '🔴', '已超期': '⚪'}.get(p['status'], '⚪')
            print(
                f'  {status_icon} {p["sector_name"]} '
                f'{p["rec_date"]}+{p["days_held"]}天 '
                f'累计{p["cum_change"]:+.2f}% '
                f'{p["status"]}'
            )
    else:
        print('  无持仓跟踪数据')
