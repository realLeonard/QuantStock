"""K 线采集：Playwright 浏览器 JSONP → sector_daily

在东财页面中注入 JSONP script 标签请求 K 线 API，
用真实浏览器 TLS 指纹绕过东财检测。
"""

import math
import time
import uuid

from supabase import Client

from db import now_utc_ms
from browser import get_page


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


def _fetch_kline_jsonp(bk_code: str, days: int) -> list[str] | None:
    """
    通过 Playwright JSONP 请求东财 K 线 API。
    返回 K 线字符串列表，或 None（失败）。
    """
    page = get_page()

    try:
        result = page.evaluate('''({ bkCode, days }) => {
            return new Promise((resolve, reject) => {
                const cb = 'kl_' + bkCode + '_' + Date.now();
                const node = Math.floor(Math.random() * 99) + 1;
                window[cb] = (data) => {
                    delete window[cb];
                    try { document.head.removeChild(s); } catch(e) {}
                    if (data && data.data && data.data.klines) {
                        resolve(data.data.klines);
                    } else {
                        resolve([]);
                    }
                };
                const s = document.createElement('script');
                s.src = 'https://' + node + '.push2his.eastmoney.com/api/qt/stock/kline/get?cb=' + cb
                    + '&secid=90.' + bkCode
                    + '&fields1=f1,f2,f3,f4,f5,f6'
                    + '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
                    + '&klt=101&fqt=0&lmt=' + days
                    + '&end=20500101'
                    + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
                s.onerror = () => {
                    delete window[cb];
                    try { document.head.removeChild(s); } catch(e) {}
                    reject('load_error');
                };
                document.head.appendChild(s);
                setTimeout(() => {
                    if (window[cb]) {
                        delete window[cb];
                        try { document.head.removeChild(s); } catch(e) {}
                        reject('timeout');
                    }
                }, 10000);
            });
        }''', {'bkCode': bk_code, 'days': days})
        return result if result else []
    except Exception as e:
        print(f'    [error] {bk_code} JSONP 失败: {e}')
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
    sleep_between_batches: float = 3.0,
    sleep_between_sectors: float = 0.5,
) -> dict:
    """批量采集板块 K 线并 upsert 到 sector_daily。"""
    print(f'[2/4] 采集 K 线（最近 {days} 日，共 {len(sectors)} 个板块）...')
    now = now_utc_ms()
    success = 0
    failed = 0
    skipped = 0
    failed_names = []
    consecutive_fails = 0
    MAX_CONSECUTIVE_FAILS = 10  # 连续失败超过此数则熔断跳过

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

            klines = _fetch_kline_jsonp(bk_code, days)
            if klines is None:
                failed += 1
                consecutive_fails += 1
                failed_names.append(name)
                if consecutive_fails >= MAX_CONSECUTIVE_FAILS:
                    print(f'  [熔断] 连续失败 {consecutive_fails} 次，跳过 K 线采集')
                    print(f'  K 线采集中断: 成功 {success}，失败 {failed}，跳过 {skipped}')
                    return {'success': success, 'failed': failed, 'skipped': skipped, 'failed_names': failed_names}
                time.sleep(sleep_between_sectors)
                continue

            if not klines:
                skipped += 1
                consecutive_fails = 0
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
            consecutive_fails = 0
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
