"""K 线采集：直接请求东财 K 线 API → sector_daily

用 curl_cffi 模拟 Chrome TLS 指纹请求东财接口，
绕过东财对 Python urllib3 TLS 指纹的检测封锁。
"""

import math
import random
import time
import uuid

from curl_cffi import requests as cffi_requests
from supabase import Client

from db import now_utc_ms

# 连接错误最大重试次数（设为 1 = 不重试，避免触发风控）
MAX_RETRIES = 1
RETRY_WAIT = [3]

# 东财有多个 push2his 节点（1-99），随机选择避免单节点风控
_PUSH2_NODES = list(range(1, 100))


def _safe_float(val, default=0.0) -> float:
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
    try:
        if val is None:
            return default
        return int(float(val))
    except (ValueError, TypeError):
        return default


def _fetch_kline_direct(bk_code: str, days: int) -> list[str] | None:
    """
    直接请求东财 K 线 API（curl_cffi 模拟 Chrome TLS 指纹）。
    bk_code: 如 "BK0927"
    days: 拉取最近几天
    返回 K 线字符串列表，或 None（失败）。
    """
    params = {
        'secid': f'90.{bk_code}',
        'fields1': 'f1,f2,f3,f4,f5,f6',
        'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        'klt': '101',
        'fqt': '0',
        'lmt': str(days),
        'end': '20500101',
        'ut': 'fa5fd1943c7b386f172d6893dbfba10b',
    }

    for attempt in range(MAX_RETRIES):
        try:
            node = random.choice(_PUSH2_NODES)
            url = f'https://{node}.push2his.eastmoney.com/api/qt/stock/kline/get'
            r = cffi_requests.get(url, params=params, impersonate='chrome', timeout=10)
            data = r.json()
            if data.get('data') and data['data'].get('klines'):
                return data['data']['klines']
            return []
        except Exception as e:
            err_str = str(e)
            if 'Connection' in err_str or 'Timeout' in err_str or 'Remote' in err_str:
                wait = RETRY_WAIT[min(attempt, len(RETRY_WAIT) - 1)]
                print(f'    [retry] {bk_code} 连接异常，等待 {wait}s ({attempt + 1}/{MAX_RETRIES})')
                time.sleep(wait)
            else:
                print(f'    [error] {bk_code}: {e}')
                return None
    return None


def _parse_kline_str(sector_name: str, line: str) -> dict:
    """
    解析东财 K 线字符串。
    格式: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
    """
    parts = line.split(',')
    return {
        'sector_name': sector_name,
        'trade_date': parts[0],
        'open': _safe_float(parts[1]) if len(parts) > 1 else 0.0,
        'close': _safe_float(parts[2]) if len(parts) > 2 else 0.0,
        'high': _safe_float(parts[3]) if len(parts) > 3 else 0.0,
        'low': _safe_float(parts[4]) if len(parts) > 4 else 0.0,
        'volume': _safe_int(parts[5]) if len(parts) > 5 else 0,
        'turnover': _safe_float(parts[6]) if len(parts) > 6 else 0.0,
        'amplitude': _safe_float(parts[7]) if len(parts) > 7 else 0.0,
        'change_pct': _safe_float(parts[8]) if len(parts) > 8 else 0.0,
        'turnover_rate': _safe_float(parts[10]) if len(parts) > 10 else 0.0,
    }


def collect_kline_batch(
    sb: Client,
    sectors: list[dict],
    days: int = 5,
    batch_size: int = 50,
    sleep_between_batches: float = 5.0,
    sleep_between_sectors: float = 0.3,
) -> dict:
    """
    批量采集板块 K 线并 upsert 到 sector_daily。
    """
    print(f'[2/4] 采集 K 线（最近 {days} 日，共 {len(sectors)} 个板块）...')
    now = now_utc_ms()
    success = 0
    failed = 0
    skipped = 0
    failed_names = []

    for batch_idx in range(0, len(sectors), batch_size):
        batch = sectors[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1
        total_batches = (len(sectors) + batch_size - 1) // batch_size
        print(f'  批次 {batch_num}/{total_batches}（{len(batch)} 个板块）')

        for sector in batch:
            name = sector['name']
            bk_code = sector.get('bk_code', '')

            if not bk_code:
                skipped += 1
                continue

            klines = _fetch_kline_direct(bk_code, days)
            if klines is None:
                failed += 1
                failed_names.append(name)
                time.sleep(sleep_between_sectors)
                continue

            if not klines:
                skipped += 1
                time.sleep(sleep_between_sectors)
                continue

            records = []
            for line in klines:
                record = _parse_kline_str(name, line)
                record['id'] = str(uuid.uuid4())
                record['created_at'] = now
                records.append(record)

            if records:
                _upsert_kline_records(sb, records)

            success += 1
            time.sleep(sleep_between_sectors)

        # 批间暂停
        if batch_idx + batch_size < len(sectors):
            print(f'  批间暂停 {sleep_between_batches}s...')
            time.sleep(sleep_between_batches)

    print(f'  K 线采集完成: 成功 {success}，失败 {failed}，跳过 {skipped}')
    if failed_names[:10]:
        print(f'  失败板块（前10）: {", ".join(failed_names[:10])}')

    return {'success': success, 'failed': failed, 'skipped': skipped, 'failed_names': failed_names}


def _upsert_kline_records(sb: Client, records: list[dict]) -> None:
    """Upsert K 线记录到 sector_daily"""
    if not records:
        return

    sector_name = records[0]['sector_name']
    dates = [r['trade_date'] for r in records]

    existing = (
        sb.table('sector_daily')
        .select('id,trade_date')
        .eq('sector_name', sector_name)
        .in_('trade_date', dates)
        .execute()
    )
    existing_map = {r['trade_date']: r['id'] for r in existing.data}

    to_insert = []
    to_update = []

    for record in records:
        td = record['trade_date']
        if td in existing_map:
            update_data = {k: v for k, v in record.items() if k not in ('id', 'created_at')}
            to_update.append((existing_map[td], update_data))
        else:
            to_insert.append(record)

    if to_insert:
        sb.table('sector_daily').insert(to_insert).execute()

    for record_id, data in to_update:
        sb.table('sector_daily').update(data).eq('id', record_id).execute()
