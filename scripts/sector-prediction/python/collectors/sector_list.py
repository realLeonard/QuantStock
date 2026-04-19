"""板块列表采集：stock_board_concept_name_em() → sector_master"""

import math
import uuid

import akshare as ak
from supabase import Client

from db import now_utc_ms


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


def sync_sector_master(sb: Client) -> list[dict]:
    """
    拉取东财概念板块列表，upsert 到 sector_master。
    返回 active 板块列表（含 name, bk_code）。
    """
    print('[1/4] 刷新板块列表...')
    df = ak.stock_board_concept_name_em()
    if df is None or df.empty:
        print('  [error] stock_board_concept_name_em() 返回为空')
        return []

    print(f'  获取到 {len(df)} 个概念板块')

    # 获取已有板块
    existing = sb.table('sector_master').select('name,id').execute()
    existing_map = {r['name']: r['id'] for r in existing.data}

    now = now_utc_ms()
    api_names = set()
    to_insert = []
    to_update = []

    for _, row in df.iterrows():
        name = str(row.get('板块名称', '')).strip()
        if not name:
            continue
        api_names.add(name)

        bk_code = str(row.get('板块代码', '')).strip()
        stock_count = _safe_int(row.get('上涨家数', 0)) + _safe_int(row.get('下跌家数', 0))
        change_pct = _safe_float(row.get('涨跌幅'))
        leading_stock = str(row.get('领涨股票', '')).strip()

        if name in existing_map:
            to_update.append({
                'id': existing_map[name],
                'name': name,
                'bk_code': bk_code,
                'stock_count': stock_count,
                'change_pct': change_pct,
                'leading_stock': leading_stock,
                'is_active': True,
                'updated_at': now,
            })
        else:
            to_insert.append({
                'id': str(uuid.uuid4()),
                'name': name,
                'bk_code': bk_code,
                'stock_count': stock_count,
                'change_pct': change_pct,
                'leading_stock': leading_stock,
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
        # 分批插入，每批 100 条
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
