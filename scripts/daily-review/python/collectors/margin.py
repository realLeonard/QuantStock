"""模块: 两融余额（两市合计融资余额 + 日变化 + 连续天数 + 1Y 分位）

数据源：
  - akshare.stock_margin_account_info(): 两市合计融资余额时间序列（单位已是亿元）

说明：
  - 两融数据 T+1 发布（当日盘后次日早上才能拿到），trade_date 记录实际拿到的最新交易日
  - 连续天数：+N 表示连续 N 天净增，-N 表示连续 N 天净减
  - 1Y 分位：target_date 当日余额在近 1 年时间序列中的百分位（0-100）
"""

from __future__ import annotations

import akshare as ak
import pandas as pd
from datetime import datetime

from utils import safe_float


def _load_market_margin_series(date_str: str, days_back: int = 260) -> pd.DataFrame:
    """
    加载两市合计融资余额时间序列（按 date_str 截断）。
    返回 DataFrame: columns=['date'(YYYY-MM-DD), 'total_balance'(亿)]
    """
    df = ak.stock_margin_account_info()
    if df is None or df.empty:
        return pd.DataFrame(columns=['date', 'total_balance'])

    if '日期' not in df.columns or '融资余额' not in df.columns:
        print(f'  [warn] 两融接口列名未匹配: {list(df.columns)}')
        return pd.DataFrame(columns=['date', 'total_balance'])

    out = df[['日期', '融资余额']].copy()
    out.columns = ['date', 'total_balance']
    out['date'] = pd.to_datetime(out['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    out = out.dropna(subset=['date'])
    out['total_balance'] = out['total_balance'].apply(safe_float).round(2)
    out = out.sort_values('date').reset_index(drop=True)

    # 截断到 <= date_str，并只保留近 days_back 个交易日用于分位计算
    out = out[out['date'] <= date_str].tail(days_back).reset_index(drop=True)
    return out


def collect_margin_data(date_str: str) -> dict:
    """
    采集两融数据。date_str = 'YYYY-MM-DD'

    返回：
      {
        trade_date,           # 实际取到的最新交易日（可能 T-1）
        total_balance,        # 两市合计融资余额（亿）
        daily_change,         # 日变化（亿）
        change_5d[],          # 近 5 日变化（亿）
        consecutive_days,     # 连续净增/净减天数（带符号）
        balance_percentile_1y # 近 1 年分位（0-100）
      }
    """
    result: dict = {
        'trade_date': date_str,
        'total_balance': None,
        'daily_change': None,
        'change_5d': [],
        'consecutive_days': 0,
        'balance_percentile_1y': None,
    }

    # ---- 1. 加载 1 年时间序列 ----
    try:
        series_df = _load_market_margin_series(date_str, days_back=260)
    except Exception as e:
        print(f'  [warn] 获取两融时间序列失败: {e}')
        return result

    if series_df.empty:
        print('  [warn] 两融时间序列为空')
        return result

    # ---- 2. 最新交易日及余额 ----
    latest_row = series_df.iloc[-1]
    total_balance = float(latest_row['total_balance'])
    result['trade_date'] = latest_row['date']
    result['total_balance'] = round(total_balance, 2)

    # ---- 3. 日变化 + 近 5 日变化 ----
    tail = series_df.tail(6).reset_index(drop=True)
    if len(tail) >= 2:
        diffs: list[float] = []
        for i in range(1, len(tail)):
            diffs.append(
                round(float(tail.iloc[i]['total_balance']) - float(tail.iloc[i - 1]['total_balance']), 2)
            )
        result['daily_change'] = float(diffs[-1]) if diffs else None
        result['change_5d'] = [float(x) for x in diffs[-5:]]

    # ---- 4. 连续净增/净减天数 ----
    if result['change_5d']:
        rev = list(reversed(result['change_5d']))
        first = rev[0]
        sign = 1 if first > 0 else (-1 if first < 0 else 0)
        if sign == 0:
            result['consecutive_days'] = 0
        else:
            cnt = 0
            for v in rev:
                if (v > 0 and sign > 0) or (v < 0 and sign < 0):
                    cnt += 1
                else:
                    break
            result['consecutive_days'] = cnt * sign

    # ---- 5. 1Y 分位 ----
    series = series_df['total_balance'].astype(float).values
    if len(series) >= 20:
        rank = int((series < total_balance).sum())
        pct = round(rank / len(series) * 100, 1)
        result['balance_percentile_1y'] = float(pct)

    return result
