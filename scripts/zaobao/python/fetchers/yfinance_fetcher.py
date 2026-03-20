"""
国际市场数据采集器
数据来源：yfinance
采集内容：美股三大指数、纳斯达克热门板块、大宗商品期货、港股
"""

import yfinance as yf
from typing import Any


# 美股三大指数
US_INDICES = {
    '^DJI': '道琼斯工业指数',
    '^GSPC': '标普500',
    '^IXIC': '纳斯达克综合',
    '^VIX': 'VIX恐慌指数',
    '^RUT': '罗素2000（小盘股）',
}

# 纳斯达克热门 ETF（板块代理）
SECTOR_ETFS = {
    'QQQ': '纳斯达克100 ETF',
    'SOXX': '半导体 ETF',
    'ARKK': 'ARK创新 ETF',
    'XBI': '生物科技 ETF',
    'CIBR': '网络安全 ETF',
}

# 大宗商品期货
COMMODITIES = {
    'CL=F': '原油（WTI）',
    'GC=F': '黄金',
    'HG=F': '铜',
    'SI=F': '白银',
    'NG=F': '天然气',
}

# 港股指数及南向资金代理
HK_INDICES = {
    '^HSI': '恒生指数',
    '^HSCEI': '恒生中国企业指数（国企指数）',
    '2800.HK': '恒生ETF（南向资金参考）',
}

# 汇率
FOREX = {
    'USDCNY=X': '美元兑人民币',
    'USDJPY=X': '美元兑日元',
    'DX-Y.NYB': '美元指数',
}


def fetch_ticker_info(symbols: dict[str, str]) -> dict[str, Any]:
    """
    批量获取行情数据
    返回：{symbol: {name, price, change_pct, prev_close, ...}}
    """
    results = {}
    for symbol, name in symbols.items():
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period='2d', interval='1d')
            if hist is None or hist.empty:
                results[symbol] = {'name': name, 'success': False, 'error': '无数据'}
                continue

            latest = hist.iloc[-1]
            prev = hist.iloc[-2] if len(hist) >= 2 else None

            close = float(latest['Close'])
            prev_close = float(prev['Close']) if prev is not None else close
            change = close - prev_close
            change_pct = (change / prev_close * 100) if prev_close != 0 else 0

            results[symbol] = {
                'name': name,
                'success': True,
                'price': round(close, 4),
                'prev_close': round(prev_close, 4),
                'change': round(change, 4),
                'change_pct': round(change_pct, 2),
                'volume': int(latest.get('Volume', 0)),
            }
        except Exception as e:
            results[symbol] = {'name': name, 'success': False, 'error': str(e)}

    return results


def fetch_us_indices() -> dict[str, Any]:
    """美股三大指数 + VIX"""
    print('  [yfinance] 采集美股指数...')
    data = fetch_ticker_info(US_INDICES)
    return {'success': True, 'data': data, 'description': '美股三大指数及VIX'}


def fetch_sector_etfs() -> dict[str, Any]:
    """纳斯达克热门板块 ETF"""
    print('  [yfinance] 采集板块 ETF...')
    data = fetch_ticker_info(SECTOR_ETFS)
    return {'success': True, 'data': data, 'description': '纳斯达克热门板块 ETF'}


def fetch_commodities() -> dict[str, Any]:
    """大宗商品期货"""
    print('  [yfinance] 采集大宗商品...')
    data = fetch_ticker_info(COMMODITIES)
    return {'success': True, 'data': data, 'description': '大宗商品期货价格'}


def fetch_hk_market() -> dict[str, Any]:
    """港股指数"""
    print('  [yfinance] 采集港股数据...')
    data = fetch_ticker_info(HK_INDICES)
    return {'success': True, 'data': data, 'description': '港股指数'}


def fetch_forex() -> dict[str, Any]:
    """汇率数据"""
    print('  [yfinance] 采集汇率数据...')
    data = fetch_ticker_info(FOREX)
    return {'success': True, 'data': data, 'description': '主要汇率'}


def fetch_all() -> dict[str, Any]:
    """执行全部国际市场数据采集，返回汇总结果"""
    print('  [yfinance] 开始采集国际市场数据...')

    results = {
        'us_indices': fetch_us_indices(),
        'sector_etfs': fetch_sector_etfs(),
        'commodities': fetch_commodities(),
        'hk_market': fetch_hk_market(),
        'forex': fetch_forex(),
    }

    success_count = sum(1 for v in results.values() if v.get('success'))
    print(f'  [yfinance] 完成，{success_count}/{len(results)} 项成功')

    return results
