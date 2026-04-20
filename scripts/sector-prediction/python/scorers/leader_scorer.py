"""龙头映射评分（加分项 0-10）

条件：
  龙头股涨停        → +5
  龙头股连板（≥2板）→ +3
  龙头股在龙虎榜被游资买入 → +2

数据源：
  sector_daily.fund_leading_stock — 龙头股名
  limitUpReasons.themes[].stocks  — 涨停/连板数据
  dailyReview.dragon_tiger        — 龙虎榜数据
"""

from __future__ import annotations

import json


def _clamp(v: float, lo: float = 0.0, hi: float = 10.0) -> float:
    return max(lo, min(hi, v))


def _parse_json(val) -> list | dict | None:
    """安全解析 JSON（可能是 str 或已解析的 list/dict）"""
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def _match_sector_theme(sector_name: str, theme_name: str) -> bool:
    """判断 theme 是否对应该板块"""
    clean_s = sector_name.replace('概念', '').replace('板块', '').strip()
    clean_t = theme_name.replace('概念', '').replace('板块', '').strip()
    if clean_s == clean_t or sector_name == theme_name:
        return True
    if len(clean_s) <= 2 or len(clean_t) <= 2:
        return False
    return clean_s in clean_t or clean_t in clean_s


def _find_theme_leader(sector_name: str, limit_up_data: dict | None) -> tuple[str, int]:
    """
    从 limitUpReasons 中找到该板块连板最高的股票作为实际龙头。
    返回 (stock_name, board_count)。找不到返回 ('', 0)。
    """
    if not limit_up_data:
        return '', 0

    themes = _parse_json(limit_up_data.get('themes')) or []
    best_name = ''
    best_board = 0

    for theme in themes:
        if not _match_sector_theme(sector_name, theme.get('name', '')):
            continue
        for stock in theme.get('stocks', []):
            board_str = stock.get('board', '')
            boards = 0
            if '天' in board_str and '板' in board_str:
                try:
                    boards = int(board_str.split('天')[0])
                except ValueError:
                    boards = 1
            elif '首板' in board_str:
                boards = 1
            if boards > best_board:
                best_board = boards
                best_name = stock.get('name', '')

    return best_name, best_board


def calc_leader_bonus(
    sector_name: str,
    leading_stock: str,
    limit_up_data: dict | None,
    dragon_tiger_data: list | None,
) -> tuple[float, dict]:
    """
    计算单板块龙头映射加分。

    参数:
      sector_name: 板块名
      leading_stock: 该板块领涨股名称（sector_master 的当日涨幅最大股）
      limit_up_data: limitUpReasons 当日数据（含 themes）
      dragon_tiger_data: dailyReview.dragon_tiger 列表

    返回: (bonus: 0-10, detail: dict)
    """
    # 优先使用 limitUpReasons 中连板最高的股票作为实际龙头
    theme_leader, theme_board = _find_theme_leader(sector_name, limit_up_data)
    actual_leader = theme_leader if theme_leader else leading_stock

    if not actual_leader:
        return 0.0, {'reason': '无龙头股'}

    bonus = 0.0
    reasons = []

    # ---- 龙头股涨停 → +5 ----
    is_limit_up = False
    continuous_board = theme_board  # 已从 _find_theme_leader 获得

    if theme_leader:
        # 从 theme 找到的龙头本身就是涨停的
        is_limit_up = True
    elif limit_up_data:
        # fallback: 检查 leading_stock 是否在任一 theme 中涨停
        themes = _parse_json(limit_up_data.get('themes')) or []
        for theme in themes:
            stocks = theme.get('stocks', [])
            for stock in stocks:
                if stock.get('name', '') == actual_leader:
                    is_limit_up = True
                    board_str = stock.get('board', '')
                    if '天' in board_str and '板' in board_str:
                        try:
                            continuous_board = int(board_str.split('天')[0])
                        except ValueError:
                            continuous_board = 1
                    elif '首板' in board_str:
                        continuous_board = 1
                    break
            if is_limit_up:
                break

    if is_limit_up:
        bonus += 5
        reasons.append(f'龙头{leading_stock}涨停')

    # ---- 龙头股连板（≥2板）→ +3 ----
    if continuous_board >= 2:
        bonus += 3
        reasons.append(f'{continuous_board}连板')

    # ---- 龙头股在龙虎榜 → +2 ----
    in_dragon_tiger = False
    if dragon_tiger_data:
        dt_list = _parse_json(dragon_tiger_data) if not isinstance(dragon_tiger_data, list) else dragon_tiger_data
        if dt_list:
            for entry in dt_list:
                if entry.get('name') == actual_leader:
                    in_dragon_tiger = True
                    break

    if in_dragon_tiger:
        bonus += 2
        reasons.append('龙虎榜')

    detail = {
        'leading_stock': actual_leader,
        'limit_up': is_limit_up,
        'continuous_board': continuous_board,
        'dragon_tiger': in_dragon_tiger,
        'reasons': reasons,
    }

    return round(_clamp(bonus), 1), detail
