"""轮动规律评分（权重 5%）

子因子：
  1. 上游板块昨日表现     — 50分
  2. 历史跟涨概率         — 50分

数据源：sector_rotation_map + sector_daily 历史
"""

from __future__ import annotations

from collections import defaultdict


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def calc_rotation_score(
    sector_name: str,
    rotation_map: list[dict],
    daily_by_sector: dict[str, list[dict]],
) -> tuple[float, dict]:
    """
    计算单板块轮动规律评分。

    参数:
      sector_name: 当前板块名
      rotation_map: sector_rotation_map 全量记录
      daily_by_sector: {板块名: [sector_daily 记录按 trade_date ASC]}

    返回: (score: 0-100, detail: dict)
    """
    # 找到以 sector_name 为 target 的上游板块
    # 支持模糊匹配：rotation_map 中的名称可能不带"概念"后缀
    def _name_match(map_name: str, sector: str) -> bool:
        if map_name == sector:
            return True
        clean_map = map_name.replace('概念', '').strip()
        clean_sec = sector.replace('概念', '').strip()
        return clean_map == clean_sec

    upstream = [
        r for r in rotation_map
        if _name_match(r.get('target_sector', ''), sector_name)
    ]

    if not upstream:
        return 0.0, {'reason': '无上游板块映射'}

    # ---- 子因子 1：上游板块昨日表现（50分）----
    upstream_boost = 0.0
    upstream_details = []

    def _find_sector_rows(name: str) -> list[dict]:
        """按名称查 daily_by_sector，支持带/不带'概念'后缀"""
        if name in daily_by_sector:
            return daily_by_sector[name]
        # 尝试加/去"概念"
        alt = name + '概念' if '概念' not in name else name.replace('概念', '')
        return daily_by_sector.get(alt, [])

    for rel in upstream:
        source = rel['source_sector']
        weight = rel.get('weight', 1.0)
        source_rows = _find_sector_rows(source)

        if len(source_rows) < 2:
            continue

        # 昨日 = 倒数第二天（最后一天是今天）
        yesterday_change = source_rows[-2].get('change_pct') or 0.0

        if yesterday_change > 2.0:
            # 上游昨日涨幅 > 2%，加分
            boost = min(yesterday_change / 5.0, 1.0) * 50 * weight
            upstream_boost += boost
            upstream_details.append({
                'source': source,
                'change': round(yesterday_change, 2),
                'boost': round(boost, 1),
            })

    upstream_score = _clamp(upstream_boost, 0, 50)

    # ---- 子因子 2：历史跟涨概率（50分）----
    follow_probs = []

    for rel in upstream:
        source = rel['source_sector']
        weight = rel.get('weight', 1.0)
        source_rows = _find_sector_rows(source)
        target_rows = _find_sector_rows(sector_name)

        if len(source_rows) < 10 or len(target_rows) < 10:
            continue

        # 构建日期→涨跌幅映射
        source_by_date = {r['trade_date']: r.get('change_pct', 0) for r in source_rows}
        target_by_date = {r['trade_date']: r.get('change_pct', 0) for r in target_rows}

        # 统计：上游涨 > 2% 后，该板块次日涨的概率
        dates = sorted(source_by_date.keys())
        up_days = 0
        follow_up = 0

        for i in range(len(dates) - 1):
            d = dates[i]
            next_d = dates[i + 1]
            if source_by_date.get(d, 0) > 2.0:
                up_days += 1
                if target_by_date.get(next_d, 0) > 0:
                    follow_up += 1

        if up_days >= 3:  # 至少 3 个样本
            prob = follow_up / up_days
            follow_probs.append(prob * weight)

    if follow_probs:
        avg_prob = sum(follow_probs) / len(follow_probs)
        history_score = _clamp(avg_prob * 50, 0, 50)
    else:
        history_score = 0.0

    total = upstream_score + history_score

    detail = {
        'upstream': round(upstream_score, 1),
        'history': round(history_score, 1),
        'upstream_sources': upstream_details[:3],  # 最多展示 3 个上游
    }

    return round(_clamp(total), 2), detail
