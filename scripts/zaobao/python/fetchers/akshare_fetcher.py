"""
A股行情数据采集器（早报用）
数据源：akshare

定位：
- 早报的"昨日盘面"主要用复盘 dailyReview 数据块（generate.ts 侧加载）
- 本 fetcher 只负责早报**独有**的 A股实时/盘前硬数据：
  * 三大指数近5日收盘（fetch_index_quotes）
  * 国内期货主力现价（fetch_domestic_futures）
  * 机构评级（fetch_institutional_research）
  * 解禁日历（fetch_unlock_calendar）
  * 跌停池 + 炸板池（风险维度）
  * 隔夜外盘（美股/A50/汇率等）

已删除（被复盘数据块替代）：
- fetch_north_money（数据源已失效）
- fetch_margin_balance → margin_data
- fetch_limit_up_stats → limit_up_ladder + limit_analysis
- fetch_sector_funds → sector_fund_flow
- fetch_market_breadth → market_overview + market_sentiment
"""

import akshare as ak
import pandas as pd
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any

_BJ = ZoneInfo('Asia/Shanghai')


def get_today_str() -> str:
    """获取今日日期字符串（北京时间，格式：YYYYMMDD）"""
    return datetime.now(_BJ).strftime('%Y%m%d')


def get_yesterday_str() -> str:
    """获取昨日日期字符串（北京时间，格式：YYYYMMDD）"""
    return (datetime.now(_BJ) - timedelta(days=1)).strftime('%Y%m%d')


def fetch_institutional_research() -> dict[str, Any]:
    """机构调研动态（近期机构评级报告）"""
    try:
        df = ak.stock_institute_recommend()
        if df is not None and not df.empty:
            records = df.head(30).to_dict(orient='records')
            return {
                'success': True,
                'data': records,
                'description': '机构最新研究报告',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_unlock_calendar() -> dict[str, Any]:
    """解禁减持日历（近期解禁计划）"""
    try:
        df = ak.stock_circulate_stock_holder()
        if df is not None and not df.empty:
            records = df.head(20).to_dict(orient='records')
            return {
                'success': True,
                'data': records,
                'description': '近期解禁减持计划',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_index_quotes() -> dict[str, Any]:
    """A股三大指数近5日收盘行情（上证、深证、创业板）"""
    indices = {
        'sh000001': '上证综指',
        'sz399001': '深证成指',
        'sz399006': '创业板指',
    }
    result = {}
    try:
        for symbol, name in indices.items():
            df = ak.stock_zh_index_daily(symbol=symbol).tail(5)
            result[name] = df.to_dict(orient='records')
        return {
            'success': True,
            'data': result,
            'description': '三大指数近5日收盘行情',
        }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': {}}


def fetch_domestic_futures() -> dict[str, Any]:
    """国内期货主力合约现价（核心品种）"""
    KEY_VARIETIES = {
        '螺纹钢', '铁矿石', '铜', '原油', '豆粕', '豆油',
        '黄金', '白银', '玻璃', '纯碱', '焦炭', '焦煤',
        '动力煤', 'PTA', '橡胶', '棉花',
    }
    try:
        df = ak.futures_zh_spot_em()
        if df is not None and not df.empty:
            if '品种' in df.columns:
                df = df[df['品种'].isin(KEY_VARIETIES)]
            return {
                'success': True,
                'data': df.to_dict(orient='records'),
                'description': '国内期货主力合约现价（核心品种）',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_limit_down_pool() -> dict[str, Any]:
    """
    今日跌停池（风险维度）
    数据源：akshare stock_zt_pool_dtgc_em
    """
    try:
        df = ak.stock_zt_pool_dtgc_em(date=get_today_str())
        if df is not None and not df.empty:
            # 排除 ST
            if '名称' in df.columns:
                df = df[~df['名称'].str.contains('ST', case=False, na=False)]
            records = df.head(20).to_dict(orient='records')
            return {
                'success': True,
                'data': {
                    'total_count': len(df),
                    'top_stocks': records,
                },
                'description': '今日跌停池（非 ST）TOP20',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': {}}
    return {'success': False, 'error': '无数据', 'data': {}}


def fetch_zhaban_pool() -> dict[str, Any]:
    """
    今日炸板池（情绪退潮先行信号）
    数据源：akshare stock_zt_pool_zbgc_em
    """
    try:
        df = ak.stock_zt_pool_zbgc_em(date=get_today_str())
        if df is not None and not df.empty:
            if '名称' in df.columns:
                df = df[~df['名称'].str.contains('ST', case=False, na=False)]
            records = df.head(20).to_dict(orient='records')
            return {
                'success': True,
                'data': {
                    'total_count': len(df),
                    'top_stocks': records,
                },
                'description': '今日炸板池 TOP20',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': {}}
    return {'success': False, 'error': '无数据', 'data': {}}


def fetch_overseas_overnight() -> dict[str, Any]:
    """
    隔夜外盘 + 开盘前风向
    - 美股三大指数（道指/纳指/标普）
    - 富时中国 A50 期指
    - 人民币汇率（USDCNY）
    """
    result: dict[str, Any] = {}

    # 美股三大指数
    try:
        df_us = ak.index_us_stock_sina()
        if df_us is not None and not df_us.empty:
            target = {'.DJI': '道指', '.IXIC': '纳指', '.INX': '标普500'}
            rows = []
            for code, name in target.items():
                m = df_us[df_us['symbol'] == code] if 'symbol' in df_us.columns else pd.DataFrame()
                if not m.empty:
                    r = m.iloc[0]
                    rows.append({
                        'name': name,
                        'close': r.get('price'),
                        'change_pct': r.get('percent'),
                    })
            result['us_index'] = rows
    except Exception as e:
        result['us_index_error'] = str(e)

    # 富时 A50
    try:
        df_a50 = ak.futures_foreign_commodity_realtime(symbol='CN')
        # akshare 不同版本接口可能不同，失败就跳过
        if df_a50 is not None and not df_a50.empty:
            result['a50_futures'] = df_a50.head(3).to_dict(orient='records')
    except Exception as e:
        result['a50_error'] = str(e)

    # 人民币汇率
    try:
        df_fx = ak.currency_boc_sina(symbol='美元', start_date=get_yesterday_str(), end_date=get_today_str())
        if df_fx is not None and not df_fx.empty:
            result['usdcny'] = df_fx.tail(1).to_dict(orient='records')
    except Exception as e:
        result['fx_error'] = str(e)

    return {
        'success': bool(result) and not all(k.endswith('_error') for k in result),
        'data': result,
        'description': '隔夜外盘 + 汇率',
    }


def fetch_all() -> dict[str, Any]:
    """执行全部 A 股数据采集（早报独有部分），返回汇总结果"""
    print('  [akshare] 开始采集 A 股数据（早报独有部分）...')

    results = {}

    print('  [akshare] 采集机构调研...')
    results['institutional_research'] = fetch_institutional_research()

    print('  [akshare] 采集解禁日历...')
    results['unlock_calendar'] = fetch_unlock_calendar()

    print('  [akshare] 采集三大指数近5日行情...')
    results['index_quotes'] = fetch_index_quotes()

    print('  [akshare] 采集国内期货主力合约...')
    results['domestic_futures'] = fetch_domestic_futures()

    print('  [akshare] 采集跌停池...')
    results['limit_down_pool'] = fetch_limit_down_pool()

    print('  [akshare] 采集炸板池...')
    results['zhaban_pool'] = fetch_zhaban_pool()

    print('  [akshare] 采集隔夜外盘...')
    results['overseas_overnight'] = fetch_overseas_overnight()

    success_count = sum(1 for v in results.values() if v.get('success'))
    print(f'  [akshare] 完成，{success_count}/{len(results)} 项成功')

    return results
