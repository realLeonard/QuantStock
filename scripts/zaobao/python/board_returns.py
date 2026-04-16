"""
板块 + 个股涨跌查询脚本（回测用）

- stdin 传入 JSON（个股 code 由 TS 侧从 stockCodes / themeStocks 表查好传入）：
  {
    "target_date": "YYYYMMDD",
    "watch": [
      {"sector":"PCB概念","stocks":[{"name":"沪电股份","code":"002463"}, ...]},
      ...
    ],
    "avoid": [...]
  }

- stdout 输出 JSON（板块 + 个股涨跌幅，命中判定由 TS 层做）：
  {
    "target_date": "20260415",
    "hs300_pct": -0.34,
    "watch": [
      {
        "sector":"PCB概念", "matched":"PCB概念", "type":"concept",
        "change_pct":-1.09, "close":2232.66, "unmapped":false,
        "stocks": [
          {"name":"沪电股份", "code":"002463", "change_pct":-4.88, "close":92.78},
          {"name":"胜宏科技", "code":null, "unmapped":true, "error":"未找到代码"}
        ]
      }
    ],
    "avoid": [ ... ]
  }

数据源：
- 板块涨跌：同花顺 stock_board_concept_index_ths / stock_board_industry_index_ths
- 沪深300：新浪 stock_zh_index_daily('sh000300')
- 个股涨跌：新浪 stock_zh_a_daily（symbol 带市场前缀）
- 个股 name→code 映射：由上游 TS 使用 Supabase 表（stockCodes + themeStocks 兜底）完成

原因：东方财富 push2 API 被反爬，全量换到同花顺/新浪。
"""
import sys
import os
import json
from datetime import datetime, timedelta

os.environ['TQDM_DISABLE'] = '1'
os.environ['NO_PROXY'] = '*'
os.environ['no_proxy'] = '*'
import akshare as ak


# ================= 板块 =================
def load_concept_names() -> set:
    try:
        df = ak.stock_board_concept_name_ths()
        return set(df['name'].tolist())
    except Exception:
        return set()


def load_industry_names() -> set:
    try:
        df = ak.stock_board_industry_name_ths()
        return set(df['name'].tolist())
    except Exception:
        return set()


def fetch_sector_return(
    name: str,
    target_date: str,
    concept_names: set,
    industry_names: set,
) -> dict:
    """
    查板块在 target_date 的涨跌幅（基于前一交易日收盘价自算）
    返回：{matched, type, change_pct, close, unmapped, error?}
    """
    if name in concept_names:
        board_type = 'concept'
        fetch = ak.stock_board_concept_index_ths
    elif name in industry_names:
        board_type = 'industry'
        fetch = ak.stock_board_industry_index_ths
    else:
        return {'matched': None, 'unmapped': True}

    try:
        target_dt = datetime.strptime(target_date, '%Y%m%d')
        start = (target_dt - timedelta(days=15)).strftime('%Y%m%d')
        df = fetch(symbol=name, start_date=start, end_date=target_date)
        if df is None or df.empty:
            return {'matched': name, 'type': board_type, 'unmapped': True, 'error': '区间无数据'}
        df = df.reset_index(drop=True)
        df['date_str'] = df['日期'].astype(str).str.replace('-', '')
        mask = df['date_str'] == target_date
        if not mask.any():
            return {'matched': name, 'type': board_type, 'unmapped': True, 'error': '当日无数据'}
        pos = int(df[mask].index[0])
        if pos == 0:
            return {'matched': name, 'type': board_type, 'unmapped': True, 'error': '无前一日数据'}
        curr = float(df.iloc[pos]['收盘价'])
        prev = float(df.iloc[pos - 1]['收盘价'])
        if prev == 0:
            return {'matched': name, 'type': board_type, 'unmapped': True, 'error': '前一日收盘为0'}
        pct = round((curr - prev) / prev * 100, 2)
        return {
            'matched': name,
            'type': board_type,
            'change_pct': pct,
            'close': round(curr, 2),
        }
    except Exception as e:
        return {'matched': name, 'type': board_type, 'unmapped': True, 'error': str(e)}


# ================= 指数 =================
def fetch_hs300_return(target_date: str):
    try:
        df = ak.stock_zh_index_daily(symbol='sh000300')
        df['date_str'] = df['date'].astype(str).str.replace('-', '')
        mask = df['date_str'] == target_date
        if not mask.any():
            return None
        idx = df[mask].index[0]
        if idx == 0:
            return None
        prev_close = float(df.iloc[idx - 1]['close'])
        curr_close = float(df.iloc[idx]['close'])
        return round((curr_close - prev_close) / prev_close * 100, 2)
    except Exception:
        return None


# ================= 个股 =================
def add_market_prefix(code: str) -> str:
    """
    6位股票代码加市场前缀（新浪接口需要）
    - 6 开头 → sh  (含 603/605/688 科创板)
    - 0 / 3 开头 → sz  (含 000/001/002/003/300/301)
    - 4 / 8 / 9 开头 → bj (北交所)
    """
    if not code or len(code) != 6:
        return ''
    first = code[0]
    if first == '6':
        return f'sh{code}'
    if first in ('0', '3'):
        return f'sz{code}'
    if first in ('4', '8', '9'):
        return f'bj{code}'
    return ''


def fetch_stock_return(name: str, code: str | None, target_date: str) -> dict:
    """
    查个股 target_date 涨跌幅（code 由上游 TS 从 Supabase 查好传入）
    返回：{name, code, change_pct, close, unmapped, error?}
    """
    if not code:
        return {'name': name, 'code': None, 'unmapped': True, 'error': '未找到代码'}
    symbol = add_market_prefix(code)
    if not symbol:
        return {'name': name, 'code': code, 'unmapped': True, 'error': f'代码格式异常 {code}'}

    # 北交所新浪 stock_zh_a_daily 暂无数据，跳过
    if symbol.startswith('bj'):
        return {'name': name, 'code': code, 'unmapped': True, 'error': '北交所暂不支持'}

    try:
        target_dt = datetime.strptime(target_date, '%Y%m%d')
        start = (target_dt - timedelta(days=15)).strftime('%Y%m%d')
        df = ak.stock_zh_a_daily(symbol=symbol, start_date=start, end_date=target_date, adjust='')
        if df is None or df.empty:
            return {'name': name, 'code': code, 'unmapped': True, 'error': '区间无数据'}
        df = df.reset_index(drop=True)
        df['date_str'] = df['date'].astype(str).str.replace('-', '')
        mask = df['date_str'] == target_date
        if not mask.any():
            return {'name': name, 'code': code, 'unmapped': True, 'error': '当日无数据（停牌/新股）'}
        pos = int(df[mask].index[0])
        if pos == 0:
            return {'name': name, 'code': code, 'unmapped': True, 'error': '无前一日数据'}
        curr = float(df.iloc[pos]['close'])
        prev = float(df.iloc[pos - 1]['close'])
        if prev == 0:
            return {'name': name, 'code': code, 'unmapped': True, 'error': '前一日收盘为0'}
        pct = round((curr - prev) / prev * 100, 2)
        return {
            'name': name,
            'code': code,
            'change_pct': pct,
            'close': round(curr, 2),
        }
    except Exception as e:
        return {'name': name, 'code': code, 'unmapped': True, 'error': str(e)}


# ================= 主流程 =================
def process_group(
    items: list,
    target_date: str,
    concept_names: set,
    industry_names: set,
) -> list:
    """处理 watch 或 avoid 组：每项 {sector, stocks:[{name,code}]} → 查板块 + 所有个股"""
    out = []
    for item in items:
        sector = item.get('sector', '')
        stocks = item.get('stocks', []) or []
        sector_result = fetch_sector_return(sector, target_date, concept_names, industry_names)
        stock_results = [
            fetch_stock_return(s.get('name', ''), s.get('code'), target_date)
            for s in stocks
        ]
        out.append({
            'sector': sector,
            **sector_result,
            'stocks': stock_results,
        })
    return out


def main():
    raw = sys.stdin.read()
    req = json.loads(raw)
    target_date = req['target_date']
    watch = req.get('watch', []) or []
    avoid = req.get('avoid', []) or []

    concept_names = load_concept_names()
    industry_names = load_industry_names()

    watch_results = process_group(watch, target_date, concept_names, industry_names)
    avoid_results = process_group(avoid, target_date, concept_names, industry_names)
    hs300 = fetch_hs300_return(target_date)

    print(json.dumps({
        'target_date': target_date,
        'hs300_pct': hs300,
        'watch': watch_results,
        'avoid': avoid_results,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
