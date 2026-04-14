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
from collectors.limit_analysis import collect_limit_analysis
from collectors.ths_hot import (
    collect_ths_hot_stocks,
    collect_ths_hot_concepts,
    collect_ths_hot_industries,
)
from collectors.index_yellow_white import collect_yellow_white
from collectors.market_fund_flow import collect_market_fund_flow
from collectors.margin import collect_margin_data
from collectors.news_filter import (
    filter_important_news,
    build_market_anchors,
    fetch_daily_report_anchors,
)


def run(date_str: str, dry_run: bool = False) -> dict:
    """
    执行全部采集流程
    返回完整的复盘数据字典
    """
    # 更新总步数为 13
    print(f'====== 每日复盘数据采集 ======')
    print(f'  日期: {date_str}')
    print()

    data = {}
    errors = []

    # ---- 模块1: 大盘概览（含黄白线 + 大盘资金流向，v2 新增）----
    print('[1/12] 采集大盘概览...')
    try:
        data['market_overview'] = collect_market_overview(date_str)
        print(f'  ✓ 指数 {len(data["market_overview"].get("indices", []))} 条')
    except Exception as e:
        errors.append(f'模块1: {e}')
        data['market_overview'] = None
        print(f'  ✗ 失败: {e}')

    # 模块1 扩展：上证黄白线
    if data.get('market_overview') is not None:
        try:
            yw = collect_yellow_white(date_str)
            data['market_overview']['yellow_white'] = yw
            print(f'  ✓ 黄白线 黄 {yw["yellow_line_chg"]} / 白 {yw["white_line_chg"]} / {yw["style_bias"]}')
        except Exception as e:
            errors.append(f'模块1-黄白线: {e}')
            data['market_overview']['yellow_white'] = None
            print(f'  ✗ 黄白线失败: {e}')

        # 模块1 扩展：大盘主力/散户资金
        try:
            ff = collect_market_fund_flow(date_str)
            data['market_overview']['fund_flow'] = ff
            print(f'  ✓ 资金流向 主力 {ff["main_inflow"]} / 散户 {ff["retail_inflow"]} 亿')
        except Exception as e:
            errors.append(f'模块1-资金流向: {e}')
            data['market_overview']['fund_flow'] = None
            print(f'  ✗ 资金流向失败: {e}')

        # 模块1 扩展：两融余额（融资余额 + 日变化 + 分位）
        try:
            md = collect_margin_data(date_str)
            data['margin_data'] = md
            tb = md.get('total_balance')
            dc = md.get('daily_change')
            cd = md.get('consecutive_days')
            pct = md.get('balance_percentile_1y')
            cd_str = f'连续 {"+" if cd and cd > 0 else ""}{cd} 日' if cd else '-'
            print(
                f'  ✓ 两融 {tb}亿（1Y 分位 {pct}%） / 日变化 {"+" if dc and dc > 0 else ""}{dc}亿 / {cd_str}'
            )
        except Exception as e:
            errors.append(f'模块1-两融: {e}')
            data['margin_data'] = None
            print(f'  ✗ 两融失败: {e}')

    # ---- 模块2: 市场情绪 ----
    print('[2/12] 采集市场情绪指标...')
    try:
        data['market_sentiment'] = collect_market_sentiment(date_str)
        print(f'  ✓ 涨停 {data["market_sentiment"].get("limit_up", 0)} / '
              f'跌停 {data["market_sentiment"].get("limit_down", 0)}')
    except Exception as e:
        errors.append(f'模块2: {e}')
        data['market_sentiment'] = None
        print(f'  ✗ 失败: {e}')

    # ---- 模块3: 同花顺热门个股（替代原东财热门股）----
    print('[3/12] 采集同花顺热门个股...')
    try:
        data['ths_hot_stocks'] = collect_ths_hot_stocks()
        print(f'  ✓ {len(data["ths_hot_stocks"])} 条')
    except Exception as e:
        errors.append(f'模块3: {e}')
        data['ths_hot_stocks'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块4: 连板天梯 ----
    print('[4/12] 采集连板天梯...')
    try:
        data['limit_up_ladder'] = collect_limit_up_ladder(date_str)
        print(f'  ✓ {len(data["limit_up_ladder"])} 条')
    except Exception as e:
        errors.append(f'模块4: {e}')
        data['limit_up_ladder'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块5: 龙虎榜明细 ----
    print('[5/12] 采集龙虎榜明细...')
    try:
        data['dragon_tiger'] = collect_dragon_tiger(date_str)
        print(f'  ✓ {len(data["dragon_tiger"])} 条')
    except Exception as e:
        errors.append(f'模块5: {e}')
        data['dragon_tiger'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块6: 行业分布统计（热门股+连板+龙虎榜聚合）----
    print('[6/12] 计算行业分布统计...')
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
    print('[7/12] 采集涨跌停行业分布...')
    try:
        data['limit_industry_distribution'] = collect_limit_industry_distribution(date_str)
        print(f'  ✓ {len(data["limit_industry_distribution"])} 个行业')
    except Exception as e:
        errors.append(f'模块7: {e}')
        data['limit_industry_distribution'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块8: 打板分析（溢价率+晋级率+封单）----
    print('[8/12] 采集打板分析（溢价率+晋级率+封单）...')
    try:
        data['limit_analysis'] = collect_limit_analysis(date_str)
        la = data['limit_analysis']
        ps = la.get('premium_summary') or {}
        pm = la.get('promotion') or {}
        ss = la.get('seal_stats') or {}
        print(f'  ✓ 溢价率 {ps.get("premium_rate", "-")}% / '
              f'晋级率 {pm.get("rate", "-")}% / '
              f'封单 {ss.get("total_seal_fund", "-")}亿')
    except Exception as e:
        errors.append(f'模块8: {e}')
        data['limit_analysis'] = None
        print(f'  ✗ 失败: {e}')

    # ---- 模块9: 板块资金流向 ----
    print('[9/12] 采集板块资金流向...')
    try:
        data['sector_fund_flow'] = collect_sector_fund_flow(date_str)
        inflow_count = len(data['sector_fund_flow'].get('inflow', []))
        outflow_count = len(data['sector_fund_flow'].get('outflow', []))
        print(f'  ✓ 流入 {inflow_count} / 流出 {outflow_count}')
    except Exception as e:
        errors.append(f'模块9: {e}')
        data['sector_fund_flow'] = {'inflow': [], 'outflow': []}
        print(f'  ✗ 失败: {e}')

    # ---- 模块10: 个股资金流向 ----
    print('[10/12] 采集个股资金流向...')
    try:
        data['stock_fund_flow'] = collect_stock_fund_flow(date_str)
        inflow_count = len(data['stock_fund_flow'].get('inflow', []))
        outflow_count = len(data['stock_fund_flow'].get('outflow', []))
        print(f'  ✓ 流入 {inflow_count} / 流出 {outflow_count}')
    except Exception as e:
        errors.append(f'模块10: {e}')
        data['stock_fund_flow'] = {'inflow': [], 'outflow': []}
        print(f'  ✗ 失败: {e}')

    # ---- 模块11: 同花顺热门概念 ----
    print('[11/12] 采集同花顺热门概念...')
    try:
        data['ths_hot_concepts'] = collect_ths_hot_concepts()
        print(f'  ✓ {len(data["ths_hot_concepts"])} 条')
    except Exception as e:
        errors.append(f'模块11: {e}')
        data['ths_hot_concepts'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块12: 同花顺热门行业 ----
    print('[12/12] 采集同花顺热门行业...')
    try:
        data['ths_hot_industries'] = collect_ths_hot_industries()
        print(f'  ✓ {len(data["ths_hot_industries"])} 条')
    except Exception as e:
        errors.append(f'模块12: {e}')
        data['ths_hot_industries'] = []
        print(f'  ✗ 失败: {e}')

    # ---- 模块13: 资讯预筛（v2，3 路径：关键词 / 市场锚点 / 早报）----
    print('[13/13] 资讯预筛（3 路径打分）...')
    try:
        from db import get_supabase_client
        sb_filter = get_supabase_client()
        # 1) 市场锚点（来自已采集数据）
        anchors = build_market_anchors(data)
        print(
            f'  · 锚点：股票 {len(anchors["stocks"])} / '
            f'行业 {len(anchors["industries"])} / 概念 {len(anchors["concepts"])}'
        )
        # 2) 早报锚点
        report = fetch_daily_report_anchors(sb_filter, date_str)
        rpt_len = len(report.get('text') or '')
        print(f'  · 早报：{"已读取" if rpt_len else "缺失"}（{rpt_len} 字符）')
        # 3) 筛选
        filtered = filter_important_news(
            sb_filter, date_str, anchors=anchors, report=report, limit=50
        )
        data['filtered_news'] = filtered
        seg_count = {'pre_market': 0, 'intraday': 0, 'post_market': 0}
        multi_path = 0
        for item in filtered:
            seg_count[item.get('segment', 'intraday')] += 1
            if item.get('paths_hit', 0) >= 2:
                multi_path += 1
        print(
            f'  ✓ 候选 {len(filtered)} 条（盘前 {seg_count["pre_market"]} / '
            f'盘中 {seg_count["intraday"]} / 盘后 {seg_count["post_market"]}），'
            f'多路径命中 {multi_path} 条'
        )
    except Exception as e:
        errors.append(f'模块13: {e}')
        data['filtered_news'] = []
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
