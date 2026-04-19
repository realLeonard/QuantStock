"""K 线采集：直接请求东财 K 线 API → sector_daily

绕过 akshare 的 stock_board_concept_hist_em（每次调用都会先拉全量板块列表，
触发东财 push2 接口风控）。直接用 BK 代码请求 push2his.eastmoney.com。
"""

import json
import math
import random
import subprocess
import time
import uuid

from supabase import Client

from db import now_utc_ms

# 连接错误最大重试次数
MAX_RETRIES = 3
RETRY_WAIT = [3, 8, 15]

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


def _fetch_kline_direct(bk_code: str, days: int) -> list[dict] | None:
    """
    直接请求东财 K 线 API。
    bk_code: 如 "BK0927"
    days: 拉取最近几天
    返回 K 线数据列表，或 None（失败）。
    """
    params = {
        'secid': f'90.{bk_code}',
        'fields1': 'f1,f2,f3,f4,f5,f6',
        'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        'klt': '101',  # 日K
        'fqt': '0',    # 不复权
        'lmt': str(days),
        'end': '20500101',
        'ut': 'fa5fd1943c7b386f172d6893dbfba10b',
    }

    for attempt in range(MAX_RETRIES):
        try:
            node = random.choice(_PUSH2_NODES)
            url = f'https://{node}.push2his.eastmoney.com/api/qt/stock/kline/get'
            # 构建查询字符串
            qs = '&'.join(f'{k}={v}' for k, v in params.items())
            full_url = f'{url}?{qs}'

            # 用 curl 替代 requests（东财检测 Python urllib3 TLS 指纹会拒绝连接）
            result = subprocess.run(
                ['curl', '-s', '--connect-timeout', '10', '-H', 'User-Agent: Mozilla/5.0',
                 full_url],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode != 0:
                raise ConnectionError(f'curl 返回码 {result.returncode}')

            data = json.loads(result.stdout)
            if data.get('data') and data['data'].get('klines'):
                return data['data']['klines']
            return []
        except (ConnectionError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
            wait = RETRY_WAIT[min(attempt, len(RETRY_WAIT) - 1)]
            print(f'    [retry] {bk_code} 连接异常，等待 {wait}s ({attempt + 1}/{MAX_RETRIES})')
            time.sleep(wait)
        except Exception as e:
            print(f'    [error] {bk_code}: {e}')
            return None
    return None


def _parse_kline_str(sector_name: str, line: str) -> dict:
    """
    解析东财 K 线字符串。
    格式: 日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
    示例: 2026-04-13,1310.74,1313.43,1317.57,1306.99,4206957,4197969576.00,0.80,-0.22,-2.89,0.57
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
    batch_size: int = 30,
    sleep_between_batches: float = 10.0,
    sleep_between_sectors: float = 0.5,
) -> dict:
    """
    批量采集板块 K 线并 upsert 到 sector_daily。

    参数:
      sectors: [{name, bk_code}, ...] active 板块列表
      days: 拉取最近几日的数据（每日增量用 5，初始化用 60）
      batch_size: 每批处理板块数
      sleep_between_batches: 批间 sleep 秒数
      sleep_between_sectors: 板块间 sleep 秒数

    返回: {success: int, failed: int, skipped: int, failed_names: [str]}
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

        # 批间暂停（最后一批不用等）
        if batch_idx + batch_size < len(sectors):
            print(f'  批间暂停 {sleep_between_batches}s...')
            time.sleep(sleep_between_batches)

    print(f'  K 线采集完成: 成功 {success}，失败 {failed}，跳过 {skipped}')
    if failed_names[:10]:
        print(f'  失败板块（前10）: {", ".join(failed_names[:10])}')

    return {'success': success, 'failed': failed, 'skipped': skipped, 'failed_names': failed_names}


def _upsert_kline_records(sb: Client, records: list[dict]) -> None:
    """
    Upsert K 线记录。利用 UNIQUE(sector_name, trade_date) 约束，
    通过先查再决定 insert/update 实现。
    """
    if not records:
        return

    sector_name = records[0]['sector_name']
    dates = [r['trade_date'] for r in records]

    # 查询已有记录
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
            # 更新 K 线字段（保留已有的资金流字段）
            update_data = {k: v for k, v in record.items() if k not in ('id', 'created_at')}
            to_update.append((existing_map[td], update_data))
        else:
            to_insert.append(record)

    if to_insert:
        sb.table('sector_daily').insert(to_insert).execute()

    for record_id, data in to_update:
        sb.table('sector_daily').update(data).eq('id', record_id).execute()
