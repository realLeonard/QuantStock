"""同花顺热度数据采集: 热门个股、热门概念、热门行业"""

import json
import ssl
import urllib.request


_BASE_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1'

_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                  ' (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.10jqka.com.cn/',
}

# macOS / CI 环境可能缺少根证书，对同花顺公开 API 跳过验证
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def _fetch_json(path: str) -> dict:
    """请求同花顺 API 并返回 JSON"""
    url = f'{_BASE_URL}/{path}'
    req = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=_SSL_CTX) as resp:
        return json.loads(resp.read().decode('utf-8'))


def collect_ths_hot_stocks(top_n: int = 20) -> list:
    """
    采集同花顺热门个股 TOP N
    返回: [{ order, code, name, rate, rise_and_fall, hot_rank_chg,
             concepts, popularity_tag, analyse_title }]
    """
    result = []
    try:
        data = _fetch_json('stock?stock_type=a&type=hour&list_type=normal')
        if data.get('status_code') != 0:
            print(f'  [warn] 同花顺热门个股接口异常: {data.get("status_msg")}')
            return result

        items = data.get('data', {}).get('stock_list', [])
        for item in items[:top_n]:
            # 涨跌幅: 字符串如 "3.25%" 或 "-1.02%"
            rise_str = item.get('rise_and_fall', '0')
            try:
                rise_val = float(str(rise_str).replace('%', ''))
            except (ValueError, TypeError):
                rise_val = 0.0

            # tag 字段可能是 dict 或其他类型
            tag_obj = item.get('tag')
            concepts = tag_obj.get('concept_tag', []) if isinstance(tag_obj, dict) else []
            popularity_tag = tag_obj.get('popularity_tag', '') if isinstance(tag_obj, dict) else ''

            # analyse 字段可能是 dict 或纯字符串
            analyse = item.get('analyse')
            if isinstance(analyse, dict):
                analyse_title = analyse.get('title', '')
            elif isinstance(analyse, str):
                # 取第一行作为标题，截断过长内容
                analyse_title = analyse.split('\n')[0][:80]
            else:
                analyse_title = ''

            result.append({
                'order': item.get('order', 0),
                'code': item.get('code', ''),
                'name': item.get('name', ''),
                'rate': item.get('rate', 0),
                'rise_and_fall': rise_val,
                'hot_rank_chg': item.get('hot_rank_chg', 0),
                'concepts': concepts,
                'popularity_tag': popularity_tag,
                'analyse_title': analyse_title,
            })

    except Exception as e:
        print(f'  [warn] 获取同花顺热门个股失败: {e}')

    return result


def collect_ths_hot_concepts(top_n: int = 15) -> list:
    """
    采集同花顺热门概念板块 TOP N
    返回: [{ order, name, code, rate, rise_and_fall, tag, hot_tag, etf_name }]
    """
    return _collect_plate('concept', top_n)


def collect_ths_hot_industries(top_n: int = 15) -> list:
    """
    采集同花顺热门行业板块 TOP N
    返回: [{ order, name, code, rate, rise_and_fall, tag, hot_tag, etf_name }]
    """
    return _collect_plate('industry', top_n)


def _collect_plate(plate_type: str, top_n: int) -> list:
    """采集概念/行业板块热度"""
    label = '概念' if plate_type == 'concept' else '行业'
    result = []
    try:
        data = _fetch_json(f'plate?type={plate_type}&order_type=hot')
        if data.get('status_code') != 0:
            print(f'  [warn] 同花顺热门{label}接口异常: {data.get("status_msg")}')
            return result

        items = data.get('data', {}).get('plate_list', [])
        for item in items[:top_n]:
            rise_str = item.get('rise_and_fall', '0')
            try:
                rise_val = float(str(rise_str).replace('%', ''))
            except (ValueError, TypeError):
                rise_val = 0.0

            result.append({
                'order': item.get('order', 0),
                'name': item.get('name', ''),
                'code': item.get('code', ''),
                'rate': item.get('rate', 0),
                'rise_and_fall': rise_val,
                'tag': item.get('tag', ''),
                'hot_tag': item.get('hot_tag', ''),
                'etf_name': item.get('etf', {}).get('name', ''),
            })

    except Exception as e:
        print(f'  [warn] 获取同花顺热门{label}失败: {e}')

    return result
