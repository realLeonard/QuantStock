"""情绪面评分（权重 25%）

子因子：
  1. 涨停集中度         — 35分（limitUpReasons 中该板块涨停数 / 全市场涨停数）
  2. 连板强度           — 25分（该板块连板股数量和高度）
  3. 涨幅连续性         — 20分（sector_daily 近5日上涨天数）
  4. 市场炸板率（反向） — 20分（dailyReview.market_sentiment 炸板率低=好）

数据源：limitUpReasons + dailyReview + sector_daily
"""

from __future__ import annotations

import json


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _parse_json(val) -> list | dict | None:
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def _match_theme(sector_name: str, theme_name: str) -> bool:
    """判断 limitUpReasons 中的 theme_name 是否对应 sector_name

    策略：去掉"概念""板块"后缀后，要求一方完全包含另一方，
    且被包含方长度 > 2（避免"电力"匹配"电力设备"这种误匹配）。
    """
    clean_sector = sector_name.replace('概念', '').replace('板块', '').strip()
    clean_theme = theme_name.replace('概念', '').replace('板块', '').strip()

    # 完全相同
    if clean_sector == clean_theme or sector_name == theme_name:
        return True

    # 短名称（≤2字）只接受精确匹配，不做子串
    if len(clean_sector) <= 2 or len(clean_theme) <= 2:
        return False

    # 长名称允许子串匹配
    return clean_sector in clean_theme or clean_theme in clean_sector


def calc_sentiment_score(
    sector_name: str,
    sector_rows: list[dict],
    limit_up_data: dict | None,
    market_sentiment: dict | None,
) -> tuple[float, dict]:
    """
    计算单板块情绪面评分。

    参数:
      sector_name: 板块名
      sector_rows: 该板块最近 N 天的 sector_daily 记录，按 trade_date ASC
      limit_up_data: limitUpReasons 当日数据（含 themes）
      market_sentiment: dailyReview.market_sentiment 字典

    返回: (score: 0-100, detail: dict)
    """

    # ---- 子因子 1：涨停集中度（35分）----
    sector_limit_count = 0
    # 用 dailyReview 的 limit_up 数据作为全市场涨停总数（去重后的真实值）
    ms = _parse_json(market_sentiment) if market_sentiment and not isinstance(market_sentiment, dict) else market_sentiment
    total_limit_up = (ms or {}).get('limit_up', 0) if ms else 0

    if limit_up_data:
        themes = _parse_json(limit_up_data.get('themes')) or []
        for theme in themes:
            if _match_theme(sector_name, theme.get('name', '')):
                sector_limit_count = theme.get('count', 0)
                break  # 一个板块只匹配一个 theme

    if total_limit_up > 0 and sector_limit_count > 0:
        concentration = sector_limit_count / total_limit_up
        # 集中度 > 15% 满分
        concentration_score = _clamp(concentration / 0.15 * 35, 0, 35)
    else:
        concentration_score = 0.0

    # ---- 子因子 2：连板强度（25分）----
    max_board = 0
    board_stock_count = 0

    if limit_up_data:
        themes = _parse_json(limit_up_data.get('themes')) or []
        for theme in themes:
            if not _match_theme(sector_name, theme.get('name', '')):
                continue

            for stock in theme.get('stocks', []):
                board_str = stock.get('board', '')
                if '天' in board_str and '板' in board_str:
                    try:
                        boards = int(board_str.split('天')[0])
                        if boards >= 2:
                            board_stock_count += 1
                            max_board = max(max_board, boards)
                    except ValueError:
                        pass

    # 连板分：最高板数 × 5 + 连板股数 × 3，25分封顶
    board_score = _clamp(max_board * 5 + board_stock_count * 3, 0, 25)

    # ---- 子因子 3：涨幅连续性（20分）----
    if len(sector_rows) >= 5:
        recent_5 = sector_rows[-5:]
        up_days = sum(1 for r in recent_5 if (r.get('change_pct') or 0) > 0)
        continuity_score = (up_days / 5.0) * 20
    elif sector_rows:
        up_days = sum(1 for r in sector_rows if (r.get('change_pct') or 0) > 0)
        continuity_score = (up_days / len(sector_rows)) * 20
    else:
        up_days = 0
        continuity_score = 0.0

    # ---- 子因子 4：板块情绪质量（20分）----
    # 用板块自身的「涨幅/振幅」比值衡量多空分歧程度
    # 涨幅占振幅比例高 = 上涨坚决无分歧，得分高
    # 同时考虑市场炸板率作为整体修正
    today_row = sector_rows[-1] if sector_rows else {}
    today_change = abs(today_row.get('change_pct') or 0.0)
    today_amp = today_row.get('amplitude') or 0.0

    if today_amp > 0:
        # 涨幅/振幅比：越接近1说明越坚决（单边上涨）
        resolve_ratio = today_change / today_amp
        resolve_score = _clamp(resolve_ratio * 15, 0, 15)
    else:
        resolve_score = 7.5

    # 市场炸板率作为微调（±5分）
    if ms:
        broken_rate = ms.get('broken_rate', 30)
        market_adj = _clamp((50 - broken_rate) / 40 * 5, -5, 5)
    else:
        market_adj = 0.0

    broken_score = _clamp(resolve_score + market_adj, 0, 20)

    total = concentration_score + board_score + continuity_score + broken_score

    detail = {
        'concentration': round(concentration_score, 1),
        'board_strength': round(board_score, 1),
        'continuity': round(continuity_score, 1),
        'sentiment_quality': round(broken_score, 1),
        'raw_limit_count': sector_limit_count,
        'raw_max_board': max_board,
        'raw_up_days': up_days,
        'raw_broken_rate': ms.get('broken_rate', 0) if ms else 0,
    }

    return round(_clamp(total), 2), detail
