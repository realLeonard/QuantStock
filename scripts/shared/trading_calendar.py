"""中国 A 股交易日历（2026 年）

公共模块，所有 Python 采集/评分脚本共用。
数据来源：上交所 2025-12-22 官方公告。

用法：
    from trading_calendar import is_trading_day, is_holiday

    if not is_trading_day('2026-04-22'):
        print('非交易日，跳过采集')
"""

from __future__ import annotations

from datetime import datetime, timedelta

# ── 2026 年 A 股法定节假日（仅工作日部分，周末由 weekday 判断覆盖） ──
# 来源：上海证券交易所 https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
HOLIDAYS_2026: set[str] = {
    # 元旦 1/1(四)~1/3(六)，1/5 开市
    '2026-01-01', '2026-01-02',
    # 春节 2/15(日)~2/23(一)，2/24 开市
    '2026-02-16', '2026-02-17', '2026-02-18',
    '2026-02-19', '2026-02-20', '2026-02-23',
    # 清明 4/4(六)~4/6(一)，4/7 开市
    '2026-04-06',
    # 劳动节 5/1(五)~5/5(二)，5/6 开市
    '2026-05-01', '2026-05-04', '2026-05-05',
    # 端午 6/19(五)~6/21(日)，6/22 开市
    '2026-06-19',
    # 中秋 9/25(五)~9/27(日)，9/28 开市
    '2026-09-25',
    # 国庆 10/1(四)~10/7(三)，10/8 开市
    '2026-10-01', '2026-10-02', '2026-10-05',
    '2026-10-06', '2026-10-07',
}


def is_holiday(date_str: str) -> bool:
    """判断是否为法定节假日（不含周末）。date_str 格式：YYYY-MM-DD"""
    return date_str in HOLIDAYS_2026


def is_weekend(date_str: str) -> bool:
    """判断是否为周末。date_str 格式：YYYY-MM-DD"""
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return d.weekday() >= 5


def is_trading_day(date_str: str) -> bool:
    """判断是否为 A 股交易日（排除周末 + 法定节假日）。date_str 格式：YYYY-MM-DD"""
    return not is_weekend(date_str) and not is_holiday(date_str)


def is_trading_day_today() -> bool:
    """判断今天（北京时间）是否为交易日"""
    from datetime import timezone
    bj_tz = timezone(timedelta(hours=8))
    today = datetime.now(bj_tz).strftime('%Y-%m-%d')
    return is_trading_day(today)


def get_trading_days(from_date: str, to_date: str) -> list[str]:
    """生成日期范围内的所有交易日列表（含首尾）"""
    result = []
    cur = datetime.strptime(from_date, '%Y-%m-%d')
    end = datetime.strptime(to_date, '%Y-%m-%d')
    while cur <= end:
        ds = cur.strftime('%Y-%m-%d')
        if is_trading_day(ds):
            result.append(ds)
        cur += timedelta(days=1)
    return result


def prev_trading_day(date_str: str) -> str:
    """返回给定日期的上一个交易日"""
    cur = datetime.strptime(date_str, '%Y-%m-%d') - timedelta(days=1)
    while True:
        ds = cur.strftime('%Y-%m-%d')
        if is_trading_day(ds):
            return ds
        cur -= timedelta(days=1)


def next_trading_day(date_str: str) -> str:
    """返回给定日期的下一个交易日"""
    cur = datetime.strptime(date_str, '%Y-%m-%d') + timedelta(days=1)
    while True:
        ds = cur.strftime('%Y-%m-%d')
        if is_trading_day(ds):
            return ds
        cur += timedelta(days=1)
