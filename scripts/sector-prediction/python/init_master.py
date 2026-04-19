"""
板块预测系统 — 初始化入口
1. 刷新板块列表 → sector_master
2. 拉取 60 日历史 K 线 → sector_daily
"""

import sys
from pathlib import Path

# 将当前目录加入 sys.path（GitHub Actions 中直接 python init_master.py）
sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client
from collectors.sector_list import sync_sector_master
from collectors.sector_kline import collect_kline_batch


def main():
    print('=' * 60)
    print('板块预测系统 — 初始化')
    print('=' * 60)

    sb = get_supabase_client()

    # 1. 刷新板块列表
    sectors = sync_sector_master(sb)
    if not sectors:
        print('[error] 未获取到任何板块，终止')
        sys.exit(1)

    # 2. 拉取 60 日历史 K 线
    result = collect_kline_batch(
        sb,
        sectors,
        days=60,
        batch_size=50,
        sleep_between_batches=5.0,
        sleep_between_sectors=0.3,
    )

    # 3. 汇总
    print()
    print('=' * 60)
    print('初始化完成')
    print(f'  板块总数: {len(sectors)}')
    print(f'  K 线成功: {result["success"]}')
    print(f'  K 线失败: {result["failed"]}')
    print('=' * 60)

    if result['failed'] > len(sectors) * 0.1:
        print('[warn] K 线失败率超过 10%，请检查日志')
        sys.exit(1)


if __name__ == '__main__':
    main()
