"""
板块评分主入口 — v3 预测导向重构

6 维预测评分 + 市场情绪周期 + 板块去重 + 持仓跟踪

流程：
  1. 查询数据（sector_daily 60天 + limitUpReasons 近3天 + dailyReview + rotation_map）
  2. 全局过滤（≥20天数据 + 成交额≥P20）
  3. 市场环境分级 + 情绪周期
  4. 复盘回填昨日预测
  5. 逐板块 4 维评分 + 风险修正 + 阶段系数
  6. 排序 → 信号分档 → 板块去重
  7. 批量写入 sector_scores
  8. 打印摘要

权重：资金暗流 30% + 量价蓄势 25% + 模式匹配 20% + 催化剂 15%
修正：风险 -5~0 + 阶段系数 ×0.7~1.2 + 大盘系数 ×0.5~1.0
"""

import json
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client, now_utc_ms
from scorers import (
    calc_fund_stealth_score,
    calc_momentum_score,
    calc_pattern_score,
    calc_catalyst_score,
)
from scorers.risk_adjuster import calc_risk_adjustment
from market_env import classify_market, RECOMMEND_LIMITS
from lifecycle import detect_lifecycle
from backfill import backfill_yesterday
from utils import match_sector_name

# 北京时区
_BJ_TZ = timezone(timedelta(hours=8))

# v3 权重
W_STEALTH = 0.30
W_MOMENTUM = 0.25
W_PATTERN = 0.20
W_CATALYST = 0.15

# 大盘情绪系数
MARKET_EMOTION_COEFF = {
    'strong': 1.0,
    'neutral': 0.9,
    'weak': 0.75,
    'extreme': 0.5,
}

# 全局过滤：最小数据天数
MIN_DATA_DAYS = 20


def get_today_bj() -> str:
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def fetch_sector_daily(sb, days: int = 20) -> list[dict]:
    """查询近 N 天全部 sector_daily 数据（分页）"""
    start_date = (datetime.now(_BJ_TZ) - timedelta(days=days + 5)).strftime('%Y-%m-%d')
    all_data = []
    offset = 0
    page_size = 1000

    while True:
        resp = (
            sb.table('sector_daily')
            .select('*')
            .gte('trade_date', start_date)
            .order('trade_date', desc=False)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        all_data.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return all_data


def fetch_leading_stocks(sb) -> dict[str, str]:
    """从 sector_master 获取板块→领涨股映射"""
    resp = (
        sb.table('sector_master')
        .select('name,leading_stock')
        .eq('is_active', True)
        .execute()
    )
    return {r['name']: r.get('leading_stock') or '' for r in (resp.data or [])}


def fetch_limit_up(sb, today: str) -> dict | None:
    """查询 limitUpReasons 当日数据"""
    resp = sb.table('limitUpReasons').select('*').eq('pick_date', today).limit(1).execute()
    return resp.data[0] if resp.data else None


def fetch_limit_up_recent(sb, today: str, days: int = 3) -> list[dict]:
    """返回近 N 天的 limitUpReasons 列表，按 pick_date ASC"""
    # 往前推 days*2 天（跳过周末）
    start = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=days * 2 + 2)).strftime('%Y-%m-%d')
    resp = (
        sb.table('limitUpReasons')
        .select('*')
        .gte('pick_date', start)
        .lte('pick_date', today)
        .order('pick_date', desc=False)
        .execute()
    )
    data = resp.data or []
    # 只取最后 N 条（N 个交易日）
    return data[-days:] if len(data) > days else data


def fetch_daily_review(sb, today: str) -> dict | None:
    """查询 dailyReview 当日数据"""
    resp = sb.table('dailyReview').select('*').eq('report_date', today).limit(1).execute()
    return resp.data[0] if resp.data else None


def fetch_rotation_map(sb) -> list[dict]:
    """查询 sector_rotation_map 全量"""
    try:
        resp = sb.table('sector_rotation_map').select('*').execute()
        return resp.data or []
    except Exception as e:
        if 'PGRST205' in str(e):
            print('  [warn] sector_rotation_map 表不存在，轮动评分跳过')
            return []
        raise


def classify_signal(
    rank: int,
    total: int,
    score: float,
    stage: str,
    risk_adj: float,
) -> str:
    """v3 信号分档：strong_buy / buy / hold / sell / watch / avoid"""
    if total == 0:
        return 'watch'
    pct = rank / total

    # 见顶期 + 风险严重 → sell
    if stage == '见顶期' and risk_adj <= -3:
        return 'sell'

    # strong_buy：TOP5% + ≥60 + 吸筹/启动
    if pct <= 0.05 and score >= 60 and stage in ('吸筹期', '启动期'):
        return 'strong_buy'

    # buy：TOP10% + ≥50 + 非见顶/调整
    if pct <= 0.10 and score >= 50 and stage not in ('见顶期', '调整期'):
        return 'buy'

    # hold：主升/发酵 + ≥50
    if stage in ('主升期', '发酵期') and score >= 50:
        return 'hold'

    # watch：TOP40%
    if pct <= 0.40:
        return 'watch'

    return 'avoid'


def detect_overlap(scores: list[dict], grouped: dict[str, list[dict]], threshold: float = 0.8) -> dict[str, str]:
    """
    板块重叠检测：计算推荐板块两两间的20日涨幅相关系数。
    返回 {被去重板块名: 保留的板块名}
    """
    # 只对推荐板块做去重
    recommended = [s for s in scores if s['signal'] in ('strong_buy', 'buy', 'hold')]
    if len(recommended) < 2:
        return {}

    # 构建涨幅序列矩阵
    names = [s['sector_name'] for s in recommended]
    change_series = {}
    for name in names:
        rows = grouped.get(name, [])
        changes = [r.get('change_pct', 0) for r in rows[-20:]]
        if len(changes) >= 10:
            change_series[name] = changes

    if len(change_series) < 2:
        return {}

    # 两两计算相关系数
    removed = {}  # {被移除板块: 保留的板块}
    score_map = {s['sector_name']: s['total_score'] for s in recommended}
    checked_names = list(change_series.keys())

    for i in range(len(checked_names)):
        if checked_names[i] in removed:
            continue
        for j in range(i + 1, len(checked_names)):
            if checked_names[j] in removed:
                continue
            a = change_series[checked_names[i]]
            b = change_series[checked_names[j]]
            # 对齐长度
            min_len = min(len(a), len(b))
            if min_len < 10:
                continue
            corr = np.corrcoef(a[-min_len:], b[-min_len:])[0, 1]
            if abs(corr) > threshold:
                # 去掉分数低的
                if score_map.get(checked_names[i], 0) >= score_map.get(checked_names[j], 0):
                    removed[checked_names[j]] = checked_names[i]
                else:
                    removed[checked_names[i]] = checked_names[j]

    return removed


def _parse_json(val):
    """安全解析 JSON"""
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def main():
    print('=' * 60)
    print('板块评分引擎 v3 — 预测导向')
    print(f'北京时间: {datetime.now(_BJ_TZ).strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    sb = get_supabase_client()
    today = get_today_bj()

    # ============================================================
    # [1/8] 读取全部数据
    # ============================================================
    print('[1/8] 查询数据...')

    all_daily = fetch_sector_daily(sb, days=60)
    print(f'  sector_daily: {len(all_daily)} 条')

    if not all_daily:
        print('[error] sector_daily 无数据，终止')
        sys.exit(1)

    # 按板块分组
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in all_daily:
        grouped[row['sector_name']].append(row)
    for name in grouped:
        grouped[name].sort(key=lambda r: r['trade_date'])

    # 确定评分日期
    latest_date = max(r['trade_date'] for r in all_daily)
    if not any(r['trade_date'] == today for r in all_daily):
        print(f'  今日 ({today}) 无数据，使用最近交易日 {latest_date}')
        today = latest_date

    # 辅助数据
    limit_up_data = fetch_limit_up(sb, today)
    limit_up_recent = fetch_limit_up_recent(sb, today, days=3)
    daily_review = fetch_daily_review(sb, today)
    rotation_map = fetch_rotation_map(sb)
    leading_stocks = fetch_leading_stocks(sb)

    print(f'  板块数: {len(grouped)}')
    print(f'  limitUpReasons: 今日{"有" if limit_up_data else "无"}, 近{len(limit_up_recent)}天')
    print(f'  dailyReview: {"有" if daily_review else "无"}')
    print(f'  rotation_map: {len(rotation_map)} 条')

    # ============================================================
    # [2/8] 全局过滤
    # ============================================================
    print('[2/8] 全局过滤...')

    # 成交额 P20 阈值
    today_turnovers = []
    for name, rows in grouped.items():
        if rows and rows[-1].get('trade_date') == today:
            t = rows[-1].get('turnover', 0) or 0
            if t > 0:
                today_turnovers.append(t)

    turnover_p20 = float(np.percentile(today_turnovers, 20)) if today_turnovers else 0
    print(f'  成交额 P20 阈值: {turnover_p20/1e8:.2f}亿')

    eligible_sectors = {}
    filtered_count = 0
    for name, rows in grouped.items():
        # 条件1：有今日数据
        if not rows or rows[-1].get('trade_date') != today:
            filtered_count += 1
            continue
        # 条件2：至少20天数据
        if len(rows) < MIN_DATA_DAYS:
            filtered_count += 1
            continue
        # 条件3：成交额 ≥ P20
        today_turnover = rows[-1].get('turnover', 0) or 0
        if today_turnover < turnover_p20:
            filtered_count += 1
            continue
        eligible_sectors[name] = rows

    print(f'  参与评分: {len(eligible_sectors)} 个，过滤: {filtered_count} 个')

    # ============================================================
    # [3/8] 市场环境分级 + 情绪周期
    # ============================================================
    print('[3/8] 市场环境分级...')
    market_env, env_detail = classify_market(daily_review)
    market_coeff = MARKET_EMOTION_COEFF.get(market_env, 0.9)
    recommend_limit = RECOMMEND_LIMITS.get(market_env, 5)
    print(f'  环境: {market_env} (×{market_coeff}) | {env_detail.get("reason", "")} | 推荐上限: {recommend_limit}')

    # ============================================================
    # [4/8] 复盘回填昨日预测
    # ============================================================
    print('[4/8] 复盘回填...')
    backfill_result = backfill_yesterday(sb)

    # ============================================================
    # [5/8] 准备全市场基准数据
    # ============================================================
    print('[5/8] 准备全市场基准...')

    # 全市场当日资金流入列表（用于百分位计算）
    all_today_inflows = []
    for name, rows in grouped.items():
        if rows and rows[-1].get('trade_date') == today:
            inflow = rows[-1].get('main_net_inflow')
            if inflow is not None:
                all_today_inflows.append(inflow)
    print(f'  当日有资金流板块: {len(all_today_inflows)}')

    # 市场情绪数据
    market_sentiment = daily_review.get('market_sentiment') if daily_review else None

    # ============================================================
    # [6/8] 逐板块评分
    # ============================================================
    print('[6/8] 逐板块评分...')

    scores = []

    for name, rows in eligible_sectors.items():
        # --- 资金暗流（30%）---
        stealth_score, stealth_detail = calc_fund_stealth_score(
            rows, all_today_inflows
        )

        # --- 量价蓄势（25%）---
        momentum_score, momentum_detail = calc_momentum_score(rows)

        # --- 模式匹配（20%）---
        pattern_score, pattern_detail = calc_pattern_score(
            name, rows, grouped, today
        )

        # --- 催化剂（15%）---
        catalyst_score, catalyst_detail = calc_catalyst_score(
            name, rows, limit_up_recent, rotation_map, grouped, sb
        )

        # --- 风险修正（-5 ~ 0）---
        risk_adj, risk_detail = calc_risk_adjustment(
            rows, limit_up_recent, name
        )

        # --- 生命周期 + 阶段系数 ---
        stage, stage_coeff = detect_lifecycle(
            rows, limit_up_recent, name
        )

        # --- 加权总分 ---
        raw = (
            stealth_score * W_STEALTH
            + momentum_score * W_MOMENTUM
            + pattern_score * W_PATTERN
            + catalyst_score * W_CATALYST
        )

        # 阶段系数与大盘系数取较低值，下限 0.5
        combined_coeff = max(0.5, min(stage_coeff, market_coeff))
        adjusted = raw * combined_coeff
        final = max(0, round(adjusted + risk_adj, 2))

        scores.append({
            'sector_name': name,
            # v3 新字段
            'stealth_fund_score': stealth_score,
            'momentum_score': momentum_score,
            'pattern_score': pattern_score,
            'catalyst_score': catalyst_score,
            'risk_adjustment': risk_adj,
            'stage_coefficient': stage_coeff,
            'market_emotion_phase': market_env,
            # 旧字段保留写0（向后兼容）
            'fund_score': 0.0,
            'tech_score': 0.0,
            'sentiment_score': 0.0,
            'policy_score': 0.0,
            'rotation_score': 0.0,
            'leader_bonus': 0.0,
            # 总分
            'total_score': final,
            # detail
            'stealth_fund_detail': stealth_detail,
            'momentum_detail': momentum_detail,
            'pattern_detail': pattern_detail,
            'catalyst_detail': catalyst_detail,
            'fund_detail': {},
            'tech_detail': {},
            'sentiment_detail': {},
            'policy_detail': {},
            'rotation_detail': {},
            'leader_detail': {},
            # 生命周期
            'stage': stage,
            'leading_stock': leading_stocks.get(name, ''),
            'market_env': market_env,
            'confidence': round(combined_coeff, 2),
        })

    print(f'  评分完成: {len(scores)} 个板块')

    if not scores:
        print('[error] 无板块评分结果，终止')
        sys.exit(1)

    # ============================================================
    # [7/8] 排序 + 信号分档 + 板块去重
    # ============================================================
    print('[7/8] 排序 + 信号分档 + 去重...')
    scores.sort(key=lambda s: s['total_score'], reverse=True)

    total_count = len(scores)
    for i, s in enumerate(scores):
        s['rank'] = i + 1
        s['signal'] = classify_signal(
            i + 1, total_count, s['total_score'],
            s['stage'], s['risk_adjustment']
        )

    # 板块去重
    overlap_map = detect_overlap(scores, grouped)
    for s in scores:
        if s['sector_name'] in overlap_map:
            kept = overlap_map[s['sector_name']]
            s['signal'] = 'watch'
            s['risk_reason'] = f'与{kept}高度相关，已去重'
            print(f'  去重: {s["sector_name"]} → 保留 {kept}')

    signal_counts = defaultdict(int)
    for s in scores:
        signal_counts[s['signal']] += 1

    print(f'  strong_buy: {signal_counts["strong_buy"]}')
    print(f'  buy: {signal_counts["buy"]}')
    print(f'  hold: {signal_counts["hold"]}')
    print(f'  sell: {signal_counts["sell"]}')
    print(f'  watch: {signal_counts["watch"]}')
    print(f'  avoid: {signal_counts["avoid"]}')

    # 推导时间建议
    for s in scores:
        if s['signal'] == 'strong_buy':
            s['time_horizon'] = '中期布局(3-5天)'
        elif s['signal'] == 'buy':
            s['time_horizon'] = '短期机会(1-3天)'
        elif s['signal'] == 'hold':
            s['time_horizon'] = '持有观察'
        elif s['signal'] == 'sell':
            s['time_horizon'] = '建议离场'
        else:
            s['time_horizon'] = ''

    # ============================================================
    # [8/8] 写入 sector_scores
    # ============================================================
    print('[8/8] 写入 sector_scores...')
    now = now_utc_ms()

    # 先删除当日已有记录（带重试）
    for attempt in range(3):
        try:
            sb.table('sector_scores').delete().eq('trade_date', today).execute()
            break
        except Exception as e:
            if attempt < 2:
                print(f'  [warn] 删除重试 {attempt+1}/3: {e}')
                import time; time.sleep(2)
            else:
                print(f'  [error] 删除失败，跳过写入: {e}')
                return

    batch_size = 50
    inserted = 0

    for i in range(0, len(scores), batch_size):
        batch = scores[i:i + batch_size]
        records = []
        for s in batch:
            records.append({
                'id': str(uuid.uuid4()),
                'trade_date': today,
                'sector_name': s['sector_name'],
                # 旧字段（向后兼容，写0）
                'fund_score': 0.0,
                'tech_score': 0.0,
                'sentiment_score': 0.0,
                'policy_score': 0.0,
                'rotation_score': 0.0,
                'leader_bonus': 0.0,
                # v3 新字段
                'stealth_fund_score': s['stealth_fund_score'],
                'momentum_score': s['momentum_score'],
                'pattern_score': s['pattern_score'],
                'catalyst_score': s['catalyst_score'],
                'risk_adjustment': s['risk_adjustment'],
                'stage_coefficient': s['stage_coefficient'],
                'market_emotion_phase': s['market_emotion_phase'],
                'time_horizon': s.get('time_horizon', ''),
                # detail（JSONB）
                'stealth_fund_detail': json.dumps(s.get('stealth_fund_detail', {}), ensure_ascii=False),
                'momentum_detail': json.dumps(s.get('momentum_detail', {}), ensure_ascii=False),
                'pattern_detail': json.dumps(s.get('pattern_detail', {}), ensure_ascii=False),
                'catalyst_detail': json.dumps(s.get('catalyst_detail', {}), ensure_ascii=False),
                'fund_detail': '{}',
                'tech_detail': '{}',
                'sentiment_detail': '{}',
                'policy_detail': '{}',
                'rotation_detail': '{}',
                'leader_detail': '{}',
                # 总分 + 排序
                'total_score': s['total_score'],
                'rank': s['rank'],
                'signal': s['signal'],
                'stage': s['stage'],
                'confidence': s['confidence'],
                'risk_reason': s.get('risk_reason'),
                'leading_stock': s['leading_stock'],
                'market_env': s['market_env'],
                'created_at': now,
            })

        for attempt in range(3):
            try:
                sb.table('sector_scores').insert(records).execute()
                inserted += len(records)
                break
            except Exception as e:
                if attempt < 2:
                    import time; time.sleep(2)
                else:
                    print(f'  [error] 批量插入失败（第 {i}-{i+len(batch)} 条）: {e}')

    print(f'  写入完成: {inserted}/{len(scores)}')

    # ============================================================
    # 打印摘要
    # ============================================================
    env_icons = {'strong': '🟢强势', 'neutral': '🟡中性', 'weak': '🔴弱势', 'extreme': '⚫极端'}
    env_str = env_icons.get(market_env, market_env)

    print()
    print('=' * 60)
    print(f'板块评分日报 v3 — {today}')
    print(f'市场环境: {env_str} (×{market_coeff}) | 推荐上限: {recommend_limit}')
    print('-' * 60)

    # TOP 推荐
    top_picks = [s for s in scores if s['signal'] in ('strong_buy', 'buy', 'hold')][:recommend_limit]
    print(f'🔥 推荐 ({len(top_picks)}):')
    for s in top_picks:
        signal_icon = {'strong_buy': '🔴', 'buy': '🟠', 'hold': '🟡'}.get(s['signal'], '⚪')
        print(
            f'  {signal_icon} #{s["rank"]:>3d} {s["sector_name"]:<12s} '
            f'{s["total_score"]:5.1f}分 【{s["stage"]}】 '
            f'暗流{s["stealth_fund_score"]:.0f} 蓄势{s["momentum_score"]:.0f} '
            f'模式{s["pattern_score"]:.0f} 催化{s["catalyst_score"]:.0f} '
            f'风险{s["risk_adjustment"]:.0f}  '
            f'×{s["stage_coefficient"]:.1f}  '
            f'{s.get("time_horizon", "")}'
        )

    # sell 板块
    sell_list = [s for s in scores if s['signal'] == 'sell']
    if sell_list:
        print(f'\n🔻 建议离场 ({len(sell_list)}):')
        for s in sell_list[:5]:
            print(f'  ▸ {s["sector_name"]} 【{s["stage"]}】 风险{s["risk_adjustment"]:.0f}')

    # 复盘
    if backfill_result['total'] > 0:
        print(f'\n📋 昨日复盘: {backfill_result["hit"]}/{backfill_result["total"]} 命中 ({backfill_result["hit_rate"]:.1%})')

    # 分数分布
    all_scores_val = [s['total_score'] for s in scores]
    median = sorted(all_scores_val)[len(all_scores_val) // 2]
    print(f'\n中位数: {median:.1f}  最高: {max(all_scores_val):.1f}  最低: {min(all_scores_val):.1f}')
    print('=' * 60)


if __name__ == '__main__':
    main()
