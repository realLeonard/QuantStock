"""模式匹配评分（权重 20%，满分100）

核心：跨板块匹配。在全市场其他板块历史中找相似模式，看后续走势。

子因子：
  A. 资金流模式（50分）— 近3天 main_net_inflow_pct 符号序列 → 匹配后3天涨幅
  B. 量价形态（50分）— 近3天量价状态序列 → 匹配后3天涨幅 + 预定义强势模式加分

关键约束：
  - 排除自身：匹配池中剔除当前板块
  - 最小匹配数 ≥ 10
  - 3天窗口：2^3=8种资金模式，4^3=64种量价模式
"""

from __future__ import annotations

import sys
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import clamp, mean


def _get_flow_sign(pct: float) -> str:
    """资金流入百分比 → 符号"""
    return '+' if pct > 0 else '-'


def _get_vol_price_state(row: dict, vol_ma10: float) -> str:
    """根据量和价归类为4种状态之一"""
    vol = row.get('volume') or 0
    change = row.get('change_pct') or 0

    vol_tag = 'H' if vol > vol_ma10 else 'L'  # High/Low volume
    price_tag = 'U' if change > 0 else 'D'      # Up/Down price
    return vol_tag + price_tag


def _build_pattern_index(
    grouped: dict[str, list[dict]],
    today: str,
    window_size: int = 3,
    lookahead: int = 3,
) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    """
    预计算所有板块的模式索引。

    返回:
      flow_index: {flow_pattern_key: [{sector_name, future_change, ...}]}
      vol_index: {vol_pattern_key: [{sector_name, future_change, ...}]}
    """
    flow_index: dict[str, list[dict]] = defaultdict(list)
    vol_index: dict[str, list[dict]] = defaultdict(list)

    for name, rows in grouped.items():
        if len(rows) < window_size + lookahead + 10:
            continue

        # 计算每天的10日均量
        volumes = [r.get('volume') or 0 for r in rows]

        # 滑窗（不包含最后 window_size 天——那是"今天"的窗口，留给匹配用）
        # 严格限制：只用 today 之前的数据
        date_idx = {r['trade_date']: i for i, r in enumerate(rows)}
        end_idx = date_idx.get(today)
        if end_idx is None:
            # 没有 today 数据，用最后一条
            end_idx = len(rows)

        for i in range(10, end_idx - lookahead):
            window = rows[i:i + window_size]
            future = rows[i + window_size:i + window_size + lookahead]

            if len(window) < window_size or len(future) < lookahead:
                continue

            # 资金流模式
            flow_signs = []
            has_flow = True
            for r in window:
                pct = r.get('main_net_inflow_pct')
                if pct is None:
                    has_flow = False
                    break
                flow_signs.append(_get_flow_sign(pct))

            if has_flow:
                flow_key = ''.join(flow_signs)
                future_change = sum(r.get('change_pct') or 0 for r in future)
                flow_index[flow_key].append({
                    'sector_name': name,
                    'future_change': future_change,
                    'date': window[0]['trade_date'],
                })

            # 量价模式
            vol_ma10 = mean(volumes[max(0, i-10):i]) if i >= 10 else mean(volumes[:i]) if i > 0 else 1
            vol_states = [_get_vol_price_state(r, vol_ma10) for r in window]
            vol_key = ''.join(vol_states)
            future_change = sum(r.get('change_pct') or 0 for r in future)
            vol_index[vol_key].append({
                'sector_name': name,
                'future_change': future_change,
                'date': window[0]['trade_date'],
            })

    return flow_index, vol_index


def _detect_strong_patterns(rows: list[dict]) -> float:
    """
    检测预定义强势模式（用完整5天判定，直接加分）。
    返回额外加分 0~5。
    """
    if len(rows) < 5:
        return 0

    recent_5 = rows[-5:]
    volumes = [r.get('volume') or 0 for r in rows]
    vol_ma10 = mean(volumes[-15:-5]) if len(volumes) >= 15 else mean(volumes[:-5]) if len(volumes) > 5 else 1

    states = []
    for r in recent_5:
        vol = r.get('volume') or 0
        change = r.get('change_pct') or 0
        v = 'H' if vol > vol_ma10 else 'L'
        p = 'U' if change > 0 else 'D'
        states.append(v + p)

    pattern = ''.join(states)

    # V型启动：缩量跌→缩量跌→缩量涨→放量涨→放量涨
    if pattern == 'LDLDLUHUHU':
        return 5
    # 蓄势突破：缩量涨×4→放量涨
    if pattern == 'LULULULUHU':
        return 5
    # 放量涨×5 → 上限30分（在主评分中通过降分处理，这里不加分）
    if pattern == 'HUHUHUHUHU':
        return 0

    return 0


def calc_pattern_score(
    sector_name: str,
    rows: list[dict],
    grouped: dict[str, list[dict]],
    today: str,
) -> tuple[float, dict]:
    """
    计算单板块模式匹配评分。

    参数:
      sector_name: 当前板块名
      rows: 该板块最近 N 天 sector_daily
      grouped: 全市场 {板块名: [sector_daily]}
      today: 评分日期

    返回: (score: 0-100, detail: dict)
    """
    window_size = 3
    min_matches = 10

    if len(rows) < window_size + 10:
        return 0.0, {'reason': '数据不足'}

    # 构建全市场模式索引
    flow_index, vol_index = _build_pattern_index(grouped, today, window_size)

    # 当前板块的模式
    recent = rows[-window_size:]

    # ---- 子因子A：资金流模式（50分）----
    flow_signs = []
    has_flow = True
    for r in recent:
        pct = r.get('main_net_inflow_pct')
        if pct is None:
            has_flow = False
            break
        flow_signs.append(_get_flow_sign(pct))

    flow_score = 0.0
    flow_matches = 0
    flow_avg_change = 0.0

    if has_flow:
        flow_key = ''.join(flow_signs)
        all_matches = flow_index.get(flow_key, [])
        # 排除自身
        matches = [m for m in all_matches if m['sector_name'] != sector_name]
        flow_matches = len(matches)

        if flow_matches >= min_matches:
            flow_avg_change = mean([m['future_change'] for m in matches])
            if flow_avg_change > 2:
                flow_score = 50
            elif flow_avg_change > 1:
                flow_score = 35
            elif flow_avg_change > 0:
                flow_score = 20
            else:
                flow_score = 0

    # ---- 子因子B：量价形态（50分）----
    volumes_all = [r.get('volume') or 0 for r in rows]
    vol_ma10 = mean(volumes_all[-13:-3]) if len(volumes_all) >= 13 else mean(volumes_all[:-3]) if len(volumes_all) > 3 else 1
    vol_states = [_get_vol_price_state(r, vol_ma10) for r in recent]
    vol_key = ''.join(vol_states)

    all_vol_matches = vol_index.get(vol_key, [])
    vol_matches_filtered = [m for m in all_vol_matches if m['sector_name'] != sector_name]
    vol_match_count = len(vol_matches_filtered)

    if vol_match_count >= min_matches:
        vol_avg_change = mean([m['future_change'] for m in vol_matches_filtered])
        if vol_avg_change > 2:
            vol_score = 50
        elif vol_avg_change > 1:
            vol_score = 35
        elif vol_avg_change > 0:
            vol_score = 20
        else:
            vol_score = 0
    else:
        vol_score = 0
        vol_avg_change = 0

    # 预定义强势模式额外加分
    strong_bonus = _detect_strong_patterns(rows)

    total = clamp(flow_score + vol_score + strong_bonus, 0, 100)

    detail = {
        'flow_pattern': round(flow_score, 1),
        'vol_pattern': round(vol_score, 1),
        'strong_bonus': strong_bonus,
        'flow_key': ''.join(flow_signs) if has_flow else 'N/A',
        'vol_key': vol_key,
        'flow_matches': flow_matches,
        'vol_matches': vol_match_count,
        'flow_avg_future': round(flow_avg_change, 2),
        'vol_avg_future': round(vol_avg_change, 2),
    }

    return round(total, 2), detail
