"""回测框架 — 防前视偏差 + 多维评估

用法：
  python3 backtest.py [--days 30]

流程：
  1. 拉取 90 天 sector_daily（前20天预热，后N天逐日回测）
  2. 每个回测日：只用该日及之前的数据评分
  3. 收集推荐板块的后续 1/3/5 天实际涨幅
  4. 统计：命中率 / 3天均涨幅 / 最大回撤 / 盈亏比 / 信号衰减
"""

import sys
import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client
from utils import mean, clamp
from scorers.fund_stealth_scorer import calc_fund_stealth_score
from scorers.momentum_scorer import calc_momentum_score
from scorers.pattern_scorer import calc_pattern_score
from scorers.catalyst_scorer import calc_catalyst_score, reset_cache
from scorers.risk_adjuster import calc_risk_adjustment
from lifecycle import detect_lifecycle

_BJ_TZ = timezone(timedelta(hours=8))

# v3 权重
W_STEALTH = 0.30
W_MOMENTUM = 0.25
W_PATTERN = 0.20
W_CATALYST = 0.15

# 全局过滤
MIN_DATA_DAYS = 20


def fetch_all_daily(sb, days: int = 90) -> list[dict]:
    """拉取全部 sector_daily（分页）"""
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


def fetch_limit_up_all(sb, days: int = 90) -> list[dict]:
    """拉取全部 limitUpReasons"""
    start_date = (datetime.now(_BJ_TZ) - timedelta(days=days + 5)).strftime('%Y-%m-%d')
    resp = (
        sb.table('limitUpReasons')
        .select('*')
        .gte('pick_date', start_date)
        .order('pick_date', desc=False)
        .execute()
    )
    return resp.data or []


def run_backtest(test_days: int = 30):
    """执行回测"""
    print('=' * 60)
    print('板块评分 v3 回测框架')
    print(f'回测天数: {test_days}')
    print('=' * 60)

    sb = get_supabase_client()

    # 拉取数据
    print('[1/4] 拉取数据...')
    all_daily = fetch_all_daily(sb, days=test_days + 60)
    all_limit_up = fetch_limit_up_all(sb, days=test_days + 60)

    if not all_daily:
        print('[error] 无 sector_daily 数据')
        sys.exit(1)

    # 按板块分组
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in all_daily:
        grouped[row['sector_name']].append(row)
    for name in grouped:
        grouped[name].sort(key=lambda r: r['trade_date'])

    # 获取所有交易日
    all_dates = sorted(set(r['trade_date'] for r in all_daily))
    print(f'  sector_daily: {len(all_daily)} 条，{len(all_dates)} 个交易日')
    print(f'  limitUpReasons: {len(all_limit_up)} 条')

    # 选取回测日期范围（需要预热前20天 + 后续5天验证）
    if len(all_dates) < MIN_DATA_DAYS + test_days + 5:
        available = len(all_dates) - MIN_DATA_DAYS - 5
        if available <= 0:
            print(f'[error] 数据不足，至少需要 {MIN_DATA_DAYS + 10} 个交易日')
            sys.exit(1)
        print(f'  [warn] 数据不足 {test_days} 天，实际回测 {available} 天')
        test_days = available

    # 回测日期：从第 MIN_DATA_DAYS 天开始，到倒数第5天结束
    bt_dates = all_dates[MIN_DATA_DAYS:-5][-test_days:]
    print(f'  回测区间: {bt_dates[0]} ~ {bt_dates[-1]} ({len(bt_dates)} 天)')

    # limitUpReasons 按日期索引
    limit_by_date: dict[str, list[dict]] = defaultdict(list)
    for lu in all_limit_up:
        limit_by_date[lu['pick_date']].append(lu)

    # ============================================================
    # [2/4] 逐日回测
    # ============================================================
    print('[2/4] 逐日回测...')

    # 收集所有推荐的结果
    all_recs: list[dict] = []

    for di, as_of_date in enumerate(bt_dates):
        if (di + 1) % 5 == 0 or di == 0:
            print(f'  [{di+1}/{len(bt_dates)}] {as_of_date}...')

        # 重置催化剂缓存
        reset_cache()

        # 构建截止到 as_of_date 的数据
        truncated: dict[str, list[dict]] = {}
        for name, rows in grouped.items():
            trunc = [r for r in rows if r['trade_date'] <= as_of_date]
            if len(trunc) >= MIN_DATA_DAYS:
                truncated[name] = trunc

        if not truncated:
            continue

        # 全局过滤：成交额 P20
        turnovers = []
        for name, rows in truncated.items():
            if rows[-1]['trade_date'] == as_of_date:
                t = rows[-1].get('turnover', 0) or 0
                if t > 0:
                    turnovers.append(t)

        turnover_p20 = float(np.percentile(turnovers, 20)) if turnovers else 0

        eligible = {}
        for name, rows in truncated.items():
            if rows[-1]['trade_date'] != as_of_date:
                continue
            if (rows[-1].get('turnover', 0) or 0) < turnover_p20:
                continue
            eligible[name] = rows

        # 全市场资金流
        all_inflows = []
        for name, rows in eligible.items():
            inf = rows[-1].get('main_net_inflow')
            if inf is not None:
                all_inflows.append(inf)

        # limitUpReasons 近3天
        date_idx = all_dates.index(as_of_date) if as_of_date in all_dates else -1
        recent_limit_dates = [d for d in all_dates[:date_idx + 1] if d in limit_by_date][-3:]
        limit_recent = []
        for d in recent_limit_dates:
            limit_recent.extend(limit_by_date[d])

        # 评分
        scores = []
        for name, rows in eligible.items():
            stealth, _ = calc_fund_stealth_score(rows, all_inflows)
            momentum, _ = calc_momentum_score(rows)
            pattern, _ = calc_pattern_score(name, rows, truncated, as_of_date)
            # 催化剂：回测时跳过 Claude NLP（太慢+无法回溯）
            catalyst = 0.0
            risk_adj, _ = calc_risk_adjustment(rows, limit_recent, name)
            stage, stage_coeff = detect_lifecycle(rows, limit_recent, name)

            raw = (
                stealth * W_STEALTH
                + momentum * W_MOMENTUM
                + pattern * W_PATTERN
                + catalyst * W_CATALYST
            )
            # 回测不用大盘系数（简化）
            final = max(0, round(raw * stage_coeff + risk_adj, 2))

            scores.append({
                'sector_name': name,
                'total_score': final,
                'stage': stage,
                'risk_adj': risk_adj,
            })

        if not scores:
            continue

        # 排序取 TOP
        scores.sort(key=lambda s: s['total_score'], reverse=True)
        total_count = len(scores)

        for i, s in enumerate(scores):
            pct = (i + 1) / total_count
            if pct <= 0.05 and s['total_score'] >= 60:
                s['signal'] = 'strong_buy'
            elif pct <= 0.10 and s['total_score'] >= 50:
                s['signal'] = 'buy'
            else:
                s['signal'] = 'other'

        recommended = [s for s in scores if s['signal'] in ('strong_buy', 'buy')]

        # 获取后续 1/3/5 天涨幅
        for rec in recommended:
            name = rec['sector_name']
            full_rows = grouped.get(name, [])
            future_rows = [r for r in full_rows if r['trade_date'] > as_of_date]

            if not future_rows:
                continue

            next_1d = future_rows[0].get('change_pct', 0) or 0 if len(future_rows) >= 1 else 0
            next_3d = sum((r.get('change_pct', 0) or 0) for r in future_rows[:3])
            next_5d = sum((r.get('change_pct', 0) or 0) for r in future_rows[:5])

            # 最大回撤（3天内）
            cum = 0
            max_drawdown = 0
            for r in future_rows[:3]:
                cum += r.get('change_pct', 0) or 0
                max_drawdown = min(max_drawdown, cum)

            all_recs.append({
                'date': as_of_date,
                'sector_name': name,
                'signal': rec['signal'],
                'score': rec['total_score'],
                'stage': rec['stage'],
                'next_1d': round(next_1d, 2),
                'next_3d': round(next_3d, 2),
                'next_5d': round(next_5d, 2),
                'max_drawdown_3d': round(max_drawdown, 2),
            })

    # ============================================================
    # [3/4] 统计分析
    # ============================================================
    print(f'\n[3/4] 统计分析（共 {len(all_recs)} 条推荐）...')

    if len(all_recs) < 5:
        print('[warn] 推荐数量太少，统计无意义')
        return

    next_1d_list = [r['next_1d'] for r in all_recs]
    next_3d_list = [r['next_3d'] for r in all_recs]
    next_5d_list = [r['next_5d'] for r in all_recs]
    drawdowns = [r['max_drawdown_3d'] for r in all_recs]

    # 命中率（次日涨）
    hit_1d = sum(1 for x in next_1d_list if x > 0)
    hit_rate_1d = hit_1d / len(next_1d_list)

    # 3天平均涨幅
    avg_3d = mean(next_3d_list)

    # 最大回撤（3天内平均）
    avg_drawdown = mean(drawdowns)

    # 盈亏比
    gains = [x for x in next_3d_list if x > 0]
    losses = [abs(x) for x in next_3d_list if x < 0]
    avg_gain = mean(gains) if gains else 0
    avg_loss = mean(losses) if losses else 1
    profit_loss_ratio = avg_gain / avg_loss if avg_loss > 0 else float('inf')

    # 信号衰减（第1天 vs 第3天 vs 第5天）
    avg_1d = mean(next_1d_list)
    avg_5d = mean(next_5d_list)

    # ============================================================
    # [4/4] 输出报告
    # ============================================================
    print('\n[4/4] 回测报告')
    print('=' * 60)
    print(f'回测区间: {bt_dates[0]} ~ {bt_dates[-1]}')
    print(f'推荐总数: {len(all_recs)}')
    print(f'平均每天推荐: {len(all_recs) / len(bt_dates):.1f} 个')
    print()

    # 评估指标
    checks = [
        ('信号触发次数', f'{len(all_recs)}', '≥ 20', len(all_recs) >= 20),
        ('命中率(次日涨)', f'{hit_rate_1d:.1%}', '> 55%', hit_rate_1d > 0.55),
        ('3天平均涨幅', f'{avg_3d:.2f}%', '> 0.5%', avg_3d > 0.5),
        ('3天最大回撤(均)', f'{avg_drawdown:.2f}%', '< 3%', avg_drawdown > -3),
        ('盈亏比', f'{profit_loss_ratio:.2f}', '> 1.5', profit_loss_ratio > 1.5),
        ('信号衰减', f'{avg_1d:.2f}→{avg_3d/3:.2f}→{avg_5d/5:.2f}', '递减', avg_1d > avg_3d / 3 > avg_5d / 5 if avg_5d != 0 else True),
    ]

    print(f'{"指标":<20s} {"实际":<15s} {"标准":<10s} {"通过":<5s}')
    print('-' * 55)
    for name, actual, standard, passed in checks:
        icon = '✅' if passed else '❌'
        print(f'{name:<20s} {actual:<15s} {standard:<10s} {icon}')

    passed_count = sum(1 for _, _, _, p in checks if p)
    print(f'\n通过 {passed_count}/{len(checks)} 项')

    # 分信号统计
    print('\n--- 分信号统计 ---')
    for signal in ('strong_buy', 'buy'):
        sig_recs = [r for r in all_recs if r['signal'] == signal]
        if not sig_recs:
            continue
        sig_1d = [r['next_1d'] for r in sig_recs]
        sig_3d = [r['next_3d'] for r in sig_recs]
        sig_hit = sum(1 for x in sig_1d if x > 0) / len(sig_1d) if sig_1d else 0
        print(f'  {signal}: {len(sig_recs)}条 命中{sig_hit:.1%} 3日均涨{mean(sig_3d):.2f}%')

    # 分阶段统计
    print('\n--- 分阶段统计 ---')
    stages = set(r['stage'] for r in all_recs)
    for stage in sorted(stages):
        stage_recs = [r for r in all_recs if r['stage'] == stage]
        if not stage_recs:
            continue
        s_1d = [r['next_1d'] for r in stage_recs]
        s_3d = [r['next_3d'] for r in stage_recs]
        s_hit = sum(1 for x in s_1d if x > 0) / len(s_1d) if s_1d else 0
        print(f'  {stage or "无"}: {len(stage_recs)}条 命中{s_hit:.1%} 3日均涨{mean(s_3d):.2f}%')

    print('=' * 60)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='板块评分 v3 回测')
    parser.add_argument('--days', type=int, default=30, help='回测天数（默认30）')
    args = parser.parse_args()
    run_backtest(args.days)
