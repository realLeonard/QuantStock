"""资金流采集：东财 API → sector_daily

东财资金流接口暂无替代数据源，采集失败时优雅降级（不终止流程）。
"""

import math
import os
import uuid

import requests
from supabase import Client

from db import now_utc_ms

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

_HEADERS = {
    'Referer': 'https://data.eastmoney.com/',
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/131.0.0.0 Safari/537.36'
    ),
}

_API_URL = 'https://79.push2.eastmoney.com/api/qt/clist/get'
_API_URL_FALLBACK = 'https://push2.eastmoney.com/api/qt/clist/get'
_COMMON_PARAMS = {
    'po': '1', 'np': '1',
    'ut': 'b2884a393a59ad64002292a3e90d46a5',
    'fltt': '2', 'invt': '2', 'fid0': 'f62',
    'fs': 'm:90+t:3', 'stat': '1',
    'fields': 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124',
}


def _safe_float(val, default=0.0) -> float:
    try:
        if val is None or val == '-':
            return default
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def _do_request(params: dict) -> dict:
    """发送请求：依次尝试代理 → 79.push2 直连 → push2 直连（curl_cffi）"""
    proxy_url = os.environ.get('EASTMONEY_PROXY_URL')
    proxy_key = os.environ.get('PROXY_API_KEY', '')

    if proxy_url:
        try:
            resp = requests.get(
                proxy_url, params=params,
                headers={'X-Proxy-Key': proxy_key},
                timeout=20,
            )
            data = resp.json()
            if data.get('data', {}).get('diff'):
                return data
        except Exception:
            pass

    # 直连 79.push2
    try:
        resp = requests.get(
            _API_URL, params=params, headers=_HEADERS, timeout=15,
        )
        data = resp.json()
        if data.get('data', {}).get('diff'):
            return data
    except Exception:
        pass

    # 回退到 curl_cffi
    if cffi_requests:
        resp = cffi_requests.get(
            _API_URL_FALLBACK, params=params, headers=_HEADERS,
            impersonate='chrome', timeout=15,
        )
        return resp.json()

    raise RuntimeError('所有东财资金流请求方式均失败')


def _fetch_fund_flow() -> list[dict] | None:
    """请求东财概念板块资金流 API，优先走代理。"""
    all_items = []
    page_num = 1
    page_size = 100

    while True:
        params = {**_COMMON_PARAMS, 'pn': str(page_num), 'pz': str(page_size)}
        try:
            data = _do_request(params)
        except Exception as e:
            print(f'  [error] 资金流请求失败: {e}')
            return None

        diff = data.get('data', {}).get('diff') if data.get('data') else None
        total = data.get('data', {}).get('total', 0) if data.get('data') else 0

        if not diff:
            if page_num == 1:
                return None
            break

        for item in diff:
            all_items.append({
                'name': str(item.get('f14', '')).strip(),
                'change_pct': _safe_float(item.get('f3')),
                'main_net_inflow': _safe_float(item.get('f62')),
                'main_net_inflow_pct': _safe_float(item.get('f184')),
                'super_large_net': _safe_float(item.get('f66')),
                'super_large_pct': _safe_float(item.get('f69')),
                'large_net': _safe_float(item.get('f72')),
                'large_pct': _safe_float(item.get('f75')),
                'medium_net': _safe_float(item.get('f78')),
                'medium_pct': _safe_float(item.get('f81')),
                'small_net': _safe_float(item.get('f84')),
                'small_pct': _safe_float(item.get('f87')),
                'leading_stock': str(item.get('f204', '')).strip() if item.get('f204') != '-' else None,
            })

        if page_num * page_size >= total:
            break
        page_num += 1

    return all_items


def collect_fund_flow(sb: Client, today: str) -> dict:
    """
    采集当日概念板块资金流，按板块名匹配写入 sector_daily。

    参数:
      today: 当前交易日 YYYY-MM-DD

    返回: {total: int, matched: int, unmatched_names: [str]}
    """
    print('[3/4] 采集资金流...')
    now = now_utc_ms()

    items = _fetch_fund_flow()
    if items is None or len(items) == 0:
        print('  [warn] 资金流 API 不可用（东财可能封锁了当前 IP），跳过资金流采集')
        return {'total': 0, 'matched': 0, 'unmatched_names': []}

    print(f'  获取到 {len(items)} 条资金流数据')

    # 查询 sector_daily 中当日已有记录
    existing = (
        sb.table('sector_daily')
        .select('id,sector_name')
        .eq('trade_date', today)
        .execute()
    )
    existing_map = {r['sector_name']: r['id'] for r in existing.data}

    matched = 0
    unmatched_names = []

    for item in items:
        name = item['name']
        if not name:
            continue

        fund_data = {
            'main_net_inflow': item['main_net_inflow'],
            'main_net_inflow_pct': item['main_net_inflow_pct'],
            'super_large_net': item['super_large_net'],
            'large_net': item['large_net'],
            'medium_net': item['medium_net'],
            'small_net': item['small_net'],
            'super_large_net_pct': item['super_large_pct'],
            'large_net_pct': item['large_pct'],
            'medium_net_pct': item['medium_pct'],
            'small_net_pct': item['small_pct'],
            'fund_leading_stock': item['leading_stock'],
        }

        if name in existing_map:
            # 当日 K 线记录已存在，更新资金流字段
            sb.table('sector_daily').update(fund_data).eq('id', existing_map[name]).execute()
            matched += 1
        else:
            # 当日无 K 线记录，创建新记录
            record = {
                'id': str(uuid.uuid4()),
                'sector_name': name,
                'trade_date': today,
                **fund_data,
                'created_at': now,
            }
            try:
                sb.table('sector_daily').insert(record).execute()
                matched += 1
            except Exception as e:
                print(f'    [warn] 插入 {name} 资金流失败: {e}')
                unmatched_names.append(name)

    print(f'  资金流匹配完成: 匹配 {matched}/{len(items)}')
    if unmatched_names[:10]:
        print(f'  未匹配（前10）: {", ".join(unmatched_names[:10])}')

    return {'total': len(items), 'matched': matched, 'unmatched_names': unmatched_names}
