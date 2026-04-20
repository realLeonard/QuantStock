"""市场环境分级

从 dailyReview.market_sentiment 读取涨停/跌停/炸板率，划分市场等级。

| 等级     | 条件                          | 推荐上限 |
|----------|-------------------------------|----------|
| strong   | 涨停>50 且 炸板率<20%         | 10 个    |
| neutral  | 涨停 20-50 或 炸板率 20-40%   | 5 个     |
| weak     | 涨停<20 且 炸板率>40%         | 3 ��     |
| extreme  | 跌停>30                       | 1 个     |
"""

from __future__ import annotations

import json

# 推荐上限映射
RECOMMEND_LIMITS = {
    'strong': 10,
    'neutral': 5,
    'weak': 3,
    'extreme': 1,
}


def _parse_json(val) -> dict | None:
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


def classify_market(daily_review: dict | None) -> tuple[str, dict]:
    """
    根据 dailyReview 数据判断市场环境。

    参数:
      daily_review: dailyReview 表当日记���

    返回: (env: str, detail: dict)
      env: 'strong' / 'neutral' / 'weak' / 'extreme'
    """
    if not daily_review:
        return 'neutral', {'reason': '无 dailyReview 数据'}

    ms = _parse_json(daily_review.get('market_sentiment'))
    if not ms:
        return 'neutral', {'reason': '无 market_sentiment 数据'}

    limit_up = ms.get('limit_up', 0)
    limit_down = ms.get('limit_down', 0)
    broken_rate = ms.get('broken_rate', 30)

    detail = {
        'limit_up': limit_up,
        'limit_down': limit_down,
        'broken_rate': broken_rate,
    }

    # 极端行情优先判断
    if limit_down > 30:
        return 'extreme', {**detail, 'reason': f'跌停{limit_down}家>30'}

    # 强势
    if limit_up > 50 and broken_rate < 20:
        return 'strong', {**detail, 'reason': f'涨停{limit_up}家 炸板率{broken_rate}%'}

    # 弱势
    if limit_up < 20 and broken_rate > 40:
        return 'weak', {**detail, 'reason': f'涨停仅{limit_up}家 炸板率{broken_rate}%'}

    # 中性
    return 'neutral', {**detail, 'reason': f'涨停{limit_up}家 炸��率{broken_rate}%'}
