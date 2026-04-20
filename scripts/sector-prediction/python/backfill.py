"""复盘回填 — 次日实际涨跌幅 vs 预测

独立脚本，每天评分前先回填昨日预测结果：
  1. 查 sector_scores 昨日所有 signal=strong_buy/buy 的记录
  2. 从 sector_daily 查这些板块今日 change_pct
  3. 回填 next_day_actual + prediction_hit（涨幅>0 = hit）
  4. 统计命中率，返回供推送使用
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 将当前目录加入 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client

_BJ_TZ = timezone(timedelta(hours=8))


def get_today_bj() -> str:
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def backfill_yesterday(sb=None) -> dict:
    """
    回填昨日预测结果。

    返回: {
      'yesterday': str,        # 昨日日期
      'total': int,            # 昨日推荐板块数
      'hit': int,              # 命中数（次日涨）
      'hit_rate': float,       # 命中率
      'details': list[dict],   # 各板块明细
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
            # 今日无数据（可能还没采集）
            continue

        is_hit = actual > 0
        if is_hit:
            hit += 1

        # 更新数据库
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


if __name__ == '__main__':
    result = backfill_yesterday()
    if result['details']:
        print()
        print(f'日期: {result["yesterday"]} → 次日实际')
        print(f'命中率: {result["hit"]}/{result["total"]} ({result["hit_rate"]:.1%})')
        for d in result['details']:
            icon = '✅' if d['hit'] else '❌'
            print(f'  {icon} {d["sector_name"]} [{d["signal"]}] {d["score"]:.0f}分 → {d["actual"]:+.2f}%')
