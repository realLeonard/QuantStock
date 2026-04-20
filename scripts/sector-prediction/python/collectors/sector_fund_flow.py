"""资金流采集：直接请求东财资金流 API → sector_daily

用 curl_cffi 模拟 Chrome TLS 指纹，绕过东财对 Python 的检测。
"""

import math
import time
import uuid

from curl_cffi import requests as cffi_requests
from supabase import Client

from db import now_utc_ms


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


def _fetch_fund_flow_direct() -> list[dict] | None:
    """
    直接请求东财概念板块资金流 API（curl_cffi 模拟 Chrome TLS 指纹）。
    返回板块资金流列表，每项包含 name/main_net_inflow 等字段。
    """
    all_items = []
    page = 1
    page_size = 100

    while True:
        params = {
            'pn': str(page),
            'pz': str(page_size),
            'po': '1',
            'np': '1',
            'ut': 'b2884a393a59ad64002292a3e90d46a5',
            'fltt': '2',
            'invt': '2',
            'fid0': 'f62',
            'fs': 'm:90 t:3',  # t:3 = 概念资金流
            'stat': '1',       # 1 = 今日
            'fields': 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124',
            'rt': '52975239',
            '_': str(int(time.time() * 1000)),
        }

        try:
            r = cffi_requests.get(
                'https://push2.eastmoney.com/api/qt/clist/get',
                params=params,
                impersonate='chrome',
                timeout=10,
            )
            data = r.json()
        except Exception as e:
            print(f'  [error] 资金流 API 请求失败: {e}')
            return None

        if not data.get('data') or not data['data'].get('diff'):
            if page == 1:
                return None
            break

        items = data['data']['diff']
        for item in items:
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

        total = data['data'].get('total', 0)
        if page * page_size >= total:
            break
        page += 1

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

    items = _fetch_fund_flow_direct()
    if items is None or len(items) == 0:
        print('  [error] 资金流 API 返回为空')
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
