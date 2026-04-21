"""风险修正（-5 ~ 0）

每条 -1~-2 分，累计最多 -5。

检查项：
  1. 连续上涨 > 5天 → -2（追高风险）
  2. 振幅 > 5% 且换手率骤增 > 1.5倍 → -2（分歧加剧）
  3. 资金连续流出 ≥ 2天 → -1
  4. 今日涨幅 > 5% → -2（大涨后回调概率高）
  5. 最高板断板 → -2（退潮信号）
  6. 涨停数连续2天增加 + 最高板≥5 → -1（极度过热）
  7. 板块跌停家数 > 0 → -1（内部恐慌）
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import clamp, mean, match_sector_name


def _parse_json(val):
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def calc_risk_adjustment(
    rows: list[dict],
    limit_up_recent: list[dict],
    sector_name: str,
) -> tuple[float, dict]:
    """
    计算风险修正分。

    参数:
      rows: 该板块 sector_daily，按 trade_date ASC
      limit_up_recent: 近3天 limitUpReasons
      sector_name: 板块名

    返回: (adjustment: -5~0, detail: dict)
    """
    if len(rows) < 3:
        return 0.0, {}

    today = rows[-1]
    changes = [r.get('change_pct') or 0 for r in rows]
    amplitudes = [r.get('amplitude') or 0 for r in rows]
    turnover_rates = [r.get('turnover_rate') or 0 for r in rows]

    penalties = []
    total_penalty = 0.0

    # 1. 连续上涨 > 5天 → -2
    consecutive_up = 0
    for c in reversed(changes):
        if c > 0:
            consecutive_up += 1
        else:
            break
    if consecutive_up > 5:
        penalties.append(f'连涨{consecutive_up}天')
        total_penalty -= 2

    # 2. 振幅 > 5% 且换手率骤增 → -2
    today_amp = amplitudes[-1] if amplitudes else 0
    tr_recent = mean(turnover_rates[-2:]) if len(turnover_rates) >= 2 else 0
    tr_prev = mean(turnover_rates[-5:-2]) if len(turnover_rates) >= 5 else mean(turnover_rates[:-2]) if len(turnover_rates) > 2 else 0
    if today_amp > 5 and tr_prev > 0 and tr_recent > tr_prev * 1.5:
        penalties.append('分歧加剧')
        total_penalty -= 2

    # 3. 资金连续流出 ≥ 2天 → -1
    fund_rows = [r for r in rows if r.get('main_net_inflow') is not None]
    consecutive_outflow = 0
    for r in reversed(fund_rows):
        if (r.get('main_net_inflow') or 0) < 0:
            consecutive_outflow += 1
        else:
            break
    if consecutive_outflow >= 2:
        penalties.append(f'连续{consecutive_outflow}天流出')
        total_penalty -= 1

    # 4. 今日涨幅 > 5% → -2
    today_change = changes[-1] if changes else 0
    if today_change > 5:
        penalties.append(f'今日大涨{today_change:.1f}%')
        total_penalty -= 2

    # 5-7: 连板天梯相关
    if limit_up_recent:
        daily_stats = []
        for day_data in limit_up_recent:
            themes = _parse_json(day_data.get('themes')) or []
            sector_count = 0
            max_board = 0
            top_stocks = []

            for theme in themes:
                if not match_sector_name(sector_name, theme.get('name', '')):
                    continue
                sector_count = theme.get('count', 0)
                for stock in theme.get('stocks', []):
                    board_str = stock.get('board', '')
                    if '天' in board_str and '板' in board_str:
                        try:
                            boards = int(board_str.split('天')[0])
                            max_board = max(max_board, boards)
                            top_stocks.append({
                                'name': stock.get('name', ''),
                                'board': boards,
                            })
                        except ValueError:
                            pass
                break

            daily_stats.append({
                'count': sector_count,
                'max_board': max_board,
                'top_stocks': top_stocks,
            })

        if len(daily_stats) >= 2:
            today_stat = daily_stats[-1]
            yesterday_stat = daily_stats[-2]

            # 5. 最高板断板 → -2
            if yesterday_stat['max_board'] >= 2:
                # 昨日最高连板股今日不在涨停列表
                yesterday_top = [s for s in yesterday_stat['top_stocks'] if s['board'] == yesterday_stat['max_board']]
                today_stock_names = {s['name'] for s in today_stat['top_stocks']}
                for ys in yesterday_top:
                    if ys['name'] and ys['name'] not in today_stock_names:
                        penalties.append(f'{ys["name"]}断板')
                        total_penalty -= 2
                        break

            # 6. 涨停数连续2天增加 + 最高板≥5 → -1
            if len(daily_stats) >= 3:
                d1, d2, d3 = daily_stats[-3], daily_stats[-2], daily_stats[-1]
                if d2['count'] > d1['count'] and d3['count'] > d2['count'] and d3['max_board'] >= 5:
                    penalties.append('极度过热')
                    total_penalty -= 1

    # 7. 板块跌停家数 > 0 → -1
    limit_down = today.get('limit_down_count') or 0
    if limit_down > 0:
        penalties.append(f'{limit_down}只跌停')
        total_penalty -= 1

    # 累计最多 -5
    total_penalty = max(total_penalty, -5)

    detail = {
        'penalties': penalties,
        'consecutive_up': consecutive_up,
        'consecutive_outflow': consecutive_outflow,
        'limit_down_count': limit_down,
    }

    return round(total_penalty, 1), detail
