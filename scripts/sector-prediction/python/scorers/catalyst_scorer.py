"""催化剂评分（权重 15%，满分100）

合并旧 policy_scorer + rotation_scorer。

子因子：
  A. 政策催化（35分）— Claude NLP 新闻评估
  B. 轮动传导（30分）— 上游板块近3天累计涨幅 + 资金加速
  C. 连板天梯人气（35分）— 互斥取最高分

数据源：newsItems_cls + sector_rotation_map + limitUpReasons近3天
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import clamp, match_sector_name, normalize_sector_name, mean

_BJ_TZ = timezone(timedelta(hours=8))


def _parse_json(val):
    """安全解析 JSON"""
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except (json.JSONDecodeError, ValueError):
            return None
    return None


# ======== 子因子A：政策催化 ========

def _get_recent_news(sb, days: int = 3) -> list[dict]:
    """查询近 N 天新闻"""
    start_ms = int((datetime.now(_BJ_TZ) - timedelta(days=days)).timestamp() * 1000)
    all_news = []
    offset = 0
    page_size = 500

    while True:
        resp = (
            sb.table('newsItems_cls')
            .select('title,summary,level,categories')
            .gte('published_at', start_ms)
            .order('published_at', desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        all_news.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return all_news


def _keyword_match(sector_name: str, text: str) -> bool:
    """板块名是否在文本中出现"""
    clean = normalize_sector_name(sector_name)
    if len(clean) <= 2:
        return sector_name in text
    return clean in text or sector_name in text


def _call_claude_policy(all_news: list[dict], sector_name: str) -> float | None:
    """调用 Claude 评估新闻对该板块的利好/利空程度"""
    api_key = os.environ.get('ANTHROPIC_AUTH_TOKEN') or os.environ.get('ANTHROPIC_API_KEY')
    base_url = os.environ.get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    if not api_key:
        return None

    # 筛选与该板块相关的新闻
    matched = []
    for n in all_news:
        text = (n.get('title') or '') + (n.get('summary') or '')
        if _keyword_match(sector_name, text):
            matched.append(n)

    if not matched:
        return None

    news_text = '\n'.join(
        f'{i+1}. [{n.get("level","B")}] {n.get("title","")} - {(n.get("summary","") or "")[:100]}'
        for i, n in enumerate(matched[:20])
    )

    prompt = f"""你是A股板块分析师。以下是近3天与"{sector_name}"板块相关的新闻。
请评估这些新闻整体对该板块的利好/利空影响。

新闻列表：
{news_text}

请只返回一个 0-100 的数字评分，50=中性，>50=利好，<50=利空。
只返回数字，不要其他文字。"""

    try:
        import httpx
        resp = httpx.post(
            f'{base_url}/v1/messages',
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json={
                'model': 'claude-sonnet-4-20250514',
                'max_tokens': 100,
                'messages': [{'role': 'user', 'content': prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        text = resp.json()['content'][0]['text'].strip()
        nums = re.findall(r'\d+', text)
        if nums:
            return float(nums[0])
    except Exception:
        pass

    return None


# ======== 子因子B：轮动传导 ========

def _calc_rotation_sub(
    sector_name: str,
    rotation_map: list[dict],
    grouped: dict[str, list[dict]],
) -> tuple[float, dict]:
    """轮动传导子评分（30分）"""
    # 找上游板块
    upstream = []
    for r in rotation_map:
        target = r.get('target_sector', '')
        if match_sector_name(target, sector_name):
            upstream.append(r)

    if not upstream:
        return 0.0, {'reason': '无上游映射'}

    def _find_rows(name: str) -> list[dict]:
        if name in grouped:
            return grouped[name]
        for k in grouped:
            if match_sector_name(k, name):
                return grouped[k]
        return []

    upstream_score = 0.0
    fund_score = 0.0
    details = []

    for rel in upstream:
        source = rel['source_sector']
        weight = rel.get('weight', 1.0)
        rows = _find_rows(source)
        if len(rows) < 3:
            continue

        # 近3天累计涨幅
        cum_3d = sum(r.get('change_pct') or 0 for r in rows[-3:])
        if cum_3d > 5:
            upstream_score += 20 * weight

        # 上游资金加速流入
        fund_rows = [r for r in rows[-3:] if r.get('main_net_inflow') is not None]
        if len(fund_rows) >= 2:
            inflows = [(r.get('main_net_inflow') or 0) for r in fund_rows]
            if all(f > 0 for f in inflows) and inflows[-1] > inflows[0]:
                fund_score += 10 * weight

        details.append({'source': source, 'cum_3d': round(cum_3d, 2)})

    return clamp(upstream_score + fund_score, 0, 30), {'upstream': details[:3]}


# ======== 子因子C：连板天梯人气 ========

def _calc_limit_up_catalyst(
    sector_name: str,
    limit_up_recent: list[dict],
) -> tuple[float, dict]:
    """
    连板天梯人气子评分（35分）。
    条件互斥取最高分。
    """
    if not limit_up_recent:
        return 0.0, {'reason': '无涨停数据'}

    # 解析近几天的涨停数据
    daily_stats = []
    for day_data in limit_up_recent:
        themes = _parse_json(day_data.get('themes')) or []
        sector_count = 0
        max_board = 0
        has_2board = False
        first_board_count = 0

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
                        if boards >= 2:
                            has_2board = True
                        if boards == 1:
                            first_board_count += 1
                    except ValueError:
                        pass
            break

        daily_stats.append({
            'count': sector_count,
            'max_board': max_board,
            'has_2board': has_2board,
            'first_board_count': first_board_count,
        })

    if not daily_stats:
        return 0.0, {'reason': '解析失败'}

    today_stat = daily_stats[-1]
    yesterday_stat = daily_stats[-2] if len(daily_stats) >= 2 else {'count': 0, 'max_board': 0, 'has_2board': False, 'first_board_count': 0}

    score = 0.0
    reason = ''

    # 互斥取最高分
    # 1. 今日首次出现涨停（昨日0→今日≥1）→ 35分
    if yesterday_stat['count'] == 0 and today_stat['count'] >= 1:
        score = 35
        reason = '首次出现涨停（启动催化）'
    # 2. 涨停数比昨日增加 → 25分
    elif today_stat['count'] > yesterday_stat['count'] and yesterday_stat['count'] > 0:
        score = 25
        reason = '涨停数增加（人气聚集）'
    # 3. 出现2板以上连板股（昨日无→今日有）→ 20分
    elif today_stat['has_2board'] and not yesterday_stat['has_2board']:
        score = 20
        reason = '出现连板股（市场接力）'
    # 4. 首板数量增加 → 15分
    elif today_stat['first_board_count'] > yesterday_stat['first_board_count']:
        score = 15
        reason = '首板增加（新资金试探）'
    # 5. 已有高位板(≥4板) → 5分
    elif today_stat['max_board'] >= 4:
        score = 5
        reason = '已有高位板（预测价值低）'

    detail = {
        'today_count': today_stat['count'],
        'yesterday_count': yesterday_stat['count'],
        'max_board': today_stat['max_board'],
        'reason': reason,
    }

    return clamp(score, 0, 35), detail


# ======== 主入口 ========

# 缓存新闻（避免每个板块重复查询）
_news_cache: list[dict] | None = None
_claude_cache: dict[str, float | None] = {}


def calc_catalyst_score(
    sector_name: str,
    rows: list[dict],
    limit_up_recent: list[dict],
    rotation_map: list[dict],
    grouped: dict[str, list[dict]],
    sb=None,
) -> tuple[float, dict]:
    """
    计算催化剂评分。

    参数:
      sector_name: 板块名
      rows: 该板块 sector_daily
      limit_up_recent: 近3天 limitUpReasons
      rotation_map: 轮动映射表
      grouped: 全市场板块数据
      sb: Supabase 客户端（用于查新闻）

    返回: (score: 0-100, detail: dict)
    """
    global _news_cache, _claude_cache

    # ---- 子因子A：政策催化（35分）----
    policy_score = 0.0
    policy_detail = {'reason': '无新闻数据'}

    if sb:
        # 缓存新闻
        if _news_cache is None:
            _news_cache = _get_recent_news(sb, days=3)

        # 检查该板块是否有新闻
        has_news = any(
            _keyword_match(sector_name, (n.get('title') or '') + (n.get('summary') or ''))
            for n in _news_cache
        )

        if has_news:
            # Claude NLP（带缓存）
            if sector_name not in _claude_cache:
                _claude_cache[sector_name] = _call_claude_policy(_news_cache, sector_name)

            nlp = _claude_cache[sector_name]
            if nlp is not None and nlp > 60:
                policy_score = 35
                policy_detail = {'nlp_score': nlp, 'reason': '利好新闻'}
            elif nlp is not None and nlp >= 50:
                policy_score = 15
                policy_detail = {'nlp_score': nlp, 'reason': '中性新闻'}
            else:
                policy_detail = {'nlp_score': nlp, 'reason': '无显著利好'}

    # ---- 子因子B：轮动传导（30分）----
    rotation_score, rotation_detail = _calc_rotation_sub(sector_name, rotation_map, grouped)

    # ---- 子因子C：连板天梯人气（35分）----
    limit_score, limit_detail = _calc_limit_up_catalyst(sector_name, limit_up_recent)

    total = policy_score + rotation_score + limit_score

    detail = {
        'policy': round(policy_score, 1),
        'rotation': round(rotation_score, 1),
        'limit_up': round(limit_score, 1),
        'policy_detail': policy_detail,
        'rotation_detail': rotation_detail,
        'limit_up_detail': limit_detail,
    }

    return round(clamp(total), 2), detail


def reset_cache():
    """重置全局缓存（用于测试或新一轮评分）"""
    global _news_cache, _claude_cache
    _news_cache = None
    _claude_cache = {}
