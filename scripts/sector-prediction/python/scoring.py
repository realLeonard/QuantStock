"""
板块评分主入口 — 完整架构

6 维评分 + 图谱传导 + 市场分级 + 推荐/风险双输出 + 复盘闭环

流程：
  1. 查询数据（sector_daily 20天 + limitUpReasons + dailyReview + newsItems_cls + rotation_map）
  2. 市场环境分级
  3. 复盘回填昨日预测
  4. 逐板块 6 维评分 + 生命周期
  5. 排序 → rank + signal + 市场过滤
  6. 批量 upsert 到 sector_scores
  7. 打印 TOP10 + 风险板块

权重：资金 30% + 情绪 25% + 政策 25% + 技术 15% + 轮动 5% + 龙头加分(0-10)
"""

import json
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client, now_utc_ms
from scorers import (
    calc_fund_score,
    calc_tech_score,
    calc_sentiment_score,
    calc_policy_scores_batch,
    calc_rotation_score,
    calc_leader_bonus,
)
from market_env import classify_market, RECOMMEND_LIMITS
from lifecycle import detect_lifecycle
from backfill import backfill_yesterday

# 北京时区
_BJ_TZ = timezone(timedelta(hours=8))

# 6 维权重
W_FUND = 0.30
W_SENTIMENT = 0.25
W_POLICY = 0.25
W_TECH = 0.15
W_ROTATION = 0.05


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


def classify_signal(rank: int, total: int, score: float) -> str:
    """根据排名百分位和分数分档"""
    if total == 0:
        return 'watch'
    pct = rank / total
    if pct <= 0.05 and score >= 70:
        return 'strong_buy'
    elif pct <= 0.15 and score >= 55:
        return 'buy'
    elif pct <= 0.40:
        return 'watch'
    else:
        return 'avoid'


def detect_risk_sectors(scores: list[dict]) -> list[dict]:
    """
    识别风险板块：分歧/退潮期 且 连续 2 天以上主力净流出
    """
    risks = []
    for s in scores:
        stage = s.get('stage', '')
        if stage not in ('分歧', '退潮'):
            continue

        fund_detail = s.get('fund_detail', {})
        if not isinstance(fund_detail, dict):
            continue

        outflow_days = fund_detail.get('consecutive_outflow_days', 0)
        raw_inflow = fund_detail.get('raw_inflow', 0)

        # 要求连续流出 ≥ 2 天
        if outflow_days >= 2:
            reason_parts = [f'{stage}期', f'连续{outflow_days}日主力流出']
            if raw_inflow < -1e8:
                reason_parts.append(f'今日{raw_inflow/1e8:.1f}亿')
            risks.append({
                **s,
                'signal': 'risk',
                'risk_reason': '，'.join(reason_parts),
            })

    return risks


def main():
    print('=' * 60)
    print('板块评分引擎 — 完整架构')
    print(f'北京时间: {datetime.now(_BJ_TZ).strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    sb = get_supabase_client()
    today = get_today_bj()

    # ============================================================
    # [1/7] 读取全部数据
    # ============================================================
    print('[1/7] 查询数据...')

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
    daily_review = fetch_daily_review(sb, today)
    rotation_map = fetch_rotation_map(sb)
    leading_stocks = fetch_leading_stocks(sb)

    print(f'  板块数: {len(grouped)}')
    print(f'  limitUpReasons: {"有" if limit_up_data else "无"}')
    print(f'  dailyReview: {"有" if daily_review else "无"}')
    print(f'  rotation_map: {len(rotation_map)} 条')

    # ============================================================
    # [2/7] 市场环境分级
    # ============================================================
    print('[2/7] 市场环境分级...')
    market_env, env_detail = classify_market(daily_review)
    recommend_limit = RECOMMEND_LIMITS.get(market_env, 5)
    print(f'  环境: {market_env} | {env_detail.get("reason", "")} | 推荐上限: {recommend_limit}')

    # ============================================================
    # [3/7] 复盘回填昨日预测
    # ============================================================
    print('[3/7] 复盘回填...')
    backfill_result = backfill_yesterday(sb)

    # ============================================================
    # [4/7] 收集全市场基准数据
    # ============================================================
    print('[4/7] 准备全市场基准...')
    all_today_inflows = []
    for name, rows in grouped.items():
        if rows and rows[-1].get('trade_date') == today:
            inflow = rows[-1].get('main_net_inflow')
            if inflow is not None:
                all_today_inflows.append(inflow)

    print(f'  当日有资金流板块: {len(all_today_inflows)}')

    # 全市场3日加权趋势列表（与 fund_scorer 同口径）
    all_today_trends: list[float] = []
    weights_3d = [0.2, 0.3, 0.5]
    for name, rows in grouped.items():
        fund_rows = [r for r in rows if r.get('main_net_inflow') is not None]
        if len(fund_rows) >= 3:
            ws = sum(
                (r.get('main_net_inflow') or 0.0) * w
                for r, w in zip(fund_rows[-3:], weights_3d)
            )
            all_today_trends.append(ws)
        elif len(fund_rows) >= 1:
            all_today_trends.append(fund_rows[-1].get('main_net_inflow') or 0.0)

    # 市场情绪数据
    market_sentiment = daily_review.get('market_sentiment') if daily_review else None
    dragon_tiger = daily_review.get('dragon_tiger') if daily_review else None

    # ============================================================
    # [5/7] 逐板块评分
    # ============================================================
    print('[5/7] 逐板块评分...')

    # 政策面：批量处理（共享新闻 + Claude 一次调用）
    sector_names = [
        name for name, rows in grouped.items()
        if rows and rows[-1].get('trade_date') == today and len(rows) >= 5
    ]
    policy_scores_map = calc_policy_scores_batch(sb, sector_names)

    scores = []
    skipped = 0

    for name, rows in grouped.items():
        if not rows or rows[-1].get('trade_date') != today:
            skipped += 1
            continue
        if len(rows) < 5:
            skipped += 1
            continue

        # 6 维评分
        fund_score, fund_detail = calc_fund_score(rows, all_today_inflows, all_today_trends)
        sentiment_score, sentiment_detail = calc_sentiment_score(
            name, rows, limit_up_data, market_sentiment
        )
        policy_result = policy_scores_map.get(name, (0.0, {}))
        policy_score, policy_detail = policy_result
        tech_score, tech_detail = calc_tech_score(rows)
        rotation_score, rotation_detail = calc_rotation_score(name, rotation_map, grouped)

        # 龙头加分
        leader_stock = leading_stocks.get(name, '')
        leader_bonus, leader_detail = calc_leader_bonus(
            name, leader_stock, limit_up_data, dragon_tiger
        )

        # 加权总分
        total = (
            fund_score * W_FUND
            + sentiment_score * W_SENTIMENT
            + policy_score * W_POLICY
            + tech_score * W_TECH
            + rotation_score * W_ROTATION
            + leader_bonus  # 直接加分（0-10）
        )

        # 生命周期
        # 从情绪面 detail 获取涨停数和连板数
        sector_limit_count = sentiment_detail.get('raw_limit_count', 0) if isinstance(sentiment_detail, dict) else 0
        max_board = sentiment_detail.get('raw_max_board', 0) if isinstance(sentiment_detail, dict) else 0
        stage = detect_lifecycle(rows, sector_limit_count, max_board)

        # 置信度：基于各维度得分的加权覆盖率
        # 每个维度按其权重贡献置信度，得分越高贡献越大
        dim_pairs = [
            (fund_score, W_FUND),
            (sentiment_score, W_SENTIMENT),
            (policy_score, W_POLICY),
            (tech_score, W_TECH),
            (rotation_score, W_ROTATION),
        ]
        # 各维度得分归一化到 0-1 后，按权重加权求和
        confidence = round(
            sum(min(s / 80, 1.0) * w for s, w in dim_pairs) / sum(w for _, w in dim_pairs),
            2,
        )

        scores.append({
            'sector_name': name,
            'fund_score': fund_score,
            'tech_score': tech_score,
            'sentiment_score': sentiment_score,
            'policy_score': policy_score,
            'rotation_score': rotation_score,
            'leader_bonus': leader_bonus,
            'total_score': round(total, 2),
            'fund_detail': fund_detail,
            'tech_detail': tech_detail,
            'sentiment_detail': sentiment_detail,
            'policy_detail': policy_detail,
            'rotation_detail': rotation_detail,
            'leader_detail': leader_detail,
            'leading_stock': leader_stock,
            'stage': stage,
            'confidence': confidence,
            'market_env': market_env,
        })

    print(f'  评分完成: {len(scores)} 个板块，跳过 {skipped} 个')

    if not scores:
        print('[error] 无板块评分结果，终止')
        sys.exit(1)

    # ============================================================
    # [6/7] 排序 + 信号分档 + 风险识别
    # ============================================================
    print('[6/7] 排序 + 信号分档...')
    scores.sort(key=lambda s: s['total_score'], reverse=True)

    total_count = len(scores)
    for i, s in enumerate(scores):
        s['rank'] = i + 1
        s['signal'] = classify_signal(i + 1, total_count, s['total_score'])

    # 风险板块识别
    risk_sectors = detect_risk_sectors(scores)
    for rs in risk_sectors:
        # 找到原记录并标记
        for s in scores:
            if s['sector_name'] == rs['sector_name']:
                s['signal'] = 'risk'
                s['risk_reason'] = rs['risk_reason']
                break

    signal_counts = defaultdict(int)
    for s in scores:
        signal_counts[s['signal']] += 1

    print(f'  strong_buy: {signal_counts["strong_buy"]}')
    print(f'  buy: {signal_counts["buy"]}')
    print(f'  watch: {signal_counts["watch"]}')
    print(f'  risk: {signal_counts["risk"]}')
    print(f'  avoid: {signal_counts["avoid"]}')

    # ============================================================
    # [7/7] 写入 sector_scores
    # ============================================================
    print('[7/7] 写入 sector_scores...')
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
                'fund_score': s['fund_score'],
                'tech_score': s['tech_score'],
                'sentiment_score': s['sentiment_score'],
                'policy_score': s['policy_score'],
                'rotation_score': s['rotation_score'],
                'leader_bonus': s['leader_bonus'],
                'total_score': s['total_score'],
                'fund_detail': json.dumps(s['fund_detail'], ensure_ascii=False),
                'tech_detail': json.dumps(s['tech_detail'], ensure_ascii=False),
                'sentiment_detail': json.dumps(s['sentiment_detail'], ensure_ascii=False),
                'policy_detail': json.dumps(s['policy_detail'], ensure_ascii=False),
                'rotation_detail': json.dumps(s['rotation_detail'], ensure_ascii=False),
                'leader_detail': json.dumps(s['leader_detail'], ensure_ascii=False),
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
    print(f'板块评分日报 — {today}')
    print(f'市场环境: {env_str} | 推荐上限: {recommend_limit}')
    print('-' * 60)

    # TOP 推荐
    top_picks = [s for s in scores if s['signal'] in ('strong_buy', 'buy')][:recommend_limit]
    print(f'🔥 强势推荐 ({len(top_picks)}):')
    for s in top_picks:
        print(
            f'  #{s["rank"]:>3d} {s["sector_name"]:<12s} '
            f'{s["total_score"]:5.1f}分 【{s["stage"]}】 '
            f'💰{s["fund_score"]:.0f} 🔥{s["sentiment_score"]:.0f} '
            f'📰{s["policy_score"]:.0f} 📈{s["tech_score"]:.0f} 🔄{s["rotation_score"]:.0f} '
            f'+{s["leader_bonus"]:.0f}  '
            f'⭐{s["confidence"]:.2f}  '
            f'{s["leading_stock"]}'
        )

    # 风险板块
    risk_list = [s for s in scores if s['signal'] == 'risk']
    if risk_list:
        print(f'\n⚠️ 风险板块 ({len(risk_list)}):')
        for s in risk_list[:5]:
            print(f'  ▸ {s["sector_name"]} → {s.get("risk_reason", "")}')

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
