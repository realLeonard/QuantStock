"""公共工具函数 — 板块名匹配、通用计算"""

from __future__ import annotations


def normalize_sector_name(name: str) -> str:
    """去掉'概念''板块'后缀，strip空格"""
    return name.replace('概念', '').replace('板块', '').strip()


def match_sector_name(name_a: str, name_b: str) -> bool:
    """统一匹配逻辑：精确匹配 > 规范化匹配 > 长名称子串匹配（短名称≤2字不做子串）"""
    if name_a == name_b:
        return True

    clean_a = normalize_sector_name(name_a)
    clean_b = normalize_sector_name(name_b)

    if clean_a == clean_b:
        return True

    # 短名称（≤2字）只接受精确匹配，不做子串
    if len(clean_a) <= 2 or len(clean_b) <= 2:
        return False

    # 长名称允许子串匹配
    return clean_a in clean_b or clean_b in clean_a


def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """将值限制在 [lo, hi] 范围内"""
    return max(lo, min(hi, v))


def safe_float(val, default: float = 0.0) -> float:
    """安全转换为 float（处理 None / NaN / Inf）"""
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


def safe_div(a: float, b: float, default: float = 0.0) -> float:
    """安全除法，避免除以零"""
    return a / b if b != 0 else default


def percentile_rank(value: float, all_values: list[float]) -> float:
    """返回 value 在 all_values 中的百分位 (0~100)"""
    if not all_values:
        return 50.0
    below = sum(1 for v in all_values if v < value)
    return below / len(all_values) * 100


def mean(values: list[float]) -> float:
    """安全平均值（空列表返回0）"""
    return sum(values) / len(values) if values else 0.0
