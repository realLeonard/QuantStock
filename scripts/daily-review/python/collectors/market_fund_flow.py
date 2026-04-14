"""模块: 大盘主力/散户资金聚合（v2 新增）

数据源：akshare.stock_market_fund_flow（全市场资金流向，历史日线）
字段：主力/超大单/大单/中单/小单 各自净额（元）

说明：
  主力 = 超大单 + 大单；散户 ≈ 小单；中单单列。
  返回的金额统一换算为「亿元」。
"""

import akshare as ak

from utils import safe_float


# 可能的列名（akshare 新版/旧版差异，做兜底匹配）
_MAIN_KEYS = ['主力净流入-净额', '主力净流入-净额（元）', '主力净流入']
_SUPER_KEYS = ['超大单净流入-净额', '超大单净流入-净额（元）', '超大单净流入']
_LARGE_KEYS = ['大单净流入-净额', '大单净流入-净额（元）', '大单净流入']
_MID_KEYS = ['中单净流入-净额', '中单净流入-净额（元）', '中单净流入']
_SMALL_KEYS = ['小单净流入-净额', '小单净流入-净额（元）', '小单净流入']


def _pick(row: dict, keys: list[str]) -> float:
    """按候选列名顺序取值，返回 float；无则 0"""
    for k in keys:
        if k in row and row[k] is not None:
            return safe_float(row[k])
    return 0.0


def _to_yi(val_yuan: float) -> float:
    """元 → 亿元，保留 2 位"""
    return round(val_yuan / 1e8, 2)


def collect_market_fund_flow(date_str: str) -> dict:
    """
    采集大盘主力/散户资金流向（取最新交易日）
    返回：{ main_inflow, super_large_inflow, large_inflow, mid_inflow, retail_inflow } 单位：亿元
    """
    result = {
        'main_inflow': None,
        'super_large_inflow': None,
        'large_inflow': None,
        'mid_inflow': None,
        'retail_inflow': None,
    }

    try:
        df = ak.stock_market_fund_flow()
        if df is None or df.empty:
            print('  [warn] 大盘资金流向数据为空')
            return result

        # 取最新一天（按日期升序，取最后一行）
        date_col = '日期' if '日期' in df.columns else df.columns[0]
        df_sorted = df.sort_values(date_col, ascending=True)
        latest = df_sorted.iloc[-1].to_dict()

        main = _pick(latest, _MAIN_KEYS)
        super_large = _pick(latest, _SUPER_KEYS)
        large = _pick(latest, _LARGE_KEYS)
        mid = _pick(latest, _MID_KEYS)
        small = _pick(latest, _SMALL_KEYS)

        result['main_inflow'] = _to_yi(main)
        result['super_large_inflow'] = _to_yi(super_large)
        result['large_inflow'] = _to_yi(large)
        result['mid_inflow'] = _to_yi(mid)
        result['retail_inflow'] = _to_yi(small)

    except Exception as e:
        print(f'  [warn] 获取大盘资金流向失败: {e}')

    return result
