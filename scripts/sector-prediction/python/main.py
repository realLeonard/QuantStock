"""
板块预测系统 — 每日增量采集入口
1. 刷新板块列表 → sector_master
2. 采集最近 5 日 K 线 → sector_daily（upsert）
3. 采集当日资金流 → sector_daily（update/insert）
4. 汇总日志
"""

import os
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

# 将当前目录加入 sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client
from browser import close_browser
from collectors.sector_list import sync_sector_master, write_daily_kline
from collectors.sector_fund_flow import collect_fund_flow

# 交易日历公共模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / 'shared'))
from trading_calendar import is_trading_day_today

# 北京时区
_BJ_TZ = timezone(timedelta(hours=8))


def get_today_bj() -> str:
    """获取当前北京时间日期 YYYY-MM-DD"""
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def main():
    print('=' * 60)
    print('板块预测系统 — 每日增量采集')
    print(f'北京时间: {datetime.now(_BJ_TZ).strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    force = os.environ.get('FORCE_RUN', '').lower() in ('1', 'true', 'yes')
    if not is_trading_day_today() and not force:
        print('今天不是交易日（周末/法定节假日），跳过采集')
        print('提示: 设置 FORCE_RUN=1 可强制运行')
        return

    sb = get_supabase_client()
    today = get_today_bj()

    # [1/4] 刷新板块列表
    sectors = sync_sector_master(sb)
    if not sectors:
        print('[error] 未获取到任何板块，终止')
        sys.exit(1)

    # [2/4] 写入当日 K 线（从板块列表接口获取的 OHLCV）
    kline_result = write_daily_kline(sb, sectors, today)

    # [3/4] 采集资金流
    fund_result = collect_fund_flow(sb, today)

    # [4/4] 汇总日志
    print()
    print('=' * 60)
    print('[4/4] 汇总')
    print(f'  板块总数: {len(sectors)}')
    print(f'  K 线 — 成功: {kline_result["success"]}（新增 {kline_result["inserted"]}，更新 {kline_result["updated"]}）')
    print(f'  资金流 — 匹配: {fund_result["matched"]}/{fund_result["total"]}')
    fund_rate = (
        f'{fund_result["matched"] / fund_result["total"] * 100:.1f}%'
        if fund_result['total'] else 'N/A'
    )
    print(f'  资金流匹配率: {fund_rate}')
    print('=' * 60)

    # 任一数据源有严重问题时以非零退出（触发 Bark 失败通知）
    errors = []
    if kline_result['success'] < len(sectors) * 0.5:
        errors.append(f'K 线成功率不足 50%（{kline_result["success"]}/{len(sectors)}）')
    if fund_result['total'] > 0 and fund_result['matched'] < fund_result['total'] * 0.5:
        errors.append(f'资金流匹配率不足 50%（{fund_result["matched"]}/{fund_result["total"]}）')
    if not sectors:
        errors.append('板块列表为空')

    if errors:
        for e in errors:
            print(f'[FAIL] {e}')
        close_browser()
        sys.exit(1)

    close_browser()


if __name__ == '__main__':
    try:
        main()
    finally:
        close_browser()
