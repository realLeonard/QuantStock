"""模块8: 板块资金流向 + 模块9: 个股资金流向（数据源: 同花顺）"""

import re

import akshare as ak

from utils import safe_float


def _parse_amount(val) -> float:
    """解析同花顺金额字符串，统一返回亿元单位。
    '12.79亿' → 12.79, '3456万' → 0.3456, '6930.00'(元) → 0.0001
    """
    if val is None:
        return 0.0
    s = str(val).strip()
    if '亿' in s:
        return safe_float(s.replace('亿', ''))
    if '万' in s:
        return round(safe_float(s.replace('万', '')) / 10000, 4)
    # 纯数字视为元，转为亿
    v = safe_float(s)
    if v == 0:
        return 0.0
    return round(v / 1e8, 4)


def collect_sector_fund_flow(date_str: str) -> dict:
    """
    采集模块8: 板块（行业）资金流向 TOP10
    数据源: 同花顺 stock_fund_flow_industry
    返回: {
        inflow: [{ sector, net_amount, change_pct, top_stock, inflow_days_10 }],
        outflow: [{ sector, net_amount, change_pct, top_stock, inflow_days_10 }],
    }
    """
    result = {'inflow': [], 'outflow': []}

    try:
        df = ak.stock_fund_flow_industry(symbol='即时')
        if df is None or df.empty:
            print('  [warn] 板块资金流向数据为空')
            return result

        # 板块资金净额已经是 float（亿元），直接排序
        df['_net'] = df['净额'].apply(safe_float)
        df_sorted = df.sort_values('_net', ascending=False)

        top_inflow = df_sorted.head(10)
        top_outflow = df_sorted.tail(10).sort_values('_net', ascending=True)

        def _build_sector_item(row):
            change_str = str(row.get('行业-涨跌幅', '0')).replace('%', '')
            return {
                'sector': str(row.get('行业', '')),
                'net_amount': round(safe_float(row.get('净额', 0)), 2),
                'change_pct': safe_float(change_str),
                'top_stocks': [str(row.get('领涨股', ''))],
                'inflow_days_10': None,
            }

        for _, row in top_inflow.iterrows():
            result['inflow'].append(_build_sector_item(row))
        for _, row in top_outflow.iterrows():
            result['outflow'].append(_build_sector_item(row))

    except Exception as e:
        print(f'  [warn] 获取板块资金流向失败: {e}')

    return result


def collect_stock_fund_flow(date_str: str) -> dict:
    """
    采集模块9: 个股资金流向 TOP10
    数据源: 同花顺 stock_fund_flow_individual
    返回: {
        inflow: [{ code, name, net_amount, change_pct, inflow_days_10 }],
        outflow: [{ code, name, net_amount, change_pct, inflow_days_10 }],
    }
    """
    result = {'inflow': [], 'outflow': []}

    try:
        df = ak.stock_fund_flow_individual(symbol='即时')
        if df is None or df.empty:
            print('  [warn] 个股资金流向数据为空')
            return result

        # 解析净额并排序
        df['_net'] = df['净额'].apply(_parse_amount)
        df_sorted = df.sort_values('_net', ascending=False)

        top_inflow = df_sorted.head(10)
        top_outflow = df_sorted.tail(10).sort_values('_net', ascending=True)

        def _build_stock_item(row):
            change_str = str(row.get('涨跌幅', '0')).replace('%', '')
            code = str(row.get('股票代码', '')).strip()
            # 补齐6位前导零
            if code and len(code) < 6:
                code = code.zfill(6)
            return {
                'code': code,
                'name': str(row.get('股票简称', '')).strip(),
                'net_amount': round(_parse_amount(row.get('净额', 0)), 2),
                'change_pct': safe_float(change_str),
                'inflow_days_10': None,
            }

        for _, row in top_inflow.iterrows():
            result['inflow'].append(_build_stock_item(row))
        for _, row in top_outflow.iterrows():
            result['outflow'].append(_build_stock_item(row))

    except Exception as e:
        print(f'  [warn] 获取个股资金流向失败: {e}')

    return result
