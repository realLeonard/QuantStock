"""板块列表采集：东财概念板块列表 API（JSONP）→ sector_master"""

import math
import uuid

from supabase import Client

from db import now_utc_ms
from browser import get_page


def _safe_float(val, default=0.0) -> float:
    """安全转换为 float"""
    try:
        if val is None:
            return default
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def _safe_int(val, default=0) -> int:
    """安全转换为 int"""
    try:
        if val is None:
            return default
        return int(float(val))
    except (ValueError, TypeError):
        return default


def _fetch_sector_list_jsonp() -> list[dict] | None:
    """
    通过 Playwright 在东财页面中用 JSONP 拉取概念板块列表。
    等同于 akshare 的 stock_board_concept_name_em()，但用浏览器绕过 TLS 检测。
    """
    page = get_page()

    all_items = []
    page_num = 1
    page_size = 100

    while True:
        result = page.evaluate('''({ pn, pz }) => {
            return new Promise((resolve, reject) => {
                const cb = 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
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
                    + '&po=1&np=1&fltt=2&invt=2'
                    + '&fid=f3&fs=m:90+t:3'
                    + '&fields=f12,f14,f2,f3,f4,f8,f20,f128,f136,f124'
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

        items = result.get('items', [])
        total = result.get('total', 0)

        if not items:
            if page_num == 1:
                return None
            break

        for item in items:
            all_items.append({
                'name': str(item.get('f14', '')).strip(),
                'bk_code': str(item.get('f12', '')).strip(),
                'change_pct': _safe_float(item.get('f3')),
                'leading_stock': str(item.get('f128', '')).strip() if item.get('f128') != '-' else '',
            })

        if page_num * page_size >= total:
            break
        page_num += 1

    return all_items


def sync_sector_master(sb: Client) -> list[dict]:
    """
    拉取东财概念板块列表，upsert 到 sector_master。
    返回 active 板块列表（含 name, bk_code）。
    """
    print('[1/4] 刷新板块列表...')
    items = _fetch_sector_list_jsonp()
    if not items:
        print('  [error] 板块列表 API 返回为空')
        return []

    print(f'  获取到 {len(items)} 个概念板块')

    # 获取已有板块
    existing = sb.table('sector_master').select('name,id').execute()
    existing_map = {r['name']: r['id'] for r in existing.data}

    now = now_utc_ms()
    api_names = set()
    to_insert = []
    to_update = []

    for item in items:
        name = item['name']
        if not name:
            continue
        api_names.add(name)

        if name in existing_map:
            to_update.append({
                'id': existing_map[name],
                'name': name,
                'bk_code': item['bk_code'],
                'change_pct': item['change_pct'],
                'leading_stock': item['leading_stock'],
                'is_active': True,
                'updated_at': now,
            })
        else:
            to_insert.append({
                'id': str(uuid.uuid4()),
                'name': name,
                'bk_code': item['bk_code'],
                'change_pct': item['change_pct'],
                'leading_stock': item['leading_stock'],
                'is_active': True,
                'created_at': now,
                'updated_at': now,
            })

    # 标记不在 API 列表中的板块为 inactive
    inactive_names = set(existing_map.keys()) - api_names
    for name in inactive_names:
        to_update.append({
            'id': existing_map[name],
            'is_active': False,
            'updated_at': now,
        })

    # 批量写入
    if to_insert:
        for i in range(0, len(to_insert), 100):
            batch = to_insert[i:i + 100]
            sb.table('sector_master').insert(batch).execute()
        print(f'  新增 {len(to_insert)} 个板块')

    if to_update:
        for record in to_update:
            sb.table('sector_master').update(record).eq('id', record['id']).execute()
        active_updates = sum(1 for r in to_update if r.get('is_active', True))
        inactive_count = len(to_update) - active_updates
        print(f'  更新 {active_updates} 个板块，标记 {inactive_count} 个为 inactive')

    # 返回所有 active 板块
    active_sectors = sb.table('sector_master').select('name,bk_code').eq('is_active', True).execute()
    print(f'  当前 active 板块总数: {len(active_sectors.data)}')
    return active_sectors.data
