"""模块: 上证黄白线（v2 新增）

- 白线 = 上证综指自身涨跌幅（加权，大市值影响大）
- 黄线 = 上证 A 股所有成份股等权平均涨跌幅（小票影响大）
- 两者差值反映风格偏向（题材/权重/均衡）

数据源：
  - 白线：akshare.stock_zh_index_spot_sina 取 sh000001
  - 黄线：akshare.stock_zh_a_spot 筛 6 开头（沪市主板+科创板）后求均值
"""

import akshare as ak

from utils import safe_float


def _classify_style(divergence: float) -> str:
    """根据 黄线 - 白线 差值判断风格偏向
    阈值：|div| < 0.3 均衡；黄线强 0.3+ 题材风格；白线强 0.3+ 权重风格
    """
    if abs(divergence) < 0.3:
        return '均衡'
    if divergence > 0:
        return '题材风格'
    return '权重风格'


def collect_yellow_white(date_str: str) -> dict:
    """
    采集上证黄白线（收盘时点）
    返回：{ yellow_line_chg, white_line_chg, divergence, style_bias }
    """
    result = {
        'yellow_line_chg': None,
        'white_line_chg': None,
        'divergence': None,
        'style_bias': None,
    }

    # ---- 1. 白线：上证综指加权涨幅 ----
    try:
        df_idx = ak.stock_zh_index_spot_sina()
        if df_idx is not None and not df_idx.empty:
            row = df_idx[df_idx['代码'] == 'sh000001']
            if not row.empty:
                result['white_line_chg'] = round(safe_float(row.iloc[0].get('涨跌幅')), 2)
    except Exception as e:
        print(f'  [warn] 获取上证综指涨跌幅失败: {e}')

    # ---- 2. 黄线：沪市 A 股等权平均涨幅 ----
    try:
        df = ak.stock_zh_a_spot()
        if df is not None and not df.empty:
            # 沪市主板 60xxxx / 科创板 68xxxx；筛选 6 开头
            code_col = '代码' if '代码' in df.columns else 'symbol'
            mask = df[code_col].astype(str).str.startswith(('sh6', '6'))
            sh_df = df[mask]
            if not sh_df.empty:
                changes = sh_df['涨跌幅'].dropna().astype(float)
                if len(changes) > 0:
                    result['yellow_line_chg'] = round(float(changes.mean()), 2)
    except Exception as e:
        print(f'  [warn] 计算沪市等权涨幅失败: {e}')

    # ---- 3. 差值与风格偏向 ----
    y, w = result['yellow_line_chg'], result['white_line_chg']
    if y is not None and w is not None:
        div = round(y - w, 2)
        result['divergence'] = div
        result['style_bias'] = _classify_style(div)

    return result
