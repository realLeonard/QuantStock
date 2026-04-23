"""板块生命周期判断 — v3 改造

返回 (stage, coefficient)，引入连板天梯数据。

| 阶段   | 系数 | 判断条件                                          |
|--------|------|---------------------------------------------------|
| 见顶期 | 0.7  | 断板/极度过热/连涨5天+振幅异常/涨>5%但资金流出    |
| 调整期 | 0.8  | 涨停减少无接力/曾活跃+流出下跌/曾活跃+MA空头      |
| 主升期 | 0.9  | 涨停≥3且最高板≥3/5日涨>5%+量放大+连续3天流入      |
| 发酵期 | 1.0  | 涨停增加+出现2板/成交量放大>50%+上涨2-4天          |
| 启动期 | 1.1  | 首板从无到有/MA5刚上穿MA10+量放大/低位整理+向上异动 |
| 吸筹期 | 1.2  | 无涨停+加权打分≥3(流入+位置+振幅+成交)             |
| 观察期 | 1.0  | 默认                                              |
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from utils import mean, match_sector_name

import numpy as np


def _parse_json(val):
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def _extract_limit_stats(limit_up_recent: list[dict], sector_name: str) -> list[dict]:
    """从近N天 limitUpReasons 中提取该板块的涨停统计"""
    stats = []
    for day_data in limit_up_recent:
        themes = _parse_json(day_data.get('themes')) or []
        count = 0
        max_board = 0
        has_2board = False
        top_stock_names = []

        for theme in themes:
            if not match_sector_name(sector_name, theme.get('name', '')):
                continue
            count = theme.get('count', 0)
            for stock in theme.get('stocks', []):
                board_str = stock.get('board', '')
                if '天' in board_str and '板' in board_str:
                    try:
                        boards = int(board_str.split('天')[0])
                        max_board = max(max_board, boards)
                        if boards >= 2:
                            has_2board = True
                        top_stock_names.append(stock.get('name', ''))
                    except ValueError:
                        pass
            break

        stats.append({
            'count': count,
            'max_board': max_board,
            'has_2board': has_2board,
            'top_stocks': top_stock_names,
        })
    return stats


def detect_lifecycle(
    sector_rows: list[dict],
    limit_up_recent: list[dict] | None = None,
    sector_name: str = '',
) -> tuple[str, float]:
    """
    判断板块生命周期阶段。

    参数:
      sector_rows: 该板块最近 N 天 sector_daily，按 trade_date ASC
      limit_up_recent: 近3天 limitUpReasons 列表
      sector_name: 板块名（用于匹配涨停数据）

    返回: (stage: str, coefficient: float)
    """
    if len(sector_rows) < 5:
        return '观察期', 1.0

    today = sector_rows[-1]
    changes = [r.get('change_pct') or 0 for r in sector_rows]
    volumes = [r.get('volume') or 0 for r in sector_rows]
    amplitudes = [r.get('amplitude') or 0 for r in sector_rows]
    closes = [r.get('close') or 0 for r in sector_rows]
    highs = [r.get('high') or 0 for r in sector_rows]
    lows = [r.get('low') or 0 for r in sector_rows]

    today_change = changes[-1]

    # 资金流
    fund_rows = [r for r in sector_rows if r.get('main_net_inflow') is not None]
    recent_fund = fund_rows[-5:] if fund_rows else []

    # 连续流出天数
    consecutive_outflow = 0
    for r in reversed(recent_fund):
        if (r.get('main_net_inflow') or 0) < 0:
            consecutive_outflow += 1
        else:
            break

    # 连续流入天数 + 是否递增
    consecutive_inflow = 0
    inflow_increasing = True
    prev_inflow = None
    for r in reversed(recent_fund):
        inf = r.get('main_net_inflow') or 0
        if inf > 0:
            consecutive_inflow += 1
            if prev_inflow is not None and inf >= prev_inflow:
                inflow_increasing = False
            prev_inflow = inf
        else:
            break

    # 近5日统计
    recent_5_changes = changes[-5:]
    up_days = sum(1 for c in recent_5_changes if c > 0)
    cum_change_5d = sum(recent_5_changes)

    # 成交量变化
    vol_recent_3 = mean(volumes[-3:])
    vol_prev_5 = mean(volumes[-8:-3]) if len(volumes) >= 8 else mean(volumes[:-3]) if len(volumes) > 3 else 0
    vol_expand = (vol_recent_3 / vol_prev_5 - 1) if vol_prev_5 > 0 else 0

    # 振幅
    amp_recent = mean(amplitudes[-3:]) if len(amplitudes) >= 3 else 0
    amp_avg = mean(amplitudes[-20:]) if len(amplitudes) >= 20 else mean(amplitudes) if amplitudes else 0

    # 均线
    ma5 = mean(closes[-5:])
    ma10 = mean(closes[-10:]) if len(closes) >= 10 else mean(closes)

    # 20日高点
    high_20d = max(highs[-20:]) if len(highs) >= 20 else max(highs) if highs else 0
    low_20d = min(lows[-20:]) if len(lows) >= 20 else min(lows) if lows else 0
    price_range = high_20d - low_20d
    position = (closes[-1] - low_20d) / price_range if price_range > 0 else 0.5

    # 涨跌停数据
    limit_stats = _extract_limit_stats(limit_up_recent or [], sector_name)
    today_stat = limit_stats[-1] if limit_stats else {'count': 0, 'max_board': 0, 'has_2board': False, 'top_stocks': []}
    yesterday_stat = limit_stats[-2] if len(limit_stats) >= 2 else {'count': 0, 'max_board': 0, 'has_2board': False, 'top_stocks': []}
    day_before_stat = limit_stats[-3] if len(limit_stats) >= 3 else {'count': 0, 'max_board': 0, 'has_2board': False, 'top_stocks': []}

    # 成交额中位数（全市场判断需外部传入，这里用板块自身）
    turnovers = [r.get('turnover') or 0 for r in sector_rows]
    turnover_median = float(np.median(turnovers)) if turnovers else 0

    # ============ 判断逻辑（按优先级从高到低）============

    # ---- 见顶期 (0.7) ----
    # ①最高板断板
    has_broken_leader = False
    if yesterday_stat['max_board'] >= 2:
        yesterday_top_stocks = set(yesterday_stat['top_stocks'])
        today_stocks = set(today_stat['top_stocks'])
        if yesterday_top_stocks and not yesterday_top_stocks.issubset(today_stocks):
            has_broken_leader = True

    if has_broken_leader:
        return '见顶期', 0.7

    # ②涨停数连续2天增+最高板≥5（高潮末期）
    if (len(limit_stats) >= 3
            and day_before_stat['count'] < yesterday_stat['count']
            and yesterday_stat['count'] < today_stat['count']
            and today_stat['max_board'] >= 5):
        return '见顶期', 0.7

    # ③连涨5天+振幅>均值2倍
    consecutive_up = 0
    for c in reversed(changes):
        if c > 0:
            consecutive_up += 1
        else:
            break
    if consecutive_up >= 5 and amp_avg > 0 and amp_recent > amp_avg * 2:
        return '见顶期', 0.7

    # ④涨>5%但资金流出
    if today_change > 5 and recent_fund and (recent_fund[-1].get('main_net_inflow') or 0) < 0:
        return '见顶期', 0.7

    # ---- 调整期 (0.8) ----
    # 前置：近10日收盘价曾到过20日区间60%以上（证明之前涨过）
    recent_10_closes = closes[-10:]
    peak_position = (max(recent_10_closes) - low_20d) / price_range if price_range > 0 else 0.5
    was_active = peak_position > 0.6

    # ①涨停数减少+无新首板接力（自带活跃证据，不需要 was_active）
    if (yesterday_stat['count'] > 0
            and today_stat['count'] < yesterday_stat['count']
            and today_stat['count'] == 0):
        return '调整期', 0.8

    # ②连续2天流出+近5日涨幅<0（需证明之前活跃过）
    if was_active and consecutive_outflow >= 2 and cum_change_5d < 0:
        return '调整期', 0.8

    # ③跌破MA5且MA5<MA10（需证明之前活跃过）
    if was_active and closes[-1] < ma5 and ma5 < ma10:
        return '调整期', 0.8

    # ---- 主升期 (0.9) ----
    # ①涨停数≥3且最高板≥3
    if today_stat['count'] >= 3 and today_stat['max_board'] >= 3:
        return '主升期', 0.9

    # ②5日涨>5%+量能放大+连续3天流入
    if cum_change_5d > 5 and vol_expand > 0.3 and consecutive_inflow >= 3:
        return '主升期', 0.9

    # ---- 发酵期 (1.0) ----
    # ①涨停数增加+出现2板
    if today_stat['count'] > yesterday_stat['count'] and today_stat['has_2board']:
        return '发酵期', 1.0

    # ②成交量放大>50%+上涨2-4天
    if vol_expand > 0.5 and 2 <= up_days <= 4:
        return '发酵期', 1.0

    # ---- 启动期 (1.1) ----
    # ①首板从无到有
    if yesterday_stat['count'] == 0 and today_stat['count'] >= 1:
        return '启动期', 1.1

    # ②MA5刚上穿MA10+量能放大
    if len(closes) >= 11:
        prev_ma5 = mean(closes[-6:-1])
        prev_ma10 = mean(closes[-11:-1])
        if prev_ma5 <= prev_ma10 and ma5 > ma10 and vol_expand > 0.2:
            return '启动期', 1.1

    # ③低位整理后向上异动
    ma5_position = (mean(closes[-5:]) - low_20d) / price_range if price_range > 0 else 0.5
    amp_5d = mean(amplitudes[-5:]) if len(amplitudes) >= 5 else amp_recent
    amp_converging = amp_5d < amp_avg * 0.7 if amp_avg > 0 else False
    if (ma5_position < 0.4
            and amp_converging
            and today_change > 1
            and vol_expand > 0.2):
        return '启动期', 1.1

    # ---- 吸筹期 (1.2) ----
    # 无涨停为前提，其余条件加权打分≥3分
    if today_stat['count'] == 0:
        absorb_score = 0
        # 资金连续流入（2天+1，3天+2）
        if consecutive_inflow >= 3:
            absorb_score += 2
        elif consecutive_inflow >= 2:
            absorb_score += 1
        # 流入递增
        if inflow_increasing and consecutive_inflow >= 3:
            absorb_score += 1
        # 价格中低位
        if 0.25 <= position <= 0.65:
            absorb_score += 1
        # 振幅收敛
        amp_conv = amp_recent < amp_avg * 0.8 if amp_avg > 0 else False
        if amp_conv:
            absorb_score += 1
        # 成交活跃
        today_turnover = turnovers[-1] if turnovers else 0
        if today_turnover > turnover_median * 0.8:
            absorb_score += 1
        if absorb_score >= 3:
            return '吸筹期', 1.2

    # ---- 观察期 (1.0) ----
    return '观察期', 1.0
