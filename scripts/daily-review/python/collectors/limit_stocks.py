"""模块4: 连板天梯 + 模块7: 涨跌停行业分布"""

import akshare as ak

from utils import safe_float, safe_int, date_to_yyyymmdd


def collect_limit_up_ladder(date_str: str) -> list:
    """
    采集模块4: 连板天梯
    返回: [{ code, name, price, change_pct, continuous_limit, industries }]
    按连板数降序排列
    """
    date_yyyymmdd = date_to_yyyymmdd(date_str)
    result = []

    try:
        df = ak.stock_zt_pool_em(date=date_yyyymmdd)
        if df is None or df.empty:
            print('  [warn] 涨停池数据为空')
            return result

        # 连板数字段名可能是 '连板数' 或 '几天几板'
        limit_col = None
        for col in ['连板数', '几天几板', '连续涨停天数']:
            if col in df.columns:
                limit_col = col
                break

        if limit_col is None:
            print(f'  [warn] 未找到连板数字段, 可用列: {list(df.columns)}')
            # 如果没有连板数字段，所有涨停股都算1连板
            df['_连板数'] = 1
            limit_col = '_连板数'

        # 排除 ST，只取连板 >= 2 的
        if '名称' in df.columns:
            df = df[~df['名称'].str.contains('ST', case=False, na=False)]
        df = df[df[limit_col].apply(lambda x: safe_int(x)) >= 2]

        # 按连板数降序
        df = df.sort_values(limit_col, ascending=False)

        # 行业字段
        industry_col = None
        for col in ['所属行业', '行业']:
            if col in df.columns:
                industry_col = col
                break

        for _, row in df.iterrows():
            industries = []
            if industry_col and row.get(industry_col):
                # 行业可能用逗号或空格分隔，最多取3个
                raw = str(row[industry_col])
                for sep in [',', '，', ' ', '/']:
                    if sep in raw:
                        industries = [s.strip() for s in raw.split(sep) if s.strip()][:3]
                        break
                if not industries:
                    industries = [raw.strip()]

            result.append({
                'code': str(row.get('代码', '')).strip(),
                'name': str(row.get('名称', '')).strip(),
                'price': safe_float(row.get('最新价')),
                'change_pct': safe_float(row.get('涨跌幅')),
                'continuous_limit': safe_int(row.get(limit_col)),
                'industries': industries[:3],
            })

    except Exception as e:
        print(f'  [warn] 获取连板天梯失败: {e}')

    return result


def collect_limit_industry_distribution(date_str: str) -> list:
    """
    采集模块7: 涨跌停行业分布
    返回: [{
        industry, limit_up_count, limit_down_count,
        limit_up_stocks: [{ code, name, first_time }],
        limit_down_stocks: [{ code, name }]
    }]
    按涨停数降序排列
    """
    date_yyyymmdd = date_to_yyyymmdd(date_str)

    # 按行业统计涨停
    up_by_industry: dict[str, list] = {}
    down_by_industry: dict[str, list] = {}

    # ---- 涨停股 ----
    try:
        df = ak.stock_zt_pool_em(date=date_yyyymmdd)
        if df is not None and not df.empty:
            # 排除 ST
            if '名称' in df.columns:
                df = df[~df['名称'].str.contains('ST', case=False, na=False)]

            industry_col = None
            for col in ['所属行业', '行业']:
                if col in df.columns:
                    industry_col = col
                    break

            time_col = None
            for col in ['首次封板时间', '首次涨停时间', '涨停时间']:
                if col in df.columns:
                    time_col = col
                    break

            if industry_col:
                for _, row in df.iterrows():
                    industry = str(row.get(industry_col, '未知')).strip()
                    if not industry or industry == 'nan':
                        industry = '未知'
                    stock_info = {
                        'code': str(row.get('代码', '')).strip(),
                        'name': str(row.get('名称', '')).strip(),
                        'first_time': str(row.get(time_col, '')) if time_col else '',
                    }
                    up_by_industry.setdefault(industry, []).append(stock_info)
    except Exception as e:
        print(f'  [warn] 获取涨停行业分布失败: {e}')

    # ---- 跌停股 ----
    try:
        df = ak.stock_zt_pool_dtgc_em(date=date_yyyymmdd)
        if df is not None and not df.empty:
            if '名称' in df.columns:
                df = df[~df['名称'].str.contains('ST', case=False, na=False)]

            industry_col = None
            for col in ['所属行业', '行业']:
                if col in df.columns:
                    industry_col = col
                    break

            if industry_col:
                for _, row in df.iterrows():
                    industry = str(row.get(industry_col, '未知')).strip()
                    if not industry or industry == 'nan':
                        industry = '未知'
                    stock_info = {
                        'code': str(row.get('代码', '')).strip(),
                        'name': str(row.get('名称', '')).strip(),
                    }
                    down_by_industry.setdefault(industry, []).append(stock_info)
    except Exception as e:
        print(f'  [warn] 获取跌停行业分布失败: {e}')

    # ---- 合并结果 ----
    all_industries = set(list(up_by_industry.keys()) + list(down_by_industry.keys()))
    result = []
    for industry in all_industries:
        up_stocks = up_by_industry.get(industry, [])
        down_stocks = down_by_industry.get(industry, [])

        # 涨停代表股按涨停时间最早排序，取前5
        if up_stocks:
            up_stocks.sort(key=lambda x: x.get('first_time', '99:99'))
        limit_up_repr = up_stocks[:5]

        # 跌停代表股取前5
        limit_down_repr = down_stocks[:5]

        result.append({
            'industry': industry,
            'limit_up_count': len(up_stocks),
            'limit_down_count': len(down_stocks),
            'limit_up_stocks': limit_up_repr,
            'limit_down_stocks': limit_down_repr,
        })

    # 按涨停数降序
    result.sort(key=lambda x: x['limit_up_count'], reverse=True)

    return result
