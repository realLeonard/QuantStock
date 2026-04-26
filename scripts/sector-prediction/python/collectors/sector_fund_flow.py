"""资金流采集：Playwright 浏览器 JSONP → sector_daily

在东财页面中注入 JSONP script 标签请求资金流 API，
用真实浏览器 TLS 指纹绕过东财检测。
"""

import math
import uuid

from supabase import Client

from db import now_utc_ms
from browser import get_page


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


def _fetch_fund_flow_jsonp() -> list[dict] | None:
    """
    通过 Playwright JSONP 请求东财概念板块资金流 API。
    返回全部板块资金流列表。
    """
    page = get_page()

    all_items = []
    page_num = 1
    page_size = 100

    while True:
        try:
            result = page.evaluate('''({ pn, pz }) => {
                return new Promise((resolve, reject) => {
                    const cb = 'ff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                    window[cb] = (data) => {
                        delete window[cb];
                        try { document.head.removeChild(s); } catch(e) {}
                        if (data && data.data && data.data.diff) {
                            resolve({ items: data.data.diff, total: data.data.total });
                        } else {
                            resolve({ items: [], total: 0 });
                        }
                    };
                    const s = document.createElement('script');
                    s.src = 'https://push2.eastmoney.com/api/qt/clist/get?cb=' + cb
                        + '&pn=' + pn + '&pz=' + pz
                        + '&po=1&np=1'
                        + '&ut=b2884a393a59ad64002292a3e90d46a5'
                        + '&fltt=2&invt=2&fid0=f62'
                        + '&fs=m:90+t:3&stat=1'
                        + '&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124'
                        + '&_=' + Date.now();
                    s.onerror = () => {
                        delete window[cb];
                        try { document.head.removeChild(s); } catch(e) {}
                        reject('load_error');
                    };
                    document.head.appendChild(s);
                    setTimeout(() => {
                        if (window[cb]) { delete window[cb]; reject('timeout'); }
                    }, 10000);
                });
            }''', {'pn': page_num, 'pz': page_size})
        except Exception as e:
            print(f'  [error] 资金流 JSONP 请求失败: {e}')
            return None

        items = result.get('items', [])
        total = result.get('total', 0)

        if not items:
            if page_num == 1:
                return None
            break

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

    items = _fetch_fund_flow_jsonp()
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
