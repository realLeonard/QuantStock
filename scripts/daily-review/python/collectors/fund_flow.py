"""模块8: 板块资金流向 + 模块9: 个股资金流向"""

import time

import akshare as ak

from utils import safe_float, get_recent_trade_dates


def _calc_inflow_days(daily_flows: list[float]) -> int:
    """计算列表中正值（净流入）的天数"""
    return sum(1 for f in daily_flows if f > 0)


def collect_sector_fund_flow(date_str: str) -> dict:
    """
    采集模块8: 板块资金流向 TOP10
    返回: {
        inflow: [{ sector, net_amount, top_stocks, inflow_days_10 }],
        outflow: [{ sector, net_amount, top_stocks, inflow_days_10 }],
    }
    """
    result = {'inflow': [], 'outflow': []}

    try:
        df = ak.stock_sector_fund_flow_rank(indicator='今日', sector_type='行业资金流')
        if df is None or df.empty:
            print('  [warn] 板块资金流向数据为空')
            return result

        # 找到净流入金额字段
        amount_col = None
        for col in ['今日主力净流入-净额', '主力净流入-净额', '今日净流入', '净额']:
            if col in df.columns:
                amount_col = col
                break
        if not amount_col:
            # 尝试包含"净"字的列
            for col in df.columns:
                if '净' in col and '额' in col:
                    amount_col = col
                    break

        if not amount_col:
            print(f'  [warn] 未找到净流入字段, 可用列: {list(df.columns)}')
            return result

        # 板块名称字段
        name_col = None
        for col in ['名称', '板块名称', '行业']:
            if col in df.columns:
                name_col = col
                break
        if not name_col:
            name_col = df.columns[0]

        # 排序
        df['_net'] = df[amount_col].apply(safe_float)
        df_sorted = df.sort_values('_net', ascending=False)

        # 前10流入 + 后10流出
        top_inflow = df_sorted.head(10)
        top_outflow = df_sorted.tail(10).sort_values('_net', ascending=True)

        # 获取近10个交易日的板块资金数据（用于计算流入天数）
        trade_dates = get_recent_trade_dates(11)  # 多取1天
        sector_history: dict[str, list[float]] = {}

        # 收集需要查历史的板块名
        target_sectors = set()
        for _, row in top_inflow.iterrows():
            target_sectors.add(str(row[name_col]))
        for _, row in top_outflow.iterrows():
            target_sectors.add(str(row[name_col]))

        # 拉取历史数据（最多查10天，每天一次 API 调用）
        for td in trade_dates[1:11]:
            try:
                td_formatted = f'{td[:4]}-{td[4:6]}-{td[6:]}'
                hist_df = ak.stock_sector_fund_flow_rank(
                    indicator='今日', sector_type='行业资金流'
                )
                if hist_df is not None and not hist_df.empty:
                    for _, row in hist_df.iterrows():
                        sector_name = str(row.get(name_col, ''))
                        if sector_name in target_sectors:
                            flow = safe_float(row.get(amount_col, 0))
                            sector_history.setdefault(sector_name, []).append(flow)
                time.sleep(0.5)
            except Exception:
                pass

        # 组装流入 TOP10
        for _, row in top_inflow.iterrows():
            sector_name = str(row[name_col])
            net = safe_float(row[amount_col])
            # 净额转为亿元（如果 > 1e8 说明是元为单位）
            net_yi = net / 1e8 if abs(net) > 1e6 else net
            history = sector_history.get(sector_name, [])

            result['inflow'].append({
                'sector': sector_name,
                'net_amount': round(net_yi, 2),
                'top_stocks': _get_sector_top_stocks(sector_name),
                'inflow_days_10': _calc_inflow_days(history) if history else None,
            })

        # 组装流出 TOP10
        for _, row in top_outflow.iterrows():
            sector_name = str(row[name_col])
            net = safe_float(row[amount_col])
            net_yi = net / 1e8 if abs(net) > 1e6 else net
            history = sector_history.get(sector_name, [])

            result['outflow'].append({
                'sector': sector_name,
                'net_amount': round(net_yi, 2),
                'top_stocks': _get_sector_top_stocks(sector_name),
                'inflow_days_10': _calc_inflow_days(history) if history else None,
            })

    except Exception as e:
        print(f'  [warn] 获取板块资金流向失败: {e}')

    return result


def _get_sector_top_stocks(sector_name: str, top_n: int = 5) -> list[str]:
    """获取板块内净流入最大的个股名称"""
    try:
        df = ak.stock_board_industry_cons_em(symbol=sector_name)
        if df is None or df.empty:
            return []

        # 如果有资金流向字段，按流入排序
        flow_col = None
        for col in ['主力净流入-净额', '今日主力净流入', '净流入']:
            if col in df.columns:
                flow_col = col
                break

        if flow_col:
            df['_flow'] = df[flow_col].apply(safe_float)
            df = df.sort_values('_flow', ascending=False)
        # 否则就取前几只
        names = df.head(top_n)['名称'].tolist() if '名称' in df.columns else []
        return [str(n) for n in names]
    except Exception:
        return []


def collect_stock_fund_flow(date_str: str) -> dict:
    """
    采集模块9: 个股资金流向 TOP10
    返回: {
        inflow: [{ code, name, net_amount, change_pct, inflow_days_10 }],
        outflow: [{ code, name, net_amount, change_pct, inflow_days_10 }],
    }
    """
    result = {'inflow': [], 'outflow': []}

    try:
        df = ak.stock_individual_fund_flow_rank(indicator='今日')
        if df is None or df.empty:
            print('  [warn] 个股资金流向数据为空')
            return result

        # 找到关键字段
        code_col = _find_col(df, ['代码', '股票代码'])
        name_col = _find_col(df, ['名称', '股票名称'])
        amount_col = _find_col(df, ['今日主力净流入-净额', '主力净流入-净额', '净额'])
        change_col = _find_col(df, ['今日涨跌幅', '涨跌幅'])

        if not amount_col:
            print(f'  [warn] 未找到净流入字段, 可用列: {list(df.columns)}')
            return result

        df['_net'] = df[amount_col].apply(safe_float)
        df_sorted = df.sort_values('_net', ascending=False)

        top_inflow = df_sorted.head(10)
        top_outflow = df_sorted.tail(10).sort_values('_net', ascending=True)

        # 获取个股10日流入天数
        def _process_stocks(stock_df, target_list):
            for _, row in stock_df.iterrows():
                code = str(row.get(code_col, '')).strip() if code_col else ''
                net = safe_float(row.get(amount_col, 0))
                # 转为亿元
                net_yi = net / 1e8 if abs(net) > 1e6 else net

                # 查询个股近10日资金流向
                inflow_days = _get_stock_inflow_days(code)

                target_list.append({
                    'code': code,
                    'name': str(row.get(name_col, '')).strip() if name_col else '',
                    'net_amount': round(net_yi, 2),
                    'change_pct': safe_float(row.get(change_col, 0)) if change_col else 0,
                    'inflow_days_10': inflow_days,
                })

        _process_stocks(top_inflow, result['inflow'])
        _process_stocks(top_outflow, result['outflow'])

    except Exception as e:
        print(f'  [warn] 获取个股资金流向失败: {e}')

    return result


def _get_stock_inflow_days(code: str, days: int = 10) -> int | None:
    """获取个股近 N 个交易日中净流入的天数"""
    try:
        # 判断市场（上海/深圳）
        market = 'sh' if code.startswith(('6', '9')) else 'sz'
        df = ak.stock_individual_fund_flow(stock=code, market=market)
        if df is None or df.empty:
            return None

        # 取最近 N 天
        df = df.tail(days)

        # 找净流入字段
        flow_col = None
        for col in ['主力净流入-净额', '净流入', '主力净流入']:
            if col in df.columns:
                flow_col = col
                break
        if not flow_col:
            return None

        flows = df[flow_col].apply(safe_float).tolist()
        return _calc_inflow_days(flows)
    except Exception:
        return None
    finally:
        time.sleep(0.3)  # 避免请求过快


def _find_col(df, candidates: list[str]) -> str | None:
    """从 DataFrame 列名中找到第一个匹配的"""
    for col in candidates:
        if col in df.columns:
            return col
    return None
