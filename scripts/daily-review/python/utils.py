"""工具函数：日期处理、行业映射等"""

import time
from datetime import datetime, timedelta, timezone

import akshare as ak

# 北京时区
_BJ_TZ = timezone(timedelta(hours=8))


def get_today_date() -> str:
    """获取当前北京时间日期 YYYY-MM-DD"""
    return datetime.now(_BJ_TZ).strftime('%Y-%m-%d')


def date_to_yyyymmdd(date_str: str) -> str:
    """'2026-04-10' → '20260410'"""
    return date_str.replace('-', '')


def get_recent_trade_dates(n: int = 10) -> list[str]:
    """
    获取最近 N 个交易日（YYYYMMDD 格式）
    返回按日期降序排列（最近的在前）
    """
    try:
        df = ak.tool_trade_date_hist_sina()
        # 列名通常是 trade_date
        dates = df['trade_date'].astype(str).tolist()
        today = datetime.now(_BJ_TZ).strftime('%Y%m%d')
        # 过滤出不超过今天的日期
        valid = [d.replace('-', '') for d in dates if d.replace('-', '') <= today]
        # 取最近 N 个
        return sorted(valid, reverse=True)[:n]
    except Exception as e:
        print(f'  [warn] 获取交易日历失败: {e}')
        # 降级：用最近 N 个自然日（不含周末）
        result = []
        current = datetime.now(_BJ_TZ)
        while len(result) < n:
            if current.weekday() < 5:  # 周一到周五
                result.append(current.strftime('%Y%m%d'))
            current -= timedelta(days=1)
        return result


def get_stock_industry_batch(codes: list[str]) -> dict[str, str]:
    """
    批量获取个股所属行业
    返回 {股票代码: 行业名称} 映射
    """
    industry_map = {}
    for code in codes:
        if code in industry_map:
            continue
        try:
            df = ak.stock_individual_info_em(symbol=code)
            for _, row in df.iterrows():
                item = str(row.get('item', ''))
                if item == '行业':
                    industry_map[code] = str(row.get('value', '未知'))
                    break
            else:
                industry_map[code] = '未知'
        except Exception:
            industry_map[code] = '未知'
        # 避免请求过快
        time.sleep(0.3)
    return industry_map


def safe_float(val, default=0.0) -> float:
    """安全转换为 float，自动处理 NaN"""
    import math
    try:
        if val is None:
            return default
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def safe_int(val, default=0) -> int:
    """安全转换为 int"""
    try:
        if val is None:
            return default
        return int(float(val))
    except (ValueError, TypeError):
        return default
