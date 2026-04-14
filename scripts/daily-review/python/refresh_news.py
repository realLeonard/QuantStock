"""
一次性脚本：只刷新指定日期的 filtered_news，并清空 ai_analysis 让 TS 脚本重新生成。

用法：
  cd scripts/daily-review/python
  python refresh_news.py --date 2026-04-14

逻辑：
  1. 从 dailyReview 读出该日已采集数据（不重新抓盘面数据）
  2. 基于已采集数据重建市场锚点 + 读早报锚点
  3. 重跑 news_filter → 写回 filtered_news
  4. 清空 ai_analysis & ai_summary（TS 脚本里检测到会自动重新生成）
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_supabase_client
from collectors.news_filter import (
    build_market_anchors,
    fetch_daily_report_anchors,
    filter_important_news,
)


def main() -> None:
    parser = argparse.ArgumentParser(description='只刷新指定日期的 filtered_news')
    parser.add_argument('--date', required=True, help='YYYY-MM-DD')
    args = parser.parse_args()
    date_str: str = args.date

    sb = get_supabase_client()

    # ---- 1. 读出当日 dailyReview ----
    resp = (
        sb.table('dailyReview')
        .select('*')
        .eq('report_date', date_str)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        print(f'❌ 未找到 {date_str} 的 dailyReview 记录')
        sys.exit(1)
    row = rows[0]
    row_id = row['id']
    print(f'✓ 命中 dailyReview id={row_id}')

    # 把 DB 行当作 collectors 的 data 字典用
    # 只需要这些字段，其他不影响
    data = {
        'limit_up_ladder': row.get('limit_up_ladder') or [],
        'limit_industry_distribution': row.get('limit_industry_distribution') or [],
        'sector_fund_flow': row.get('sector_fund_flow') or {},
        'stock_fund_flow': row.get('stock_fund_flow') or {},
        'dragon_tiger': row.get('dragon_tiger') or [],
        'ths_hot_stocks': row.get('ths_hot_stocks') or [],
        'ths_hot_concepts': row.get('ths_hot_concepts') or [],
        'ths_hot_industries': row.get('ths_hot_industries') or [],
    }

    # ---- 2. 锚点 + 早报 ----
    anchors = build_market_anchors(data)
    print(
        f'· 锚点：股票 {len(anchors["stocks"])} / '
        f'行业 {len(anchors["industries"])} / 概念 {len(anchors["concepts"])}'
    )
    report = fetch_daily_report_anchors(sb, date_str)
    rpt_len = len(report.get('text') or '')
    print(f'· 早报：{"已读取" if rpt_len else "缺失"}（{rpt_len} 字符）')

    # ---- 3. 重跑 news_filter ----
    filtered = filter_important_news(
        sb, date_str, anchors=anchors, report=report, limit=50
    )
    seg_count = {'pre_market': 0, 'intraday': 0, 'post_market': 0}
    multi_path = 0
    for item in filtered:
        seg_count[item.get('segment', 'intraday')] += 1
        if item.get('paths_hit', 0) >= 2:
            multi_path += 1
    print(
        f'· 候选 {len(filtered)} 条（盘前 {seg_count["pre_market"]} / '
        f'盘中 {seg_count["intraday"]} / 盘后 {seg_count["post_market"]}），'
        f'多路径命中 {multi_path} 条'
    )

    # Top5 预览
    print('\n--- Top5 预览 ---')
    for i, item in enumerate(filtered[:5], 1):
        print(
            f'{i}. [{item["segment"]}] {item["level"]} | score={item["score"]} | '
            f'paths={item["paths_hit"]} | {item["title"][:50]}'
        )
        if item.get('keyword_hits'):
            print(f'   关键词: {", ".join(item["keyword_hits"][:5])}')
        if item.get('anchored_from'):
            print(f'   锚点: {", ".join(item["anchored_from"][:5])}')
        if item.get('matched_daily_report'):
            print(f'   ✓ 早报呼应')
    print()

    # ---- 4. 回写 + 清空 ai_analysis ----
    upd = (
        sb.table('dailyReview')
        .update({
            'filtered_news': filtered,
            'ai_analysis': None,
            'ai_summary': None,
        })
        .eq('id', row_id)
        .execute()
    )
    if getattr(upd, 'data', None) is None and getattr(upd, 'error', None):
        print(f'❌ 回写失败: {upd.error}')
        sys.exit(1)
    print('✅ filtered_news 已更新，ai_analysis 已清空')
    print(f'\n下一步：npx tsx scripts/daily-review/index.ts --date {date_str}')


if __name__ == '__main__':
    main()
