"""资金暗流评分（权重 30%，满分100）

核心："暗"= 资金流入排名高但涨幅排名低。

子因子：
  A. 渐进式流入（40分）— 连续正流入、流入递增趋势
  B. 大单暗涌（30分）— 大单占比高但价格没大动
  C. 散户反向（30分）— 主力进散户跑

隐蔽度修正：stealth_gap = 资金流入百分位 - 涨幅百分位
  gap > 30 → ×1.2（资金在暗中吸筹）
  gap < 0  → ×0.5（资金和涨幅同步，已被发现）
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import clamp, mean, percentile_rank


def calc_fund_stealth_score(
    rows: list[dict],
    all_today_inflows: list[float],
) -> tuple[float, dict]:
    """
    计算单板块资金暗流评分。

    参数:
      rows: 该板块最近 N 天 sector_daily，按 trade_date ASC
      all_today_inflows: 全市场当日主力净流入列表

    返回: (score: 0-100, detail: dict)
    """
    if len(rows) < 5:
        return 0.0, {'reason': '数据不足'}

    # 只取有资金流数据的天
    fund_rows = [r for r in rows if r.get('main_net_inflow') is not None]
    if len(fund_rows) < 3:
        return 0.0, {'reason': f'资金流数据不足（{len(fund_rows)}/3天）'}

    today = rows[-1]
    recent_10 = fund_rows[-10:]

    # ---- 隐蔽度计算 ----
    today_inflow = today.get('main_net_inflow') or 0.0
    today_change = today.get('change_pct') or 0.0

    inflow_pctile = percentile_rank(today_inflow, all_today_inflows)
    # 全市场涨幅百分位
    all_changes = [r.get('change_pct', 0) for r in rows[-1:]]  # 当日涨幅在全市场中的位置由外部隐含
    # 用资金百分位 - 涨幅映射来近似
    # 涨幅映射：涨幅 > 3% → 百分位约 80+
    change_pctile = min(max(today_change * 15 + 50, 0), 100)  # 粗略映射
    stealth_gap = inflow_pctile - change_pctile

    if stealth_gap > 30:
        stealth_coeff = 1.2
    elif stealth_gap > 10:
        stealth_coeff = 1.0
    elif stealth_gap > 0:
        stealth_coeff = 0.8
    else:
        stealth_coeff = 0.5

    # ---- 子因子A：渐进式流入（40分）----
    consecutive_positive = 0
    for r in reversed(recent_10):
        if (r.get('main_net_inflow') or 0) > 0:
            consecutive_positive += 1
        else:
            break

    # 基础分：连续正流入 ≥ 3天起步20分，每多1天+4
    if consecutive_positive >= 3:
        gradual_base = min(20 + (consecutive_positive - 3) * 4, 40)
    else:
        gradual_base = consecutive_positive * 5  # 0/5/10

    # 单日流入量 > 全市场P80 → 系数×0.5（已被发现）
    p80 = sorted(all_today_inflows)[int(len(all_today_inflows) * 0.8)] if len(all_today_inflows) > 5 else float('inf')
    if today_inflow > p80:
        gradual_base *= 0.5

    # 流入递增趋势：后3天均值 > 前3天均值 × 1.2
    trend_bonus = 0
    if len(recent_10) >= 6:
        inflows = [(r.get('main_net_inflow') or 0) for r in recent_10]
        later_3 = mean(inflows[-3:])
        earlier_3 = mean(inflows[-6:-3])
        if earlier_3 > 0 and later_3 > earlier_3 * 1.2:
            trend_bonus = 10
        elif earlier_3 > 0 and later_3 > earlier_3:
            trend_bonus = 5

    gradual_score = clamp(gradual_base + trend_bonus, 0, 40)

    # ---- 子因子B：大单暗涌（30分）----
    dark_days = 0
    recent_5 = fund_rows[-5:]
    big_ratios = []

    for r in recent_5:
        super_large = r.get('super_large_net') or 0.0
        large = r.get('large_net') or 0.0
        turnover = r.get('turnover') or 1.0
        change = r.get('change_pct') or 0.0

        if turnover > 0:
            big_ratio = (super_large + large) / turnover * 100  # 百分比
            big_ratios.append(big_ratio)
        else:
            big_ratio = 0

        # 大单在进 且 价格没大动
        if big_ratio > 0.5 and -1 <= change <= 2:
            dark_days += 1

    dark_score_base = clamp(dark_days * 6, 0, 30)

    # 大单净流入占比5日均值 > 2% → 额外+5
    avg_big_ratio = mean(big_ratios) if big_ratios else 0
    dark_bonus = 5 if avg_big_ratio > 2 else 0
    dark_score = clamp(dark_score_base + dark_bonus, 0, 30)

    # ---- 子因子C：散户反向（30分）----
    retail_reverse_days = 0
    for r in recent_5:
        small_net = r.get('small_net') or 0.0
        main_inflow = r.get('main_net_inflow') or 0.0
        if small_net < 0 and main_inflow > 0:
            retail_reverse_days += 1

    retail_score = clamp(retail_reverse_days * 6, 0, 30)

    # 汇总 + 隐蔽度修正
    raw_total = gradual_score + dark_score + retail_score
    total = clamp(raw_total * stealth_coeff, 0, 100)

    detail = {
        'gradual': round(gradual_score, 1),
        'dark_flow': round(dark_score, 1),
        'retail_reverse': round(retail_score, 1),
        'stealth_gap': round(stealth_gap, 1),
        'stealth_coeff': stealth_coeff,
        'fund_days': len(fund_rows),
        'consecutive_positive_days': consecutive_positive,
        'trend_bonus': trend_bonus,
        'dark_days': dark_days,
        'retail_reverse_days': retail_reverse_days,
        'raw_inflow': round(today_inflow, 0),
    }

    return round(total, 2), detail
