"""
A股行情数据采集器
数据来源：akshare
采集内容：北向资金、融资余额、涨停家数、机构调研、解禁日历
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


def fetch_north_money() -> dict[str, Any]:
    """
    北向资金数据（沪深港通资金流向）
    返回近5日数据
    """
    try:
        df = ak.stock_hsgt_fund_flow_summary_em()
        # 取最新数据
        if df is not None and not df.empty:
            latest = df.tail(5)
            records = latest.to_dict(orient='records')
            return {
                'success': True,
                'data': records,
                'description': '北向资金近5日流向',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_margin_balance() -> dict[str, Any]:
    """
    融资融券余额
    返回近5日数据
    """
    try:
        df = ak.stock_margin_account_info()
        if df is not None and not df.empty:
            latest = df.tail(5)
            records = latest.to_dict(orient='records')
            return {
                'success': True,
                'data': records,
                'description': '融资融券余额近5日',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_limit_up_stats() -> dict[str, Any]:
    """
    涨停板统计（今日涨停家数、跌停家数、连板情况）
    """
    try:
        today = get_today_str()
        # 尝试获取今日涨停数据
        df = ak.stock_zt_pool_em(date=today)
        if df is not None and not df.empty:
            total_limit_up = len(df)
            # 连板晋级（连板天数 >= 2）
            if '连板天数' in df.columns:
                two_board = df[df['连板天数'] >= 2]
                three_board = df[df['连板天数'] >= 3]
            else:
                two_board = pd.DataFrame()
                three_board = pd.DataFrame()

            return {
                'success': True,
                'data': {
                    'total_limit_up': total_limit_up,
                    'two_board_count': len(two_board),
                    'three_board_count': len(three_board),
                    'top_stocks': df.head(20).to_dict(orient='records'),
                },
                'description': '今日涨停板统计',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': {}}
    return {'success': False, 'error': '无数据', 'data': {}}


def fetch_institutional_research() -> dict[str, Any]:
    """
    机构调研动态（近3日被密集调研的标的）
    """
    try:
        df = ak.stock_institute_recommend()
        if df is not None and not df.empty:
            # 取评级变化列
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
    """
    解禁减持日历（本周重要解禁）
    """
    try:
        df = ak.stock_circulate_stock_holder()
        if df is not None and not df.empty:
            # 取近7日解禁数据
            records = df.head(20).to_dict(orient='records')
            return {
                'success': True,
                'data': records,
                'description': '近期解禁减持计划',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_sector_funds() -> dict[str, Any]:
    """
    板块资金流向（行业板块 TOP10）
    """
    try:
        df = ak.stock_sector_fund_flow_rank(indicator='今日', sector_type='行业资金流向')
        if df is not None and not df.empty:
            top10 = df.head(10).to_dict(orient='records')
            bottom10 = df.tail(10).to_dict(orient='records')
            return {
                'success': True,
                'data': {
                    'top_inflow': top10,
                    'top_outflow': bottom10,
                },
                'description': '今日板块资金流向 TOP/BOTTOM 10',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': {}}
    return {'success': False, 'error': '无数据', 'data': {}}


def fetch_index_quotes() -> dict[str, Any]:
    """
    A股三大指数近5日收盘行情（上证、深证、创业板）
    是 Claude 判断市场趋势和情绪的基础数据
    """
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


def fetch_market_breadth() -> dict[str, Any]:
    """
    全市场涨跌家数（市场宽度）
    上涨/下跌/平盘/涨停/跌停家数，判断赚钱效应的核心指标
    同时返回结构化字段（rise/fall/flat/limit_up/limit_down）供 marketBreadth 表写入
    """
    try:
        df = ak.stock_market_activity_legu()
        if df is not None and not df.empty:
            records = df.to_dict(orient='records')
            # 提取结构化字段，精确匹配标签，避免"真实涨停"等子行覆盖主值
            EXACT_MAP = {
                '上涨': 'rise',
                '下跌': 'fall',
                '平盘': 'flat',
                '涨停': 'limit_up',
                '跌停': 'limit_down',
            }
            structured = {'rise': 0, 'fall': 0, 'flat': 0, 'limit_up': 0, 'limit_down': 0}
            for row in records:
                label = str(row.get('item') or row.get('类型') or '').strip()
                raw_val = row.get('value') or row.get('数量') or 0
                try:
                    val = int(float(str(raw_val).replace('%', ''))) if '%' not in str(raw_val) else 0
                except (ValueError, TypeError):
                    val = 0
                if label in EXACT_MAP:
                    structured[EXACT_MAP[label]] = val
            return {
                'success': True,
                'data': records,
                'structured': structured,
                'description': '全市场涨跌家数（上涨/下跌/平/涨停/跌停）',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': [], 'structured': {}}
    return {'success': False, 'error': '无数据', 'data': [], 'structured': {}}


def fetch_domestic_futures() -> dict[str, Any]:
    """
    国内期货主力合约现价（东方财富）
    覆盖螺纹钢、铁矿石、铜、原油、豆粕、黄金等核心品种
    """
    # 重点关注的国内期货品种
    KEY_VARIETIES = {
        '螺纹钢', '铁矿石', '铜', '原油', '豆粕', '豆油',
        '黄金', '白银', '玻璃', '纯碱', '焦炭', '焦煤',
        '动力煤', 'PTA', '橡胶', '棉花',
    }
    try:
        df = ak.futures_zh_spot_em()
        if df is not None and not df.empty:
            # 过滤关键品种
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


def fetch_all() -> dict[str, Any]:
    """执行全部 A 股数据采集，返回汇总结果"""
    print('  [akshare] 开始采集 A 股数据...')

    results = {}

    print('  [akshare] 采集北向资金...')
    results['north_money'] = fetch_north_money()

    print('  [akshare] 采集融资余额...')
    results['margin_balance'] = fetch_margin_balance()

    print('  [akshare] 采集涨停板统计...')
    results['limit_up_stats'] = fetch_limit_up_stats()

    print('  [akshare] 采集全市场涨跌家数...')
    results['market_breadth'] = fetch_market_breadth()

    print('  [akshare] 采集机构调研...')
    results['institutional_research'] = fetch_institutional_research()

    print('  [akshare] 采集解禁日历...')
    results['unlock_calendar'] = fetch_unlock_calendar()

    print('  [akshare] 采集板块资金流向...')
    results['sector_funds'] = fetch_sector_funds()

    print('  [akshare] 采集三大指数近5日行情...')
    results['index_quotes'] = fetch_index_quotes()

    print('  [akshare] 采集国内期货主力合约...')
    results['domestic_futures'] = fetch_domestic_futures()

    success_count = sum(1 for v in results.values() if v.get('success'))
    print(f'  [akshare] 完成，{success_count}/{len(results)} 项成功')

    return results
