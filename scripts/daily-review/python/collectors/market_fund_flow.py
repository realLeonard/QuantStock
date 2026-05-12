"""模块: 大盘主力/散户资金聚合（v2 新增）

数据源：
  主：akshare stock_market_fund_flow（东财，全市场资金流向）
  备：tushare moneyflow_mkt_dc（东财被封时自动切换）

字段：主力/超大单/大单/中单/小单 各自净额（元）

说明：
  主力 = 超大单 + 大单；散户 ≈ 小单；中单单列。
  返回的金额统一换算为「亿元」。
"""

import os
import time

import akshare as ak

from utils import safe_float


_MAIN_KEYS = ['主力净流入-净额', '主力净流入-净额（元）', '主力净流入']
_SUPER_KEYS = ['超大单净流入-净额', '超大单净流入-净额（元）', '超大单净流入']
_LARGE_KEYS = ['大单净流入-净额', '大单净流入-净额（元）', '大单净流入']
_MID_KEYS = ['中单净流入-净额', '中单净流入-净额（元）', '中单净流入']
_SMALL_KEYS = ['小单净流入-净额', '小单净流入-净额（元）', '小单净流入']


def _pick(row: dict, keys: list[str]) -> float:
    for k in keys:
        if k in row and row[k] is not None:
            return safe_float(row[k])
    return 0.0


def _to_yi(val_yuan: float) -> float:
    return round(val_yuan / 1e8, 2)


def _fetch_via_akshare() -> dict | None:
    """东财主源：akshare stock_market_fund_flow"""
    try:
        df = ak.stock_market_fund_flow()
        if df is None or df.empty:
            return None

        date_col = '日期' if '日期' in df.columns else df.columns[0]
        df_sorted = df.sort_values(date_col, ascending=True)
        latest = df_sorted.iloc[-1].to_dict()

        return {
            'main_inflow': _to_yi(_pick(latest, _MAIN_KEYS)),
            'super_large_inflow': _to_yi(_pick(latest, _SUPER_KEYS)),
            'large_inflow': _to_yi(_pick(latest, _LARGE_KEYS)),
            'mid_inflow': _to_yi(_pick(latest, _MID_KEYS)),
            'retail_inflow': _to_yi(_pick(latest, _SMALL_KEYS)),
        }
    except Exception as e:
        print(f'  [warn] 东财大盘资金流向失败: {e}')
        return None


def _fetch_via_tushare(date_str: str) -> dict | None:
    """Tushare 后备：moneyflow_mkt_dc"""
    token = os.environ.get('TUSHARE_TOKEN', '')
    if not token:
        print('  [warn] 未配置 TUSHARE_TOKEN，无法使用 tushare 后备')
        return None

    try:
        import tushare as ts
    except ImportError:
        print('  [warn] tushare 未安装，无法使用后备')
        return None

    trade_date = date_str.replace('-', '')
    try:
        pro = ts.pro_api(token)
        df = pro.moneyflow_mkt_dc(trade_date=trade_date)
        if df is None or df.empty:
            return None

        row = df.iloc[0]
        return {
            'main_inflow': _to_yi(safe_float(row.get('net_amount', 0))),
            'super_large_inflow': _to_yi(safe_float(row.get('buy_elg_amount', 0))),
            'large_inflow': _to_yi(safe_float(row.get('buy_lg_amount', 0))),
            'mid_inflow': _to_yi(safe_float(row.get('buy_md_amount', 0))),
            'retail_inflow': _to_yi(safe_float(row.get('buy_sm_amount', 0))),
        }
    except Exception as e:
        print(f'  [warn] tushare 大盘资金流向失败: {e}')
        return None


def collect_market_fund_flow(date_str: str) -> dict:
    """
    采集大盘主力/散户资金流向。
    东财优先，失败自动切换 tushare。
    返回：{ main_inflow, super_large_inflow, large_inflow, mid_inflow, retail_inflow } 单位：亿元
    """
    empty = {
        'main_inflow': None,
        'super_large_inflow': None,
        'large_inflow': None,
        'mid_inflow': None,
        'retail_inflow': None,
    }

    data = _fetch_via_akshare()
    if data:
        return data

    print('  [info] 东财不可用，切换 tushare...')
    data = _fetch_via_tushare(date_str)
    if data:
        return data

    return empty
