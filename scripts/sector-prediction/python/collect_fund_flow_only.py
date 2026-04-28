"""独立资金流采集入口（用于阿里云 SSH 远程执行）"""

import argparse
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import get_supabase_client
from browser import close_browser
from collectors.sector_fund_flow import collect_fund_flow

_BJ_TZ = timezone(timedelta(hours=8))


def main():
    parser = argparse.ArgumentParser(description='独立资金流采集')
    parser.add_argument('--date', type=str, default=None,
                        help='采集日期（YYYY-MM-DD），默认今天')
    args = parser.parse_args()

    today = args.date or datetime.now(_BJ_TZ).strftime('%Y-%m-%d')
    print(f'[资金流] 采集日期: {today}')

    sb = get_supabase_client()
    try:
        result = collect_fund_flow(sb, today)
        print(f'[资金流] 完成: 匹配 {result["matched"]}/{result["total"]}')
        if result['total'] > 0 and result['matched'] < result['total'] * 0.5:
            print(f'[FAIL] 匹配率不足 50%')
            sys.exit(1)
    finally:
        close_browser()


if __name__ == '__main__':
    main()
