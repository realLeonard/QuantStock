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
from collectors.sector_list import sync_sector_master
from collectors.sector_kline import collect_kline_batch
from collectors.sector_fund_flow import collect_fund_flow

# 北京时区
_BJ_TZ = timezone(timedelta(hours=8))


def is_trade_day() -> bool:
    """判断今天是否为交易日（简单版：排除周末）"""
    now = datetime.now(_BJ_TZ)
    return now.weekday() < 5  # 周一到周五


def get_today_bj() -> str:
    """获取当前北京时间日期 YYYY-MM-DD"""
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def main():
    print('=' * 60)
    print('板块预测系统 — 每日增量采集')
    print(f'北京时间: {datetime.now(_BJ_TZ).strftime("%Y-%m-%d %H:%M:%S")}')
    print('=' * 60)

    force = os.environ.get('FORCE_RUN', '').lower() in ('1', 'true', 'yes')
    if not is_trade_day() and not force:
        print('今天不是交易日（周末），跳过采集')
        print('提示: 设置 FORCE_RUN=1 可强制运行')
        return

    sb = get_supabase_client()
    today = get_today_bj()

    # [1/4] 刷新板块列表
    sectors = sync_sector_master(sb)
    if not sectors:
        print('[error] 未获取到任何板块，终止')
        sys.exit(1)

    # [2/4] 采集 K 线（最近 5 日，容错节假日）
    kline_result = collect_kline_batch(
        sb,
        sectors,
        days=5,
        batch_size=50,
        sleep_between_batches=5.0,
        sleep_between_sectors=0.3,
    )

    # [3/4] 采集资金流
    fund_result = collect_fund_flow(sb, today)

    # [4/4] 汇总日志
    print()
    print('=' * 60)
    print('[4/4] 汇总')
    print(f'  板块总数: {len(sectors)}')
    print(f'  K 线 — 成功: {kline_result["success"]}，失败: {kline_result["failed"]}')
    kline_rate = (
        f'{kline_result["success"] / len(sectors) * 100:.1f}%'
        if sectors else 'N/A'
    )
    print(f'  K 线成功率: {kline_rate}')
    print(f'  资金流 — 匹配: {fund_result["matched"]}/{fund_result["total"]}')
    fund_rate = (
        f'{fund_result["matched"] / fund_result["total"] * 100:.1f}%'
        if fund_result['total'] else 'N/A'
    )
    print(f'  资金流匹配率: {fund_rate}')
    print('=' * 60)

    # 如果 K 线失败率超过 10%，退出码非零
    if sectors and kline_result['failed'] > len(sectors) * 0.1:
        print('[warn] K 线失败率超过 10%')
        sys.exit(1)


if __name__ == '__main__':
    main()
