"""量价蓄势评分（权重 25%，满分100）

子因子：
  A. 底部量能变化（30分）— 温和放量得高分，过热减分
  B. 振幅收敛 + 价格位置（30分）— 收敛+上沿=即将突破
  C. 均线即将金叉（20分）— MA5即将上穿MA10
  D. 突破前夜（20分）— 接近20日新高
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import clamp, mean


def calc_momentum_score(rows: list[dict]) -> tuple[float, dict]:
    """
    计算单板块量价蓄势评分。

    参数:
      rows: 该板块最近 N 天 sector_daily，按 trade_date ASC（至少20天）

    返回: (score: 0-100, detail: dict)
    """
    if len(rows) < 20:
        return 0.0, {'reason': '数据不足（需20天）'}

    closes = [r.get('close') or 0 for r in rows]
    volumes = [r.get('volume') or 0 for r in rows]
    highs = [r.get('high') or 0 for r in rows]
    lows = [r.get('low') or 0 for r in rows]
    amplitudes = [r.get('amplitude') or 0 for r in rows]

    today_close = closes[-1]
    if today_close == 0:
        return 0.0, {'reason': '收盘价为0'}

    # ---- 子因子A：底部量能变化（30分）----
    vol_later_10 = mean(volumes[-10:])
    vol_earlier_10 = mean(volumes[-20:-10])

    if vol_earlier_10 > 0:
        vol_ratio = vol_later_10 / vol_earlier_10
    else:
        vol_ratio = 1.0

    # 价格位置：判断是否在低位
    high_20d = max(highs[-20:])
    low_20d = min(lows[-20:])
    price_range = high_20d - low_20d
    position = (today_close - low_20d) / price_range if price_range > 0 else 0.5

    if 1.0 < vol_ratio <= 1.3:
        vol_score = 15  # 温和放量
    elif 1.3 < vol_ratio <= 1.8:
        vol_score = 30  # 明显放量不过热
    elif vol_ratio > 1.8:
        vol_score = 20  # 过热减分
    else:
        vol_score = 5   # 缩量

    # 价格不在低位 → 减分
    if position > 0.6:
        vol_score *= 0.5

    vol_score = clamp(vol_score, 0, 30)

    # ---- 子因子B：振幅收敛 + 价格位置（30分）----
    amp_5d = mean(amplitudes[-5:])
    amp_20d = mean(amplitudes[-20:])
    convergence_ratio = amp_5d / amp_20d if amp_20d > 0 else 1.0

    if convergence_ratio < 0.7:
        # 收敛
        if position > 0.6:
            conv_score = 30  # 收敛+上沿=即将突破
        elif 0.3 <= position <= 0.6:
            conv_score = 20  # 收敛+中部
        else:
            conv_score = 15  # 收敛+下沿
    elif convergence_ratio <= 1.0:
        conv_score = 10  # 轻微收敛
    else:
        conv_score = 5   # 发散（分歧）

    # ---- 子因子C：均线即将金叉（20分）----
    ma5 = mean(closes[-5:])
    ma10 = mean(closes[-10:])
    gap_pct = (ma5 - ma10) / ma10 * 100 if ma10 > 0 else 0

    if ma5 < ma10 and gap_pct > -0.5:
        ma_score = 20  # 即将金叉（最佳预测点）
    elif ma5 > ma10 and gap_pct < 1:
        ma_score = 10  # 刚金叉
    elif ma5 > ma10:
        ma_score = 5   # 已多头排列
    else:
        ma_score = 0   # 离金叉远

    # ---- 子因子D：突破前夜（20分）----
    if today_close >= high_20d * 0.98:
        breakout_score = 20
    elif today_close >= high_20d * 0.95:
        breakout_score = 15
    elif today_close >= high_20d * 0.90:
        breakout_score = 8
    else:
        breakout_score = 0

    total = vol_score + conv_score + ma_score + breakout_score

    detail = {
        'volume_change': round(vol_score, 1),
        'convergence': round(conv_score, 1),
        'ma_cross': round(ma_score, 1),
        'breakout': round(breakout_score, 1),
        'vol_ratio': round(vol_ratio, 2),
        'convergence_ratio': round(convergence_ratio, 2),
        'position': round(position, 2),
        'ma5_ma10_gap_pct': round(gap_pct, 2),
        'close_vs_high20d': round(today_close / high_20d, 3) if high_20d > 0 else 0,
    }

    return round(clamp(total), 2), detail
