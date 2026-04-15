"""一次性脚本：只为指定日期补齐 margin_data，并清空 ai_analysis 让 TS 脚本重跑。

用法：
  cd scripts/daily-review/python
  python refresh_margin.py --date 2026-04-14

逻辑：
  1. 采集该日 margin_data
  2. 回写 dailyReview.margin_data
  3. 清空 ai_analysis & ai_summary（TS 脚本检测到会重新生成）
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_supabase_client
from collectors.margin import collect_margin_data


def main() -> None:
    parser = argparse.ArgumentParser(description='只刷新指定日期的 margin_data')
    parser.add_argument('--date', required=True, help='YYYY-MM-DD')
    args = parser.parse_args()
    date_str: str = args.date

    sb = get_supabase_client()

    # ---- 1. 命中当日 dailyReview ----
    resp = (
        sb.table('dailyReview')
        .select('id,report_date')
        .eq('report_date', date_str)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print(f'❌ 未找到 {date_str} 的 dailyReview 记录')
        sys.exit(1)
    row_id = rows[0]['id']
    print(f'✓ 命中 dailyReview id={row_id}')

    # ---- 2. 采集 margin ----
    print('· 采集两融数据...')
    md = collect_margin_data(date_str)
    print(
        f'  两融 {md.get("total_balance")}亿（1Y 分位 {md.get("balance_percentile_1y")}%）'
        f' / 日变化 {md.get("daily_change")}亿'
        f' / 连续 {md.get("consecutive_days")} 日'
    )
    print(f'  trade_date={md.get("trade_date")}')
    print(f'  change_5d={md.get("change_5d")}')

    # ---- 3. 回写 + 清空 ai_analysis ----
    upd = (
        sb.table('dailyReview')
        .update({
            'margin_data': md,
            'ai_analysis': None,
            'ai_summary': None,
        })
        .eq('id', row_id)
        .execute()
    )
    if getattr(upd, 'data', None) is None and getattr(upd, 'error', None):
        print(f'❌ 回写失败: {upd.error}')
        sys.exit(1)
    print('✅ margin_data 已更新，ai_analysis 已清空')
    print(f'\n下一步：npx tsx scripts/daily-review/index.ts --date {date_str}')


if __name__ == '__main__':
    main()
