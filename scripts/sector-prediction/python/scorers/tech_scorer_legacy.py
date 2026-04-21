"""技术面评分（权重 15%）

子因子：
  1. MA5/MA10 位置 — 25分
  2. 5日动量       — 25分
  3. 振幅收敛      — 20分
  4. 距20日低点    — 15分
  5. 量能配合      — 15分
"""

from __future__ import annotations


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def calc_tech_score(rows: list[dict]) -> tuple[float, dict]:
    """
    计算单板块技术面评分。

    参数:
      rows: 该板块最近 20 天的 sector_daily 记录，按 trade_date ASC 排序

    返回: (score: 0-100, detail: dict)
    """
    if len(rows) < 5:
        return 0.0, {'reason': '数据不足5天'}

    closes = [r.get('close') or 0.0 for r in rows]
    volumes = [r.get('volume') or 0 for r in rows]
    amplitudes = [r.get('amplitude') or 0.0 for r in rows]
    today_close = closes[-1]

    # ---- 子因子 1：MA5/MA10 位置（25分）----
    ma5 = _mean(closes[-5:])
    ma10 = _mean(closes[-10:]) if len(closes) >= 10 else _mean(closes)

    if today_close > ma5 > ma10:
        ma_score = 25.0  # 多头排列
    elif today_close > ma5:
        ma_score = 18.0  # 站上 MA5
    elif today_close > ma10:
        ma_score = 12.0  # 站上 MA10
    elif today_close > ma5 * 0.98:
        ma_score = 6.0   # 接近 MA5
    else:
        ma_score = 0.0

    # ---- 子因子 2：5日动量（25分）----
    close_5d_ago = closes[-5] if len(closes) >= 5 else closes[0]
    if close_5d_ago > 0:
        momentum_5d = (today_close - close_5d_ago) / close_5d_ago * 100  # 百分比
    else:
        momentum_5d = 0.0
    # 0-5% 线性映射到 0-25，>5% 满分，<0 为 0
    momentum_score = _clamp(momentum_5d / 5.0 * 25, 0, 25)

    # ---- 子因子 3：振幅收敛（20分）----
    amp_5d = _mean(amplitudes[-5:])
    amp_20d = _mean(amplitudes[-20:]) if len(amplitudes) >= 20 else _mean(amplitudes)

    if amp_20d > 0:
        amp_ratio = amp_5d / amp_20d
        # 收敛 = 5日振幅 < 20日均值 → 蓄势待发
        # ratio ≤ 0.6 满分, 0.6-1.2 线性递减, > 1.2 低分
        if amp_ratio <= 0.6:
            amp_score = 20.0
        elif amp_ratio <= 1.2:
            amp_score = 20.0 * (1.2 - amp_ratio) / 0.6
        else:
            amp_score = 0.0
    else:
        amp_score = 10.0  # 无振幅数据给中间分

    # ---- 子因子 4：距20日低点位置（15分）----
    low_20d = min(closes[-20:]) if len(closes) >= 20 else min(closes)
    high_20d = max(closes[-20:]) if len(closes) >= 20 else max(closes)
    price_range = high_20d - low_20d

    if price_range > 0:
        position = (today_close - low_20d) / price_range  # 0~1
        # 0.2-0.6 得分最高（底部起飞区间）
        if 0.2 <= position <= 0.6:
            pos_score = 15.0
        elif position < 0.2:
            pos_score = position / 0.2 * 12  # 太底部可能还在跌
        else:
            # 0.6-1.0：越高越少分
            pos_score = max(0, 15 - (position - 0.6) / 0.4 * 15)
    else:
        pos_score = 7.5

    # ---- 子因子 5：量能配合（15分）----
    vol_3d = _mean(volumes[-3:])
    vol_10d = _mean(volumes[-10:]) if len(volumes) >= 10 else _mean(volumes)

    if vol_10d > 0:
        vol_ratio = vol_3d / vol_10d
        # 1.2-2.0 满分，<1 低分，>3 过热
        if 1.2 <= vol_ratio <= 2.0:
            vol_score = 15.0
        elif vol_ratio < 1.2:
            vol_score = max(0, vol_ratio / 1.2 * 12)
        else:
            vol_score = max(0, 15 - (vol_ratio - 2.0) * 5)
    else:
        vol_score = 0.0

    total = ma_score + momentum_score + amp_score + pos_score + vol_score

    detail = {
        'ma_position': round(ma_score, 1),
        'momentum_5d': round(momentum_score, 1),
        'amplitude': round(amp_score, 1),
        'low_position': round(pos_score, 1),
        'volume': round(vol_score, 1),
        'raw_ma5': round(ma5, 2),
        'raw_ma10': round(ma10, 2),
        'raw_momentum_pct': round(momentum_5d, 2),
        'raw_vol_ratio': round(vol_3d / vol_10d, 2) if vol_10d > 0 else 0,
    }

    return round(_clamp(total), 2), detail
