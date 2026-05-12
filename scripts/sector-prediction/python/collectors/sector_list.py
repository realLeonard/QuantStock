"""板块列表采集：东财 API（主） + 同花顺 akshare（后备） → sector_master + sector_daily K线"""

import math
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone

import requests
from supabase import Client

from db import now_utc_ms

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

# 非真实概念板块的关键词（筛选类/规模类/季报类）
_EXCLUDE_KEYWORDS = [
    '新高', '新低', '预增', '预减', '预亏', '扭亏', '预盈',
    '大盘股', '中盘股', '小盘股', '大盘', '中盘', '小盘',
    '价值', '成长', '破发', '破净',
    '次新股', '注册制次新',
    '中报', '年报', '季报',
]
_EXCLUDE_PATTERN = re.compile('|'.join(re.escape(k) for k in _EXCLUDE_KEYWORDS))


def _is_real_concept(name: str) -> bool:
    """判断板块名称是否为真实概念板块（排除筛选类/规模类/季报类）"""
    return not _EXCLUDE_PATTERN.search(name)


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
    'fltt': '2', 'invt': '2',
    'fid': 'f3', 'fs': 'm:90+t:3',
    'fields': 'f12,f14,f2,f3,f4,f5,f6,f7,f8,f10,f15,f16,f17,f20,f104,f105,f106,f107,f128,f136,f124',
}


def _fetch_sector_list() -> list[dict] | None:
    """
    通过 curl_cffi + Chrome TLS 指纹拉取东财概念板块列表。
    失败自动重试 1 次（间隔 10s）。
    """
    try:
        return _fetch_sector_list_once()
    except Exception as e:
        print(f'  [warn] 板块列表请求失败，10s 后重试: {e}')
        time.sleep(10)
        try:
            return _fetch_sector_list_once()
        except Exception as e2:
            print(f'  [error] 板块列表请求重试仍失败: {e2}')
            return None


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

    # 直连 79.push2（plain requests）
    try:
        resp = requests.get(
            _API_URL, params=params, headers=_HEADERS, timeout=15,
        )
        data = resp.json()
        if data.get('data', {}).get('diff'):
            return data
    except Exception:
        pass

    # 回退到 curl_cffi（本地 TLS 指纹绕过）
    if cffi_requests:
        resp = cffi_requests.get(
            _API_URL_FALLBACK, params=params, headers=_HEADERS,
            impersonate='chrome', timeout=15,
        )
        return resp.json()

    raise RuntimeError('所有东财请求方式均失败')


def _fetch_sector_list_once() -> list[dict] | None:
    """单次尝试拉取板块列表"""
    all_items = []
    page_num = 1
    page_size = 100

    while True:
        params = {**_COMMON_PARAMS, 'pn': str(page_num), 'pz': str(page_size)}
        data = _do_request(params)

        diff = data.get('data', {}).get('diff') if data.get('data') else None
        total = data.get('data', {}).get('total', 0) if data.get('data') else 0

        if not diff:
            if page_num == 1:
                return None
            break

        for item in diff:
            all_items.append({
                'name': str(item.get('f14', '')).strip(),
                'bk_code': str(item.get('f12', '')).strip(),
                'change_pct': _safe_float(item.get('f3')),
                'leading_stock': str(item.get('f128', '')).strip() if item.get('f128') != '-' else '',
                'open': _safe_float(item.get('f17')),
                'close': _safe_float(item.get('f2')),
                'high': _safe_float(item.get('f15')),
                'low': _safe_float(item.get('f16')),
                'volume': _safe_int(item.get('f5')),
                'turnover': _safe_float(item.get('f6')),
                'amplitude': _safe_float(item.get('f7')),
                'turnover_rate': _safe_float(item.get('f8')),
                'volume_ratio': _safe_float(item.get('f10')),
                'up_count': _safe_int(item.get('f104')),
                'down_count': _safe_int(item.get('f105')),
                'limit_up_count': _safe_int(item.get('f106')),
                'limit_down_count': _safe_int(item.get('f107')),
            })

        if page_num * page_size >= total:
            break
        page_num += 1

    return all_items


def _fetch_sector_list_ths(trade_date: str) -> list[dict] | None:
    """THS 后备：通过 akshare 从同花顺获取概念板块 OHLCV"""
    try:
        import akshare as ak
    except ImportError:
        print('  [error] akshare 未安装，无法使用 THS 后备')
        return None

    print('  [info] 切换到同花顺数据源...')

    try:
        concepts = ak.stock_board_concept_name_ths()
    except Exception as e:
        print(f'  [error] THS 概念列表获取失败: {e}')
        return None

    ths_names = list(concepts['name'])
    code_map = dict(zip(concepts['name'], concepts['code']))
    print(f'  THS 概念板块数: {len(ths_names)}')

    dt = datetime.strptime(trade_date, '%Y-%m-%d')
    start = (dt - timedelta(days=10)).strftime('%Y%m%d')
    end = dt.strftime('%Y%m%d')

    results = []
    failed = 0

    for i, name in enumerate(ths_names):
        if (i + 1) % 50 == 0:
            print(f'  进度: {i + 1}/{len(ths_names)}')
        try:
            df = ak.stock_board_concept_index_ths(
                symbol=name, start_date=start, end_date=end,
            )
            if len(df) == 0:
                continue

            today_row = df.iloc[-1]
            close = float(today_row['收盘价'])
            prev_close = float(df.iloc[-2]['收盘价']) if len(df) >= 2 else close
            high = float(today_row['最高价'])
            low = float(today_row['最低价'])

            change_pct = round((close - prev_close) / prev_close * 100, 2) if prev_close else 0
            amplitude = round((high - low) / prev_close * 100, 2) if prev_close else 0

            results.append({
                'name': name,
                'bk_code': str(code_map.get(name, '')),
                'change_pct': change_pct,
                'leading_stock': '',
                'open': float(today_row['开盘价']),
                'close': close,
                'high': high,
                'low': low,
                'volume': int(today_row['成交量']),
                'turnover': float(today_row['成交额']),
                'amplitude': amplitude,
                'turnover_rate': 0,
                'volume_ratio': 0,
                'up_count': 0,
                'down_count': 0,
                'limit_up_count': 0,
                'limit_down_count': 0,
            })
        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f'  [warn] THS {name} 失败: {e}')

    if failed:
        print(f'  THS 获取失败: {failed}/{len(ths_names)}')

    print(f'  THS OHLCV 获取完成: {len(results)} 条')
    return results if results else None


def _sync_via_ths(sb: Client, trade_date: str) -> list[dict]:
    """THS 后备路径：不修改 sector_master，只返回 OHLCV 供写入 sector_daily"""
    active = sb.table('sector_master').select('name,bk_code').eq('is_active', True).execute()
    existing_names = {r['name'] for r in active.data}

    ths_items = _fetch_sector_list_ths(trade_date)
    if not ths_items:
        return []

    # 只保留 DB 中已存在的板块（避免 THS 独有板块导致数据不一致）
    matched = [item for item in ths_items if item['name'] in existing_names]
    unmatched_count = len(ths_items) - len(matched)

    print(f'  THS 匹配 DB 已有板块: {len(matched)}/{len(ths_items)}（{unmatched_count} 个 THS 独有板块已忽略）')
    print(f'  当前 active 板块总数: {len(matched)}')
    return matched


def sync_sector_master(sb: Client, trade_date: str = '') -> list[dict]:
    """
    拉取东财概念板块列表，upsert 到 sector_master。
    东财不可用时自动切换同花顺。
    返回 active 板块列表（含 name, bk_code）。
    """
    if not trade_date:
        _bj_tz = timezone(timedelta(hours=8))
        trade_date = datetime.now(_bj_tz).strftime('%Y-%m-%d')

    print('[1/4] 刷新板块列表...')
    items = _fetch_sector_list()
    if not items:
        print('  [warn] 东财 API 不可用，启用同花顺后备...')
        return _sync_via_ths(sb, trade_date)

    # 过滤非真实概念板块
    excluded = [it for it in items if not _is_real_concept(it['name'])]
    items = [it for it in items if _is_real_concept(it['name'])]
    print(f'  获取到 {len(items) + len(excluded)} 个板块，排除 {len(excluded)} 个非概念板块')
    if excluded[:5]:
        print(f'  排除示例: {", ".join(it["name"] for it in excluded[:5])}')

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

    # 标记不在 API 列表中的板块 + 被排除的非概念板块为 inactive
    excluded_names = {it['name'] for it in excluded}
    inactive_names = (set(existing_map.keys()) - api_names) | (excluded_names & set(existing_map.keys()))
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

    # 返回所有 active 板块（含 OHLCV 数据，供写入 sector_daily）
    active_sectors = sb.table('sector_master').select('name,bk_code').eq('is_active', True).execute()
    # 把 OHLCV 数据附加到返回结果中
    ohlcv_map = {it['name']: it for it in items}
    result_sectors = []
    for s in active_sectors.data:
        merged = dict(s)
        if s['name'] in ohlcv_map:
            src = ohlcv_map[s['name']]
            merged.update({
                'open': src['open'],
                'close': src['close'],
                'high': src['high'],
                'low': src['low'],
                'volume': src['volume'],
                'turnover': src['turnover'],
                'amplitude': src['amplitude'],
                'change_pct': src['change_pct'],
                'turnover_rate': src['turnover_rate'],
                # v3 新增字段
                'volume_ratio': src.get('volume_ratio', 0),
                'up_count': src.get('up_count', 0),
                'down_count': src.get('down_count', 0),
                'limit_up_count': src.get('limit_up_count', 0),
                'limit_down_count': src.get('limit_down_count', 0),
            })
        result_sectors.append(merged)

    print(f'  当前 active 板块总数: {len(result_sectors)}')
    return result_sectors


def write_daily_kline(sb: Client, sectors: list[dict], trade_date: str) -> dict:
    """
    把板块列表接口获取的当日 OHLCV 数据写入 sector_daily。
    替代原来的 K 线单独采集步骤（push2his.eastmoney.com 在 Actions 上被限流）。
    """
    print(f'[2/4] 写入当日 K 线（{trade_date}，{len(sectors)} 个板块）...')
    now = now_utc_ms()
    success = 0
    skipped = 0

    # 查询已有记录（今日）
    existing = (
        sb.table('sector_daily')
        .select('id,sector_name')
        .eq('trade_date', trade_date)
        .execute()
    )
    existing_map = {r['sector_name']: r['id'] for r in existing.data}

    to_insert = []
    to_update = []

    for s in sectors:
        name = s.get('name', '')
        # 没有 OHLCV 数据的板块跳过
        if 'open' not in s or s.get('close', 0) == 0:
            skipped += 1
            continue

        kline_data = {
            'sector_name': name,
            'trade_date': trade_date,
            'open': s['open'],
            'close': s['close'],
            'high': s['high'],
            'low': s['low'],
            'volume': s['volume'],
            'turnover': s['turnover'],
            'amplitude': s['amplitude'],
            'change_pct': s['change_pct'],
            'turnover_rate': s['turnover_rate'],
            # v3 新增字段
            'volume_ratio': s.get('volume_ratio', 0),
            'up_count': s.get('up_count', 0),
            'down_count': s.get('down_count', 0),
            'limit_up_count': s.get('limit_up_count', 0),
            'limit_down_count': s.get('limit_down_count', 0),
        }

        if name in existing_map:
            to_update.append((existing_map[name], kline_data))
        else:
            kline_data['id'] = str(uuid.uuid4())
            kline_data['created_at'] = now
            to_insert.append(kline_data)

        success += 1

    # 批量 insert
    if to_insert:
        for i in range(0, len(to_insert), 100):
            batch = to_insert[i:i + 100]
            sb.table('sector_daily').insert(batch).execute()

    # 逐条 update（只更新 K 线字段，不覆盖资金流字段）
    for record_id, data in to_update:
        update_data = {k: v for k, v in data.items() if k not in ('sector_name', 'trade_date')}
        sb.table('sector_daily').update(update_data).eq('id', record_id).execute()

    print(f'  K 线写入完成: {success} 个（新增 {len(to_insert)}，更新 {len(to_update)}），跳过 {skipped}')
    return {'success': success, 'inserted': len(to_insert), 'updated': len(to_update), 'skipped': skipped}
