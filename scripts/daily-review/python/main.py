"""
每日复盘 — 数据采集主入口

用法:
  python main.py                    # 采集当天数据
  python main.py --date 2026-04-10  # 采集指定日期数据
  python main.py --dry-run          # 只采集不写库（调试用）
"""

import argparse
import json
import sys
import os

# 将当前目录加入 path，以便 collectors 导入 utils
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_supabase_client, save_daily_review
from utils import get_today_date

from collectors.market import collect_market_overview, collect_market_sentiment
from collectors.limit_stocks import collect_limit_up_ladder, collect_limit_industry_distribution
from collectors.dragon_tiger import collect_dragon_tiger
from collectors.fund_flow import collect_sector_fund_flow, collect_stock_fund_flow
from collectors.industry import compute_industry_distribution
from collectors.ths_hot import (
    collect_ths_hot_stocks,
    collect_ths_hot_concepts,
    collect_ths_hot_industries,
)


def run(date_str: str, dry_run: bool = False) -> dict:
    """
    执行全部采集流程
    返回完整的复盘数据字典
    """
    print(f'====== 每日复盘数据采集 ======')
    print(f'  日期: {date_str}')
    print()

    data = {}
    errors = []

    # ---- 模块1: 大盘概览 ----
    print('[1/11] 采集大盘概览...')
    try:
        data['market_overview'] = collect_market_overview(date_str)
        print(f'  ✓ 指数 {len(data["market_overview"].get("indices", []))} 条')
    except Exception as e:
        errors.append(f'模块1: {e}')
        data['market_overview'] = None
        print(f'  ✗ 失败: {e}')

    # ---- 模块2: 市场情绪 ----
    print('[2/11] 采集市场情绪指标...')
    try:
        data['market_sentiment'] = collect_market_sentiment(date_str)
        print(f'  ✓ 涨停 {data["market_sentiment"].get("limit_up", 0)} / '
              f'跌停 {data["market_sentiment"].get("limit_down", 0)}')
    except Exception as e:
        errors.append(f'模块2: {e}')
        data['market_sentiment'] = None
        print(f'  ✗ 失败: {e}')

    # ---- 模块3: 同花顺热门个股（替代原东财热门股）----
    print('[3/11] 采集同花顺热门个股...')
    try:
        data['ths_hot_stocks'] = collect_ths_hot_stocks()
        print(f'  ✓ {len(data["ths_hot_stocks"])} 条')
    except Exception as e:
        errors.append(f'模块3: {e}')
        data['ths_hot_stocks'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块4: 连板天梯 ----
    print('[4/11] 采集连板天梯...')
    try:
        data['limit_up_ladder'] = collect_limit_up_ladder(date_str)
        print(f'  ✓ {len(data["limit_up_ladder"])} 条')
    except Exception as e:
        errors.append(f'模块4: {e}')
        data['limit_up_ladder'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块5: 龙虎榜明细 ----
    print('[5/11] 采集龙虎榜明细...')
    try:
        data['dragon_tiger'] = collect_dragon_tiger(date_str)
        print(f'  ✓ {len(data["dragon_tiger"])} 条')
    except Exception as e:
        errors.append(f'模块5: {e}')
        data['dragon_tiger'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块6: 行业分布统计（热门股+连板+龙虎榜聚合）----
    print('[6/11] 计算行业分布统计...')
    try:
        data['industry_distribution'] = compute_industry_distribution(
            data.get('ths_hot_stocks', []),
            data.get('limit_up_ladder', []),
            data.get('dragon_tiger', []),
        )
        print(f'  ✓ {len(data["industry_distribution"])} 个行业')
    except Exception as e:
        errors.append(f'模块6: {e}')
        data['industry_distribution'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块7: 涨跌停行业分布 ----
    print('[7/11] 采集涨跌停行业分布...')
    try:
        data['limit_industry_distribution'] = collect_limit_industry_distribution(date_str)
        print(f'  ✓ {len(data["limit_industry_distribution"])} 个行业')
    except Exception as e:
        errors.append(f'模块7: {e}')
        data['limit_industry_distribution'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块8: 板块资金流向 ----
    print('[8/11] 采集板块资金流向...')
    try:
        data['sector_fund_flow'] = collect_sector_fund_flow(date_str)
        inflow_count = len(data['sector_fund_flow'].get('inflow', []))
        outflow_count = len(data['sector_fund_flow'].get('outflow', []))
        print(f'  ✓ 流入 {inflow_count} / 流出 {outflow_count}')
    except Exception as e:
        errors.append(f'模块8: {e}')
        data['sector_fund_flow'] = {'inflow': [], 'outflow': []}
        print(f'  ✗ 失败: {e}')

    # ---- 模块9: 个股资金流向 ----
    print('[9/11] 采集个股资金流向...')
    try:
        data['stock_fund_flow'] = collect_stock_fund_flow(date_str)
        inflow_count = len(data['stock_fund_flow'].get('inflow', []))
        outflow_count = len(data['stock_fund_flow'].get('outflow', []))
        print(f'  ✓ 流入 {inflow_count} / 流出 {outflow_count}')
    except Exception as e:
        errors.append(f'模块9: {e}')
        data['stock_fund_flow'] = {'inflow': [], 'outflow': []}
        print(f'  ✗ 失败: {e}')

    # ---- 模块10: 同花顺热门概念 ----
    print('[10/11] 采集同花顺热门概念...')
    try:
        data['ths_hot_concepts'] = collect_ths_hot_concepts()
        print(f'  ✓ {len(data["ths_hot_concepts"])} 条')
    except Exception as e:
        errors.append(f'模块10: {e}')
        data['ths_hot_concepts'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块11: 同花顺热门行业 ----
    print('[11/11] 采集同花顺热门行业...')
    try:
        data['ths_hot_industries'] = collect_ths_hot_industries()
        print(f'  ✓ {len(data["ths_hot_industries"])} 条')
    except Exception as e:
        errors.append(f'模块11: {e}')
        data['ths_hot_industries'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 废弃字段（保持向后兼容）----
    data['hot_stocks'] = None
    data['ai_summary'] = None

    # ---- 状态判断 ----
    if not errors:
        data['status'] = 'success'
    elif len(errors) >= 5:
        data['status'] = 'failed'
    else:
        data['status'] = 'partial'

    print()
    if errors:
        print(f'⚠️ 共 {len(errors)} 个模块采集异常:')
        for err in errors:
            print(f'  - {err}')
    else:
        print('✅ 全部模块采集成功')

    # ---- 写入数据库 ----
    if dry_run:
        print()
        print('🔍 dry-run 模式，不写入数据库')
        print(json.dumps(data, ensure_ascii=False, indent=2, default=str)[:3000])
    else:
        print()
        print('写入 Supabase...')
        sb = get_supabase_client()
        save_daily_review(sb, date_str, data)

    print()
    print('====== 采集完成 ======')

    return data


def main():
    parser = argparse.ArgumentParser(description='每日复盘数据采集')
    parser.add_argument('--date', type=str, default=None, help='指定日期 (YYYY-MM-DD)')
    parser.add_argument('--dry-run', action='store_true', help='只采集不写库')
    args = parser.parse_args()

    date_str = args.date or get_today_date()
    run(date_str, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
