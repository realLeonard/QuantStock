"""
板块涨跌查询脚本（回测用）
- stdin 传入 JSON：{"target_date":"YYYYMMDD", "watch":[...], "avoid":[...]}
- stdout 输出 JSON 结果：
  {
    "target_date": "20260415",
    "hs300_pct": 0.5,
    "watch": [{"name","matched","type","change_pct","hit"} | {"name","matched":null,"unmapped":true}],
    "avoid": [...],
  }

注：
- watch/avoid 输入已由上游 Claude 做了"自由词 → akshare 标准名"的映射
- 本脚本只负责按 akshare 标准名查具体涨跌幅
- 查不到的板块标记 unmapped=true，TS 侧跳过计数
"""
import sys
import os
import json
# 禁用 akshare 内部 tqdm 进度条（避免污染 stdout）
os.environ['TQDM_DISABLE'] = '1'
import akshare as ak


def get_concept_map() -> dict:
    """概念板块名 → 板块代码"""
    try:
        df = ak.stock_board_concept_name_em()
        return dict(zip(df['板块名称'], df['板块代码']))
    except Exception:
        return {}


def get_industry_map() -> dict:
    """行业板块名 → 板块代码"""
    try:
        df = ak.stock_board_industry_name_em()
        return dict(zip(df['板块名称'], df['板块代码']))
    except Exception:
        return {}


def fetch_board_return(name: str, target_date: str, concept_map: dict, industry_map: dict) -> dict:
    """
    查指定板块在 target_date(YYYYMMDD) 的涨跌幅
    返回：{matched, type, change_pct, close, unmapped}
    """
    board_type = None
    if name in concept_map:
        board_type = 'concept'
    elif name in industry_map:
        board_type = 'industry'
    else:
        return {'matched': None, 'unmapped': True}

    try:
        if board_type == 'concept':
            df = ak.stock_board_concept_hist_em(
                symbol=name, start_date=target_date, end_date=target_date,
                period='日k', adjust='',
            )
        else:
            df = ak.stock_board_industry_hist_em(
                symbol=name, start_date=target_date, end_date=target_date,
                period='日k', adjust='',
            )
        if df is None or df.empty:
            return {'matched': name, 'type': board_type, 'unmapped': True, 'error': '当日无数据'}
        row = df.iloc[0]
        return {
            'matched': name,
            'type': board_type,
            'change_pct': round(float(row.get('涨跌幅', 0)), 2),
            'close': round(float(row.get('收盘', 0)), 2),
        }
    except Exception as e:
        return {'matched': name, 'type': board_type, 'unmapped': True, 'error': str(e)}


def fetch_hs300_return(target_date: str) -> float | None:
    """查沪深300在 target_date 当日涨跌幅"""
    try:
        df = ak.stock_zh_index_daily_em(symbol='sz399300')
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


def main():
    raw = sys.stdin.read()
    req = json.loads(raw)
    target_date = req['target_date']
    watch_names = req.get('watch', [])
    avoid_names = req.get('avoid', [])

    # 预取板块列表（一次性）
    concept_map = get_concept_map()
    industry_map = get_industry_map()

    watch_results = [fetch_board_return(n, target_date, concept_map, industry_map) for n in watch_names]
    avoid_results = [fetch_board_return(n, target_date, concept_map, industry_map) for n in avoid_names]
    hs300 = fetch_hs300_return(target_date)

    # 回填原始查询词
    for n, r in zip(watch_names, watch_results):
        r['name'] = n
    for n, r in zip(avoid_names, avoid_results):
        r['name'] = n

    print(json.dumps({
        'target_date': target_date,
        'hs300_pct': hs300,
        'watch': watch_results,
        'avoid': avoid_results,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
