"""板块生命周期判断

基于近 5-10 天 sector_daily + 涨停数据判断板块所处阶段。

| 阶段 | 判断条件 |
|------|----------|
| 萌芽 | 涨停≤2 且 主力刚转为净流入 且 涨幅<2% |
| 发酵 | 涨停3-5 且 成交量放大>50% 且 连涨2-3天 |
| 主升 | 涨停>5 或 板块涨幅>5% 且 成交额创近期新高 |
| 分歧 | 龙头炸板 或 振幅>5% 且 换手率骤增 |
| 退潮 | 连续2天主力净流出 且 涨幅回落 且 连板股断板 |
"""

from __future__ import annotations


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def detect_lifecycle(
    sector_rows: list[dict],
    sector_limit_count: int = 0,
    max_board: int = 0,
    has_broken_leader: bool = False,
) -> str:
    """
    判断板块生命周期阶段。

    参数:
      sector_rows: 该板块最近 10 天 sector_daily 记录，按 trade_date ASC
      sector_limit_count: 该板块今日涨停数
      max_board: 该板块最高连板数
      has_broken_leader: 龙头是否炸板（暂不判断，预留）

    返回: '萌芽' / '发酵' / '主升' / '分歧' / '退潮'
    """
    if len(sector_rows) < 3:
        return '萌芽'

    today = sector_rows[-1]
    changes = [r.get('change_pct') or 0.0 for r in sector_rows]
    volumes = [r.get('volume') or 0 for r in sector_rows]
    turnovers = [r.get('turnover') or 0.0 for r in sector_rows]
    amplitudes = [r.get('amplitude') or 0.0 for r in sector_rows]
    turnover_rates = [r.get('turnover_rate') or 0.0 for r in sector_rows]

    today_change = changes[-1]
    today_amp = amplitudes[-1] if amplitudes else 0
    today_turnover_rate = turnover_rates[-1] if turnover_rates else 0

    # 资金流（可能为 None）
    fund_rows = [r for r in sector_rows if r.get('main_net_inflow') is not None]
    recent_fund = fund_rows[-3:] if fund_rows else []

    # 近5日统计
    recent_5_changes = changes[-5:]
    up_days = sum(1 for c in recent_5_changes if c > 0)
    cum_change_5d = sum(recent_5_changes)

    # 成交量变化
    vol_recent_3 = _mean(volumes[-3:])
    vol_prev_5 = _mean(volumes[-8:-3]) if len(volumes) >= 8 else _mean(volumes[:-3]) if len(volumes) > 3 else 0
    vol_expand = (vol_recent_3 / vol_prev_5 - 1) if vol_prev_5 > 0 else 0

    # 成交额是否创��期新高
    turnover_max_10d = max(turnovers[-10:]) if len(turnovers) >= 10 else max(turnovers) if turnovers else 0
    turnover_today = turnovers[-1] if turnovers else 0

    # 换手率变化
    tr_recent = _mean(turnover_rates[-2:])
    tr_prev = _mean(turnover_rates[-5:-2]) if len(turnover_rates) >= 5 else _mean(turnover_rates[:-2]) if len(turnover_rates) > 2 else 0

    # 连续资金流出天数
    consecutive_outflow = 0
    for r in reversed(recent_fund):
        if (r.get('main_net_inflow') or 0) < 0:
            consecutive_outflow += 1
        else:
            break

    # ---- 退潮 ----
    if (consecutive_outflow >= 2
            and today_change < 0
            and up_days <= 2):
        return '退潮'

    # ---- 分歧 ----
    if today_amp > 5 and tr_recent > tr_prev * 1.5 and tr_prev > 0:
        return '分歧'
    if has_broken_leader:
        return '分歧'

    # ---- 主升 ----
    if sector_limit_count > 5 or (cum_change_5d > 5 and turnover_today >= turnover_max_10d * 0.9):
        return '主升'

    # ---- 发酵 ----
    if (3 <= sector_limit_count <= 5
            or (vol_expand > 0.5 and 2 <= up_days <= 4)):
        return '发酵'

    # ---- 萌芽 ----
    if (sector_limit_count <= 2
            and 0 < today_change < 2
            and len(recent_fund) >= 1
            and (recent_fund[-1].get('main_net_inflow') or 0) > 0):
        return '萌芽'

    # 默认：无法判断阶段
    return ''
