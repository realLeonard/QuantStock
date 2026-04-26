"""公共工具函数 — 板块名匹配、通用计算、Claude CLI 调用"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time


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


def call_claude_cli(
    prompt: str,
    label: str,
    timeout: int = 120,
) -> str:
    """
    通过 Claude CLI 调用 Opus 模型。

    将 prompt 写入临时文件，通过 stdin 指令让 CLI Read 该文件并按要求输出。
    返回 stdout 文本（已 strip）。失败时抛出 RuntimeError。
    """
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError('未配置 ANTHROPIC_API_KEY 环境变量')

    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.txt', prefix=f'{label}-', delete=False,
    ) as f:
        f.write(prompt)
        prompt_path = f.name

    cli_input = (
        f'请用 Read 工具读取文件 {prompt_path}，'
        '然后严格按照文件中的指令要求输出内容。'
        '直接输出内容，不要输出 markdown 代码块包裹。'
    )

    env = {**os.environ, 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
    start_ms = time.time()

    try:
        result = subprocess.run(
            [
                'claude', '-p',
                '--no-session-persistence',
                '--allowedTools', 'Read',
                '--model', 'claude-opus-4-6',
            ],
            input=cli_input,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start_ms
        print(f'  [claude-cli] {label} 超时 ({elapsed:.1f}s)')
        raise RuntimeError(f'Claude CLI 超时 ({label}, {timeout}s)')
    finally:
        try:
            os.unlink(prompt_path)
        except OSError:
            pass

    elapsed = time.time() - start_ms
    prompt_kb = len(prompt) / 1024
    resp_kb = len(result.stdout) / 1024
    print(
        f'  [claude-cli] {label} 完成 | '
        f'耗时 {elapsed:.1f}s | 退出码 {result.returncode} | '
        f'prompt {prompt_kb:.1f}KB → 响应 {resp_kb:.1f}KB'
    )

    if result.returncode != 0:
        err_msg = (result.stderr or result.stdout or '')[-500:]
        raise RuntimeError(
            f'Claude CLI 失败 ({label}, 退出码 {result.returncode}): {err_msg}'
        )

    return result.stdout.strip()
