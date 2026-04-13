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


# 模块级缓存：新浪行业板块 code→行业 全量映射（每次进程只构建一次）
_INDUSTRY_CACHE: dict[str, str] | None = None


def _build_industry_cache() -> dict[str, str]:
    """遍历新浪行业板块，构建 股票代码(6位) → 行业名称 映射表"""
    global _INDUSTRY_CACHE
    if _INDUSTRY_CACHE is not None:
        return _INDUSTRY_CACHE

    mapping: dict[str, str] = {}
    try:
        sectors_df = ak.stock_sector_spot(indicator='新浪行业')
        if sectors_df is None or sectors_df.empty:
            print('  [warn] 获取新浪行业列表为空')
            _INDUSTRY_CACHE = mapping
            return mapping

        for _, sector_row in sectors_df.iterrows():
            label = str(sector_row.get('label', ''))
            industry_name = str(sector_row.get('板块', ''))
            if not label or not industry_name:
                continue
            try:
                detail_df = ak.stock_sector_detail(sector=label)
                if detail_df is not None and not detail_df.empty:
                    for _, stock_row in detail_df.iterrows():
                        code = str(stock_row.get('code', '')).strip()
                        if code and len(code) == 6:
                            mapping[code] = industry_name
                time.sleep(0.1)
            except Exception:
                continue

        print(f'  [info] 行业映射表已构建，覆盖 {len(mapping)} 只个股')
    except Exception as e:
        print(f'  [warn] 构建行业映射表失败: {e}')

    _INDUSTRY_CACHE = mapping
    return mapping


def get_stock_industry_batch(codes: list[str]) -> dict[str, str]:
    """
    批量获取个股所属行业（数据源: 新浪行业板块）
    返回 {股票代码: 行业名称} 映射
    """
    cache = _build_industry_cache()
    result = {}
    for code in codes:
        result[code] = cache.get(code, '未知')
    return result


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
