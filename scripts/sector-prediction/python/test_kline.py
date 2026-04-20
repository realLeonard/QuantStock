"""K 线全量测试：从 DB 读取所有 active 板块，跑完整 K 线采集（写入 DB）

用于验证 JSONP + fresh page + 防风控策略在 GitHub Actions 上是否稳定。
不跑板块列表同步、不跑资金流，只测 K 线。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client
from browser import close_browser
from collectors.sector_kline import collect_kline_batch


def main():
    print('K 线全量测试（从 DB 读取板块，跳过板块列表和资金流）')
    print('=' * 60)

    sb = get_supabase_client()

    # 从 sector_master 读取所有 active 板块
    result = sb.table('sector_master').select('name,bk_code').eq('is_active', True).execute()
    sectors = result.data

    if not sectors:
        print('[error] sector_master 中无 active 板块，请先运行 init 或 daily 模式')
        sys.exit(1)

    print(f'从 DB 读取到 {len(sectors)} 个 active 板块')

    # 跑完整 K 线采集（写入 DB）
    kline_result = collect_kline_batch(
        sb,
        sectors,
        days=2,
        batch_size=50,
        sleep_between_batches=5.0,
        sleep_between_sectors=1.0,
    )

    print()
    print('=' * 60)
    print(f'结果: 成功 {kline_result["success"]}, 失败 {kline_result["failed"]}, 跳过 {kline_result["skipped"]}')
    total = kline_result["success"] + kline_result["failed"]
    if total > 0:
        rate = kline_result["success"] / total * 100
        print(f'成功率: {rate:.1f}%')

    if kline_result['failed_names'][:20]:
        print(f'失败板块（前20）: {", ".join(kline_result["failed_names"][:20])}')

    if kline_result['failed'] > len(sectors) * 0.5:
        print('[FAIL] 失败率超过 50%')
        sys.exit(1)
    elif kline_result['failed'] > 0:
        print('[WARN] 部分失败')
    else:
        print('[PASS] 全部通过')


if __name__ == '__main__':
    try:
        main()
    finally:
        close_browser()
