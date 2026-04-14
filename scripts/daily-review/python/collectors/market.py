"""模块1: 大盘概览 + 模块2: 市场情绪指标"""

import akshare as ak

from utils import safe_float, safe_int, date_to_yyyymmdd, get_recent_trade_dates


def collect_market_overview(date_str: str) -> dict:
    """
    采集模块1: 大盘概览
    返回: { indices, margin, volume }
    北向资金：港交所 2024-08-19 起停止披露盘中实时净买数据，已下线
    """
    result = {
        'indices': [],
        'margin': {'balance': None, 'change': None},
        'volume': {'today': None, 'avg_5d': None, 'change_pct': None},
    }

    # ---- 1. A 股主要指数（数据源: 新浪）----
    target_indices = {
        'sh000001': '上证指数',
        'sh000300': '沪深300',
        'sz399001': '深证成指',
        'sz399006': '创业板指',
    }
    try:
        df = ak.stock_zh_index_spot_sina()
        if df is not None and not df.empty:
            for code, name in target_indices.items():
                row = df[df['代码'] == code]
                if not row.empty:
                    r = row.iloc[0]
                    amount_val = safe_float(r.get('成交额', 0))
                    result['indices'].append({
                        'name': name,
                        'close': safe_float(r.get('最新价')),
                        'change_pct': safe_float(r.get('涨跌幅')),
                        'amount': round(amount_val / 1e8, 2) if amount_val > 0 else None,
                    })
    except Exception as e:
        print(f'  [warn] 获取 A 股指数失败: {e}')

    # ---- 2. 恒生指数（新浪指数表中也有）----
    try:
        # 新浪指数表里恒生代码为 hkHSI 或从港股指数获取
        df = ak.stock_hk_index_spot_em()
        if df is not None and not df.empty:
            row = df[df['名称'].str.contains('恒生指数')]
            if not row.empty:
                r = row.iloc[0]
                result['indices'].append({
                    'name': '恒生指数',
                    'close': safe_float(r.get('最新价')),
                    'change_pct': safe_float(r.get('涨跌幅')),
                    'amount': None,
                })
    except Exception as e:
        print(f'  [warn] 获取恒生指数失败: {e}')

    # ---- 3. 融资余额 ----
    try:
        df = ak.stock_margin_account_info()
        if df is not None and not df.empty:
            df = df.sort_index(ascending=False).head(2)
            rows = df.to_dict(orient='records')
            if len(rows) >= 1:
                balance_key = None
                for key in ['融资余额(亿元)', '融资余额', 'rzye']:
                    if key in rows[0]:
                        balance_key = key
                        break
                if balance_key:
                    today_balance = safe_float(rows[0].get(balance_key))
                    result['margin']['balance'] = round(today_balance, 2)
                    if len(rows) >= 2:
                        prev_balance = safe_float(rows[1].get(balance_key))
                        result['margin']['change'] = round(today_balance - prev_balance, 2)
    except Exception as e:
        print(f'  [warn] 获取融资余额失败: {e}')

    # ---- 4. 量能趋势（从新浪指数数据计算）----
    try:
        total_amount = 0
        for idx_item in result['indices']:
            if idx_item['name'] in ('上证指数', '深证成指') and idx_item.get('amount'):
                total_amount += idx_item['amount']
        if total_amount > 0:
            result['volume']['today'] = round(total_amount, 2)

        # 近5日均量：从新浪指数日线获取
        trade_dates = get_recent_trade_dates(6)
        if len(trade_dates) >= 5:
            amounts_5d = []
            for td in trade_dates[1:6]:
                try:
                    df_sh = ak.stock_zh_index_daily(symbol='sh000001')
                    df_sz = ak.stock_zh_index_daily(symbol='sz399001')
                    day_amount = 0
                    if df_sh is not None and not df_sh.empty:
                        # 按日期筛选
                        td_dash = f'{td[:4]}-{td[4:6]}-{td[6:]}'
                        sh_row = df_sh[df_sh['date'] == td_dash]
                        if not sh_row.empty:
                            day_amount += safe_float(sh_row.iloc[0].get('volume', 0)) / 1e8
                    if df_sz is not None and not df_sz.empty:
                        td_dash = f'{td[:4]}-{td[4:6]}-{td[6:]}'
                        sz_row = df_sz[df_sz['date'] == td_dash]
                        if not sz_row.empty:
                            day_amount += safe_float(sz_row.iloc[0].get('volume', 0)) / 1e8
                    if day_amount > 0:
                        amounts_5d.append(day_amount)
                except Exception:
                    pass
            if amounts_5d:
                avg_5d = sum(amounts_5d) / len(amounts_5d)
                result['volume']['avg_5d'] = round(avg_5d, 2)
                if avg_5d > 0 and result['volume']['today']:
                    change_pct = (result['volume']['today'] - avg_5d) / avg_5d * 100
                    result['volume']['change_pct'] = round(change_pct, 2)
    except Exception as e:
        print(f'  [warn] 计算量能趋势失败: {e}')

    return result


def collect_market_sentiment(date_str: str) -> dict:
    """
    采集模块2: 市场情绪指标
    返回: { up_count, down_count, limit_up, limit_down, broken_limit, broken_rate, strong_stocks, weak_stocks }
    """
    date_yyyymmdd = date_to_yyyymmdd(date_str)
    result = {
        'up_count': 0,
        'down_count': 0,
        'limit_up': 0,
        'limit_down': 0,
        'broken_limit': 0,
        'broken_rate': 0,
        'strong_stocks': 0,
        'weak_stocks': 0,
    }

    # ---- 1. 涨跌家数 + 强弱股（数据源: 同花顺）----
    try:
        df = ak.stock_zh_a_spot()
        if df is not None and not df.empty:
            changes = df['涨跌幅'].dropna()
            result['up_count'] = int((changes > 0).sum())
            result['down_count'] = int((changes < 0).sum())
            result['strong_stocks'] = int((changes > 7).sum())
            result['weak_stocks'] = int((changes < -7).sum())
    except Exception as e:
        print(f'  [warn] 获取全市场行情失败: {e}')

    # ---- 2. 涨停数（非 ST）----
    try:
        df = ak.stock_zt_pool_em(date=date_yyyymmdd)
        if df is not None and not df.empty:
            if '名称' in df.columns:
                non_st = df[~df['名称'].str.contains('ST', case=False, na=False)]
                result['limit_up'] = len(non_st)
            else:
                result['limit_up'] = len(df)
    except Exception as e:
        print(f'  [warn] 获取涨停池失败: {e}')

    # ---- 3. 跌停数（非 ST）----
    try:
        df = ak.stock_zt_pool_dtgc_em(date=date_yyyymmdd)
        if df is not None and not df.empty:
            if '名称' in df.columns:
                non_st = df[~df['名称'].str.contains('ST', case=False, na=False)]
                result['limit_down'] = len(non_st)
            else:
                result['limit_down'] = len(df)
    except Exception as e:
        print(f'  [warn] 获取跌停池失败: {e}')

    # ---- 4. 炸板数 ----
    try:
        df = ak.stock_zt_pool_zbgc_em(date=date_yyyymmdd)
        if df is not None and not df.empty:
            result['broken_limit'] = len(df)
    except Exception as e:
        print(f'  [warn] 获取炸板池失败: {e}')

    # ---- 5. 炸板率 ----
    total_board = result['limit_up'] + result['broken_limit']
    if total_board > 0:
        result['broken_rate'] = round(result['broken_limit'] / total_board * 100, 2)

    return result
