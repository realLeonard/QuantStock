"""资金面评分（权重 30%）

子因子：
  1. 当日主力净流入排名（百分位） — 30分
  2. 3日主力净流入趋势            — 25分
  3. 主力净流入占比                — 20分
  4. 超大单占比                    — 15分
  5. 连续流入天数                  — 10分
"""

from __future__ import annotations


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _percentile_score(value: float, all_values: list[float], max_pts: float) -> float:
    """在 all_values 中的百分位，映射到 0~max_pts"""
    if not all_values:
        return 0.0
    below = sum(1 for v in all_values if v < value)
    pct = below / len(all_values)  # 0~1
    return pct * max_pts


def calc_fund_score(
    rows: list[dict],
    all_today_inflows: list[float],
    all_today_trends: list[float] | None = None,
) -> tuple[float, dict]:
    """
    计算单板块资金面评分。

    参数:
      rows: 该板块最近 N 天的 sector_daily 记录，按 trade_date ASC 排序
      all_today_inflows: 全市场当日主力净流入列表（用于百分位排名）

    返回: (score: 0-100, detail: dict)
    """
    if not rows:
        return 0.0, {}

    today = rows[-1]

    # ---- 子因子 1：当日主力净流入排名（30分）----
    today_inflow = today.get('main_net_inflow') or 0.0
    rank_score = _percentile_score(today_inflow, all_today_inflows, 30)

    # ---- 子因子 2：3日主力净流入趋势（25分）----
    # 只取有资金流数据的天
    fund_rows = [r for r in rows if r.get('main_net_inflow') is not None]
    recent_fund = fund_rows[-3:] if len(fund_rows) >= 3 else fund_rows
    weights = [0.2, 0.3, 0.5]

    if len(recent_fund) >= 3:
        weighted_sum = sum(
            (r.get('main_net_inflow') or 0.0) * w
            for r, w in zip(recent_fund[-3:], weights)
        )
    elif len(recent_fund) == 2:
        weighted_sum = (
            (recent_fund[0].get('main_net_inflow') or 0.0) * 0.4
            + (recent_fund[1].get('main_net_inflow') or 0.0) * 0.6
        )
    elif len(recent_fund) == 1:
        weighted_sum = recent_fund[0].get('main_net_inflow') or 0.0
    else:
        weighted_sum = 0.0

    # 趋势分：用百分位排名而非绝对值（避免大小盘差异）
    # 需要与全市场同口径的3日加权趋势做比较
    if weighted_sum > 0 and all_today_trends:
        trend_score = _percentile_score(weighted_sum, all_today_trends, 25)
    elif weighted_sum > 0:
        # 无全市场趋势数据时，用当日流入列表做近似
        trend_score = _percentile_score(weighted_sum, all_today_inflows, 25)
    else:
        trend_score = 0.0

    # ---- 子因子 3：主力净流入占比（20分）----
    inflow_pct = today.get('main_net_inflow_pct') or 0.0
    # >5% 满分
    pct_score = _clamp(inflow_pct / 5.0 * 20, 0, 20)

    # ---- 子因子 4：超大单净流入占比（15分）----
    # 只有净流入才加分，净流出不得分
    super_large = today.get('super_large_net') or 0.0
    turnover = today.get('turnover') or 1.0
    if turnover > 0 and super_large > 0:
        sl_ratio = super_large / turnover * 100
        sl_score = _clamp(sl_ratio / 3.0 * 15, 0, 15)
    else:
        sl_score = 0.0

    # ---- 子因子 5：连续流入天数（10分）----
    consecutive_inflow = 0
    for r in reversed(fund_rows):
        if (r.get('main_net_inflow') or 0.0) > 0:
            consecutive_inflow += 1
        else:
            break
    cont_score = _clamp(consecutive_inflow * 2, 0, 10)

    # 额外统计：连续流出天数（供风险识别使用）
    consecutive_outflow = 0
    for r in reversed(fund_rows):
        if (r.get('main_net_inflow') or 0.0) < 0:
            consecutive_outflow += 1
        else:
            break

    total = rank_score + trend_score + pct_score + sl_score + cont_score

    detail = {
        'rank': round(rank_score, 1),
        'trend_3d': round(trend_score, 1),
        'inflow_pct': round(pct_score, 1),
        'super_large': round(sl_score, 1),
        'consecutive': round(cont_score, 1),
        'raw_inflow': round(today_inflow, 0),
        'raw_inflow_pct': round(inflow_pct, 2),
        'consecutive_days': consecutive_inflow,
        'consecutive_outflow_days': consecutive_outflow,
    }

    return round(_clamp(total), 2), detail
