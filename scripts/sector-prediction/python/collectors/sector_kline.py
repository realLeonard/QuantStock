"""K 线采集：stock_board_concept_hist_em() → sector_daily"""

import math
import time
import uuid

import akshare as ak
import pandas as pd
from supabase import Client

from db import now_utc_ms

# 连接错误最大重试次数
MAX_RETRIES = 3
# 重试等待秒数（逐次递增）
RETRY_WAIT = [10, 30, 60]


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


def _parse_kline_row(sector_name: str, row: pd.Series) -> dict:
    """将一行 K 线 DataFrame 转换为 sector_daily 记录"""
    date_val = row.get('日期')
    if isinstance(date_val, pd.Timestamp):
        trade_date = date_val.strftime('%Y-%m-%d')
    else:
        trade_date = str(date_val)[:10]

    return {
        'sector_name': sector_name,
        'trade_date': trade_date,
        'open': _safe_float(row.get('开盘')),
        'close': _safe_float(row.get('收盘')),
        'high': _safe_float(row.get('最高')),
        'low': _safe_float(row.get('最低')),
        'change_pct': _safe_float(row.get('涨跌幅')),
        'volume': _safe_int(row.get('成交量')),
        'turnover': _safe_float(row.get('成交额')),
        'amplitude': _safe_float(row.get('振幅')),
        'turnover_rate': _safe_float(row.get('换手率')),
    }


def _fetch_kline_with_retry(name: str) -> pd.DataFrame | None:
    """带重试的 K 线请求，遇到连接断开时等待后重试"""
    for attempt in range(MAX_RETRIES):
        try:
            df = ak.stock_board_concept_hist_em(
                symbol=name,
                period='daily',
                adjust='',
            )
            return df
        except (ConnectionError, ConnectionResetError, ConnectionAbortedError) as e:
            wait = RETRY_WAIT[min(attempt, len(RETRY_WAIT) - 1)]
            print(f'    [retry] {name} 连接断开，等待 {wait}s 后重试 ({attempt + 1}/{MAX_RETRIES})')
            time.sleep(wait)
        except Exception as e:
            # 非连接类错误，检查是否是 requests 库的连接错误
            err_str = str(e)
            if 'RemoteDisconnected' in err_str or 'Connection aborted' in err_str:
                wait = RETRY_WAIT[min(attempt, len(RETRY_WAIT) - 1)]
                print(f'    [retry] {name} 远端断连，等待 {wait}s 后重试 ({attempt + 1}/{MAX_RETRIES})')
                time.sleep(wait)
            else:
                raise
    return None


def collect_kline_batch(
    sb: Client,
    sectors: list[dict],
    days: int = 5,
    batch_size: int = 30,
    sleep_between_batches: float = 10.0,
    sleep_between_sectors: float = 1.0,
) -> dict:
    """
    批量采集板块 K 线并 upsert 到 sector_daily。

    参数:
      sectors: [{name, bk_code}, ...] active 板块列表
      days: 拉取最近几日的数据（每日增量用 5，初始化用 60）
      batch_size: 每批处理板块数
      sleep_between_batches: 批间 sleep 秒数
      sleep_between_sectors: 板块间 sleep 秒数

    返回: {success: int, failed: int, failed_names: [str]}
    """
    print(f'[2/4] 采集 K 线（最近 {days} 日，共 {len(sectors)} 个板块）...')
    now = now_utc_ms()
    success = 0
    failed = 0
    failed_names = []

    for batch_idx in range(0, len(sectors), batch_size):
        batch = sectors[batch_idx:batch_idx + batch_size]
        batch_num = batch_idx // batch_size + 1
        total_batches = (len(sectors) + batch_size - 1) // batch_size
        print(f'  批次 {batch_num}/{total_batches}（{len(batch)} 个板块）')

        for sector in batch:
            name = sector['name']
            try:
                df = _fetch_kline_with_retry(name)
                if df is None or (hasattr(df, 'empty') and df.empty):
                    print(f'    [warn] {name} K 线为空（重试后仍失败）')
                    failed += 1
                    failed_names.append(name)
                    time.sleep(sleep_between_sectors)
                    continue

                # 只取最近 days 天
                df = df.tail(days)

                records = []
                for _, row in df.iterrows():
                    record = _parse_kline_row(name, row)
                    record['id'] = str(uuid.uuid4())
                    record['created_at'] = now
                    records.append(record)

                if records:
                    _upsert_kline_records(sb, records)

                success += 1
            except Exception as e:
                print(f'    [error] {name}: {e}')
                failed += 1
                failed_names.append(name)

            time.sleep(sleep_between_sectors)

        # 批间暂停（最后一批不用等）
        if batch_idx + batch_size < len(sectors):
            print(f'  批间暂停 {sleep_between_batches}s...')
            time.sleep(sleep_between_batches)

    print(f'  K 线采集完成: 成功 {success}，失败 {failed}')
    if failed_names[:10]:
        print(f'  失败板块（前10）: {", ".join(failed_names[:10])}')

    return {'success': success, 'failed': failed, 'failed_names': failed_names}


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
