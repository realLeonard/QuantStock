"""政策/事件面评分（权重 25%）

子因子：
  1. 相关新闻数量          — 30分
  2. 新闻等级权重          — 30分
  3. Claude NLP 解读       — 40分（通过 Claude CLI + Opus 模型）

数据源：newsItems_cls 近3天
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from utils import call_claude_cli

_BJ_TZ = timezone(timedelta(hours=8))

# 板块名关键词太短（≤2字）容易误匹配，需要完整匹配
_SHORT_NAME_THRESHOLD = 2


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


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
    """板块名关键词是否出现在文本中（短名精确匹配，长名模糊匹配）"""
    clean = sector_name.replace('概念', '').replace('板块', '').strip()

    # 短名称（如"电力"、"芯片"）要求独立出现，避免匹配到"电力设备"等
    if len(clean) <= _SHORT_NAME_THRESHOLD:
        # 只匹配完整板块名
        return sector_name in text
    else:
        # 长名称可以用子串匹配
        return clean in text or sector_name in text


def _calc_keyword_scores(
    all_news: list[dict],
    sector_names: list[str],
) -> dict[str, dict]:
    """
    基于关键词匹配计算每个板块的新闻数量分和等级分。
    返回 {sector_name: {count_score, level_score, matched_count, weighted_level, matched_titles}}
    """
    result = {}

    for name in sector_names:
        matched = []
        for n in all_news:
            text = (n.get('title') or '') + (n.get('summary') or '')
            if _keyword_match(name, text):
                matched.append(n)

        # 子因子 1：相关新闻数量（30分），5 条满分
        count_score = _clamp(len(matched) / 5.0 * 30, 0, 30)

        # 子因子 2：新闻等级权重（30分），A 级 ×3，B 级 ×1，累计 10 满分
        weighted = 0
        for n in matched:
            level = (n.get('level') or 'B').upper()
            if level == 'A':
                weighted += 3
            else:
                weighted += 1
        level_score = _clamp(weighted / 10.0 * 30, 0, 30)

        # 收集匹配到的新闻��题（供 Claude 精准评估）
        matched_titles = [n.get('title', '') for n in matched[:10]]

        result[name] = {
            'count_score': round(count_score, 1),
            'level_score': round(level_score, 1),
            'matched_count': len(matched),
            'weighted_level': weighted,
            'matched_titles': matched_titles,
        }

    return result


def _select_news_for_claude(all_news: list[dict], max_count: int = 60) -> list[dict]:
    """
    为 Claude 选取新闻：优先全部 A 级，再补 B 级，上限 max_count 条。
    """
    a_news = [n for n in all_news if (n.get('level') or '').upper() == 'A']
    b_news = [n for n in all_news if (n.get('level') or '').upper() != 'A']

    selected = a_news[:max_count]
    remaining = max_count - len(selected)
    if remaining > 0:
        selected.extend(b_news[:remaining])

    return selected


def _call_claude_nlp(
    selected_news: list[dict],
    sectors_with_news: list[str],
) -> dict[str, float]:
    """
    通过 Claude CLI (Opus) 批量评估新闻对板块的利好/利空。
    只评估有新闻关联的板块。
    返回 {sector_name: nlp_score(0-100)}
    """
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('  [policy] 未配置 ANTHROPIC_API_KEY，跳过 Claude NLP 评分')
        return {}

    if not sectors_with_news:
        print('  [policy] 无板块有新闻关联，跳过 Claude NLP')
        return {}

    news_text = '\n'.join(
        f'{i+1}. [{n.get("level","B")}] {n.get("title","")} - {(n.get("summary","") or "")[:100]}'
        for i, n in enumerate(selected_news)
    )

    sectors_text = '、'.join(sectors_with_news)

    prompt = f"""你是A股板块分析师。以下是近3天的重要新闻，请判断这些新闻对哪些板块有利好/利空影响。

新闻列表：
{news_text}

待评估板块：{sectors_text}

请以 JSON 格式返回，key 是板块名，value 是评分（0-100，50为中性，>50利好，<50利空）。
只返回受影响的板块（评分不为50的），不需要返回全部板块。
直接返回 JSON，不要其他文字。"""

    try:
        text = call_claude_cli(prompt, label='policy-nlp', timeout=120)
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            scores = json.loads(json_match.group())
            return {k: float(v) for k, v in scores.items() if isinstance(v, (int, float))}
        print(f'  [policy] Claude 返回无法解析 JSON: {text[:100]}')
    except Exception as e:
        print(f'  [policy] Claude NLP 调用失败: {e}')

    return {}


def calc_policy_scores_batch(
    sb,
    sector_names: list[str],
) -> dict[str, tuple[float, dict]]:
    """
    批量计算所有板块的政策/事件面评分。

    返回: {sector_name: (score: 0-100, detail: dict)}
    """
    print('  [policy] 查询近 3 天新闻...')
    all_news = _get_recent_news(sb, days=3)
    print(f'  [policy] 获取到 {len(all_news)} 条新闻')

    if not all_news:
        return {name: (0.0, {'reason': '无新闻数据'}) for name in sector_names}

    # 关键词匹配
    print('  [policy] 关键词匹配评分...')
    keyword_scores = _calc_keyword_scores(all_news, sector_names)

    # 筛出有新闻关联的板块（matched_count > 0），只让 Claude 评估这些
    sectors_with_news = [
        name for name in sector_names
        if keyword_scores.get(name, {}).get('matched_count', 0) > 0
    ]
    print(f'  [policy] {len(sectors_with_news)} 个板块有新闻关联')

    # Claude NLP（40分）— 优先 A 级新闻
    print('  [policy] Claude NLP 评分...')
    selected_news = _select_news_for_claude(all_news, max_count=60)
    print(f'  [policy] 送 Claude: {len(selected_news)} 条新闻，{len(sectors_with_news)} 个板块')
    nlp_scores = _call_claude_nlp(selected_news, sectors_with_news)
    if nlp_scores:
        print(f'  [policy] Claude 返回 {len(nlp_scores)} 个板块评分')
    else:
        print('  [policy] Claude NLP 未返回结果，该子因子置 0')

    # 汇总
    result = {}
    for name in sector_names:
        kw = keyword_scores.get(name, {})
        count_score = kw.get('count_score', 0)
        level_score = kw.get('level_score', 0)

        # NLP 分：Claude 返回 0-100，映射到 0-40
        # 未被 Claude 评估的板块得 0 分（不给默认分）
        if name in nlp_scores:
            raw_nlp = nlp_scores[name]
            nlp_score = _clamp((raw_nlp - 50) / 50 * 40 + 20, 0, 40)  # 50→20分, 100→40分, 0→0分
        else:
            raw_nlp = None
            nlp_score = 0.0

        total = count_score + level_score + nlp_score

        detail = {
            'news_count': round(count_score, 1),
            'news_level': round(level_score, 1),
            'nlp': round(nlp_score, 1),
            'matched_news': kw.get('matched_count', 0),
            'raw_nlp': round(raw_nlp, 1) if raw_nlp is not None else None,
        }

        result[name] = (round(_clamp(total), 2), detail)

    return result
