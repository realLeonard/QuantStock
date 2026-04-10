"""模块3: 近期热门股 TOP20"""

import akshare as ak

from utils import safe_float


def collect_hot_stocks() -> list:
    """
    采集模块3: 东方财富人气榜前20只
    返回: [{ rank, code, name, price, change_pct, turnover_rate }]
    """
    result = []

    try:
        df = ak.stock_hot_rank_em()
        if df is None or df.empty:
            print('  [warn] 热门股数据为空')
            return result

        # 取前20条
        df = df.head(20)

        for idx, row in df.iterrows():
            code = str(row.get('股票代码', row.get('代码', ''))).strip()
            # 去掉 SH/SZ 前缀（如 SH600030 → 600030）
            if len(code) > 6:
                code = code[-6:]
            result.append({
                'rank': idx + 1,
                'code': code,
                'name': str(row.get('股票名称', row.get('名称', ''))).strip(),
                'price': safe_float(row.get('最新价')),
                'change_pct': safe_float(row.get('涨跌幅')),
                'turnover_rate': safe_float(row.get('换手率')),
            })

    except Exception as e:
        print(f'  [warn] 获取热门股失败: {e}')

    return result
