"""资金流采集：东财 API（主） + 同花顺 THS（后备） → sector_daily"""

import math
import os
import re
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

    try:
        resp = requests.get(
            _API_URL, params=params, headers=_HEADERS, timeout=15,
        )
        data = resp.json()
        if data.get('data', {}).get('diff'):
            return data
    except Exception:
        pass

    if cffi_requests:
        resp = cffi_requests.get(
            _API_URL_FALLBACK, params=params, headers=_HEADERS,
            impersonate='chrome', timeout=15,
        )
        return resp.json()

    raise RuntimeError('所有东财资金流请求方式均失败')


def _fetch_fund_flow() -> list[dict] | None:
    """请求东财概念板块资金流 API"""
    all_items = []
    page_num = 1
    page_size = 100

    while True:
        params = {**_COMMON_PARAMS, 'pn': str(page_num), 'pz': str(page_size)}
        try:
            data = _do_request(params)
        except Exception as e:
            print(f'  [error] 东财资金流请求失败: {e}')
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


def _fetch_fund_flow_ths() -> list[dict] | None:
    """THS 后备：从同花顺 data.10jqka.com.cn 获取概念资金流"""
    try:
        import py_mini_racer
        from bs4 import BeautifulSoup
        import pandas as pd
        from io import StringIO
        import akshare
    except ImportError:
        print('  [error] akshare/py_mini_racer 未安装，无法使用 THS 资金流后备')
        return None

    print('  [info] 切换到同花顺资金流数据源...')

    js_path = os.path.join(
        os.path.dirname(akshare.__file__), 'stock_feature', 'ths.js',
    )
    try:
        with open(js_path) as f:
            js_content = f.read()
    except FileNotFoundError:
        print('  [error] THS JS 文件不存在')
        return None

    def _get_v_code():
        js = py_mini_racer.MiniRacer()
        js.eval(js_content)
        return js.call('v')

    def _make_headers(v_code):
        return {
            'Accept': 'text/html, */*; q=0.01',
            'hexin-v': v_code,
            'Host': 'data.10jqka.com.cn',
            'Referer': 'http://data.10jqka.com.cn/funds/gnzjl/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest',
        }

    base_url = 'http://data.10jqka.com.cn/funds/gnzjl/field/tradezdf/order/desc/'

    # 获取总页数
    try:
        v = _get_v_code()
        r = requests.get(base_url + 'ajax/1/free/1/', headers=_make_headers(v), timeout=15)
        soup = BeautifulSoup(r.text, features='lxml')
        page_info = soup.find(name='span', attrs={'class': 'page_info'})
        total_pages = int(page_info.text.split('/')[1]) if page_info else 1
    except Exception as e:
        print(f'  [error] THS 资金流首页请求失败: {e}')
        return None

    all_items = []
    for page in range(1, total_pages + 1):
        try:
            v = _get_v_code()
            url = base_url + f'page/{page}/ajax/1/free/1/'
            r = requests.get(url, headers=_make_headers(v), timeout=15)
            tables = pd.read_html(StringIO(r.text))
            if not tables:
                continue
            df = tables[0]
            # 找到"行业"和"净额"列（THS 列名可能变化，按位置兜底）
            name_col = '行业' if '行业' in df.columns else df.columns[1]
            for _, row in df.iterrows():
                name = str(row[name_col]).strip()
                if not name or name == 'nan':
                    continue
                # 尝试解析净额（可能带"亿"单位）
                net_val = 0.0
                for col in df.columns:
                    if '净额' in str(col):
                        raw = str(row[col]).replace(',', '')
                        try:
                            net_val = float(raw) * 10000  # 亿→万
                        except (ValueError, TypeError):
                            pass
                        break
                leading = ''
                for col in df.columns:
                    if '领涨' in str(col) and '幅' not in str(col):
                        leading = str(row[col]).strip()
                        if leading == 'nan':
                            leading = ''
                        break
                all_items.append({
                    'name': name,
                    'main_net_inflow': net_val,
                    'leading_stock': leading or None,
                })
        except Exception as e:
            print(f'  [warn] THS 资金流第 {page} 页失败: {e}')

    print(f'  THS 资金流获取: {len(all_items)} 条')
    return all_items if all_items else None


def _normalize_name(name: str) -> str:
    """标准化板块名（同 sector_list.py 中的逻辑）"""
    n = re.sub(r'[（(].*?[）)]', '', name)
    n = re.sub(r'概念$', '', n)
    return n.replace(' ', '').strip()


def collect_fund_flow(sb: Client, today: str) -> dict:
    """
    采集当日概念板块资金流，按板块名匹配写入 sector_daily。
    东财不可用时自动切换同花顺。
    """
    print('[3/4] 采集资金流...')
    now = now_utc_ms()

    items = _fetch_fund_flow()
    use_ths = False

    if items is None or len(items) == 0:
        print('  [warn] 东财资金流 API 不可用，尝试同花顺后备...')
        items = _fetch_fund_flow_ths()
        use_ths = True

    if items is None or len(items) == 0:
        print('  [warn] 所有资金流数据源均不可用，跳过')
        return {'total': 0, 'matched': 0, 'unmatched_names': []}

    print(f'  获取到 {len(items)} 条资金流数据（{"THS" if use_ths else "东财"}）')

    # 查询 sector_daily 中当日已有记录
    existing = (
        sb.table('sector_daily')
        .select('id,sector_name')
        .eq('trade_date', today)
        .execute()
    )
    existing_map = {r['sector_name']: r['id'] for r in existing.data}

    # THS 数据需要名称映射
    if use_ths:
        db_names = set(existing_map.keys())
        src_names = {item['name'] for item in items}
        norm_db = {}
        for dn in db_names:
            k = _normalize_name(dn)
            if k and k not in norm_db:
                norm_db[k] = dn
        name_map = {}
        for sn in src_names:
            if sn in db_names:
                name_map[sn] = sn
            else:
                k = _normalize_name(sn)
                if k in norm_db:
                    name_map[sn] = norm_db[k]

    matched = 0
    unmatched_names = []

    for item in items:
        name = item['name']
        if not name:
            continue

        # THS 数据做名称映射
        if use_ths:
            name = name_map.get(name, name)

        if use_ths:
            fund_data = {
                'main_net_inflow': item['main_net_inflow'],
                'fund_leading_stock': item.get('leading_stock'),
            }
        else:
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
            sb.table('sector_daily').update(fund_data).eq('id', existing_map[name]).execute()
            matched += 1
        else:
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
