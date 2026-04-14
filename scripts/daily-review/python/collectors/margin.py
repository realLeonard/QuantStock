"""模块: 两融余额（融资余额 + 日变化 + 连续天数 + 1Y 分位）

数据源：
  - akshare.stock_margin_sse(start_date, end_date): 沪市融资融券（daily 时间序列）
  - akshare.stock_margin_szse(date): 深市两融（按日，按股票聚合后求 sum）

说明：
  - 两融数据 T+1 发布（当日盘后次日早上才能拿到），date_str 对应"交易日"
  - 金额统一换算为亿元
  - 连续天数：+N 表示连续 N 天净增，-N 表示连续 N 天净减
  - 1Y 分位：target_date 当日余额在近 1 年时间序列中的百分位（0-100）
  - SZSE 查询较慢（需按日循环），只取最近 30 个交易日；SSE 取 1 年
"""

from __future__ import annotations

import akshare as ak
import pandas as pd
from datetime import datetime, timedelta

from utils import safe_float


def _to_yi(val: float) -> float:
    """元 → 亿元，保留 2 位"""
    return round(val / 1e8, 2) if val is not None else 0.0


def _fmt_date(d: datetime) -> str:
    return d.strftime('%Y%m%d')


def _pick_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _load_sse_series(date_str: str, days_back: int = 260) -> pd.DataFrame:
    """
    加载沪市融资余额近 N 日时间序列。
    返回 DataFrame: columns=['date'(YYYY-MM-DD), 'sse_balance'(亿)]
    """
    end = datetime.strptime(date_str, '%Y-%m-%d')
    start = end - timedelta(days=days_back + 60)  # 多取一点缓冲
    df = ak.stock_margin_sse(start_date=_fmt_date(start), end_date=_fmt_date(end))
    if df is None or df.empty:
        return pd.DataFrame(columns=['date', 'sse_balance'])

    date_col = _pick_col(df, ['信用交易日期', '交易日期', '日期'])
    bal_col = _pick_col(df, ['融资余额', '融资余额(元)'])
    if not date_col or not bal_col:
        print(f'  [warn] SSE 两融列名未匹配: {list(df.columns)}')
        return pd.DataFrame(columns=['date', 'sse_balance'])

    out = df[[date_col, bal_col]].copy()
    out.columns = ['date', 'sse_balance']
    # 日期规范化
    out['date'] = pd.to_datetime(out['date'], errors='coerce').dt.strftime('%Y-%m-%d')
    out = out.dropna(subset=['date'])
    out['sse_balance'] = out['sse_balance'].apply(safe_float).apply(_to_yi)
    out = out.sort_values('date').reset_index(drop=True)
    return out


def _load_szse_on_date(date_yyyymmdd: str) -> float | None:
    """
    深市单日融资余额合计（亿）。按日拉取 + 聚合 sum，较慢。
    """
    try:
        df = ak.stock_margin_szse(date=date_yyyymmdd)
        if df is None or df.empty:
            return None
        bal_col = _pick_col(df, ['融资余额', '融资余额(元)'])
        if not bal_col:
            return None
        total_yuan = df[bal_col].apply(safe_float).sum()
        return _to_yi(float(total_yuan))
    except Exception:
        return None


def collect_margin_data(date_str: str) -> dict:
    """
    采集两融数据。date_str = 'YYYY-MM-DD'

    返回：
      {
        trade_date, sse_balance, szse_balance, total_balance,
        daily_change, change_5d[], consecutive_days,
        balance_percentile_1y
      }

    容错：若 SZSE 获取失败，total_balance 回退为 sse_balance（记录 szse_balance=None）
    """
    result: dict = {
        'trade_date': date_str,
        'sse_balance': None,
        'szse_balance': None,
        'total_balance': None,
        'daily_change': None,
        'change_5d': [],
        'consecutive_days': 0,
        'balance_percentile_1y': None,
    }

    # ---- 1. SSE 1年时间序列 ----
    try:
        sse_df = _load_sse_series(date_str, days_back=260)
    except Exception as e:
        print(f'  [warn] 获取 SSE 两融失败: {e}')
        return result

    if sse_df.empty:
        print('  [warn] SSE 两融时间序列为空')
        return result

    # 找到目标日及其之前的数据（若 target 日尚未发布则取最近一日）
    target_rows = sse_df[sse_df['date'] <= date_str]
    if target_rows.empty:
        print(f'  [warn] SSE 序列中无 <= {date_str} 的数据')
        return result
    latest_date = target_rows.iloc[-1]['date']
    sse_balance = float(target_rows.iloc[-1]['sse_balance'])
    result['sse_balance'] = sse_balance
    result['trade_date'] = latest_date

    # ---- 2. SZSE 同日（可能失败）----
    szse_balance = _load_szse_on_date(latest_date.replace('-', ''))
    if szse_balance is not None:
        result['szse_balance'] = szse_balance
        result['total_balance'] = round(sse_balance + szse_balance, 2)
    else:
        # 深市缺失：用 SSE 近期占比估算（SSE 约占 55%），仅保留 SSE 做展示
        result['total_balance'] = sse_balance
        print('  [warn] SZSE 两融获取失败，total_balance 回退为 SSE')

    # ---- 3. 日变化 + 5日变化 ----
    # 用 SSE 序列算变化（稳定性好），total_balance 的日变化≈SSE 日变化
    tail = target_rows.tail(6).reset_index(drop=True)
    if len(tail) >= 2:
        diffs: list[float] = []
        for i in range(1, len(tail)):
            diffs.append(
                round(float(tail.iloc[i]['sse_balance']) - float(tail.iloc[i - 1]['sse_balance']), 2)
            )
        result['daily_change'] = float(diffs[-1]) if diffs else None
        # 近 5 日变化（最多 5 条）
        result['change_5d'] = [float(x) for x in diffs[-5:]]

    # ---- 4. 连续净增/净减天数 ----
    # 从最近往前数，符号相同则累加
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
    # 用全部 SSE 序列（约 260 个交易日）算百分位
    series = sse_df['sse_balance'].astype(float).values
    if len(series) >= 20:
        rank = int((series < sse_balance).sum())
        pct = round(rank / len(series) * 100, 1)
        result['balance_percentile_1y'] = float(pct)

    return result
