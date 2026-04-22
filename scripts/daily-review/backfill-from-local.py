"""从本地图片回填 limitUpReasons

用法：python3 backfill-from-local.py [--dir docs/jiuyan] [--dry-run]

读取目录下的 PNG 图片（文件名如 1-5.png → 2026-01-05），
调 Claude Vision 解析后写入 DB。幂等：已有日期跳过。
"""

import argparse
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent.parent / 'apps' / 'web' / '.env.local'
load_dotenv(env_path)

from supabase import create_client
import httpx

url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
key = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
if not url or not key:
    print('[error] 缺少 Supabase 环境变量')
    sys.exit(1)

sb = create_client(url, key)

PROMPT = """这是一张"韭研公社今天涨停复盘简图"的表格图片。表格列依次为：
  1. 板数（如"首板"、"5天4板"、"4连板"；当 "X天Y板" 中 X===Y 时图片会直接显示为 "Y连板"，请原样记录）
  2. 代码（6位数字）
  3. 个股（股票名）
  4. 涨停时间（HH:MM）
  5. 流通市值（单位：亿元）
  6. 成交额（单位：亿元）
  7. 涨停关键词（文字描述）

表格里穿插着"板块分隔行"，形如 "算力*11"（板块名 + "*" + 该板块涨停数），占据整行。板块分隔行下方所有股票都归属于该板块，直到遇到下一个分隔行。

任务：按板块分组输出 JSON，不要任何说明文字或 markdown 代码块，严格按以下结构：

{"themes":[{"name":"板块名","count":11,"stocks":[{"board":"首板","code":"301606","name":"XXX","time":"09:31","float_mv":23.45,"turnover_amt":8.12,"keyword":"AI算力"}]}]}

规则：
- 保持图片原始顺序
- "板数"里的 "X天Y板"、"Y连板"、"首板" 原样放到 board 字段
- float_mv / turnover_amt 用数字（亿元），识别不清时填 null，不要填字符串
- code 必须是 6 位数字字符串，保留前导零
- time 格式 "HH:MM"
- 忽略水印、页眉、标题、二维码、风险提示区域
- 若某板块内没有股票，丢弃该板块
- 输出 JSON 的 themes[i].count 必须等于其 stocks 数组长度"""


def fix_inner_quotes(s: str) -> str:
    """修复 JSON 字符串值中未转义的双引号。

    Vision 模型常返回如 "keyword":"投资"凌空天行"" 这样的内容，
    中文书名号式引号嵌套在 JSON 字符串内导致解析失败。
    策略：用正则找到 keyword 等字段值中的内嵌引号，替换为中文引号。
    """
    # 匹配 :"..." 值中的未转义内嵌双引号
    # 逐字符扫描：在 JSON 值字符串中，如果遇到 " 后面既不是 , } ] 也不是 key:
    # 则判定为内嵌引号，替换为中文引号
    result = []
    i = 0
    in_string = False
    string_start = -1

    while i < len(s):
        ch = s[i]

        if not in_string:
            result.append(ch)
            if ch == '"':
                in_string = True
                string_start = i
            i += 1
            continue

        # 在字符串内
        if ch == '\\':
            result.append(ch)
            if i + 1 < len(s):
                result.append(s[i + 1])
                i += 2
            else:
                i += 1
            continue

        if ch == '"':
            # 判断这个 " 是字符串结束还是内嵌引号
            # 向后看：跳过空白，如果是 , } ] : 则是字符串结束
            j = i + 1
            while j < len(s) and s[j] in ' \t\n\r':
                j += 1
            if j >= len(s) or s[j] in ',}]:':
                # 正常字符串结束
                result.append(ch)
                in_string = False
                i += 1
                continue
            else:
                # 内嵌引号，替换为中文左引号
                result.append('\u201c')
                i += 1
                # 找配对的内嵌右引号
                continue
        else:
            result.append(ch)
            i += 1

    return ''.join(result)


def trim_to_json_end(s: str) -> str:
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(s):
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            depth += 1
        elif ch in ('}', ']'):
            depth -= 1
            if depth == 0:
                return s[:i + 1]
    return s


def repair_truncated_json(s: str) -> str:
    stack = []
    in_string = False
    escape = False
    for ch in s:
        if escape:
            escape = False
            continue
        if ch == '\\' and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in ('{', '['):
            stack.append('}' if ch == '{' else ']')
        elif ch in ('}', ']'):
            if stack:
                stack.pop()
    if in_string:
        s += '"'
    return s + ''.join(reversed(stack))


def filename_to_date(name: str) -> str | None:
    """1-5.png → 2026-01-05, 3-24.png → 2026-03-24"""
    m = re.match(r'^(\d{1,2})-(\d{1,2})\.(?:png|jpg|jpeg)$', name, re.IGNORECASE)
    if not m:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    return f'2026-{month:02d}-{day:02d}'


def parse_image(http_client: httpx.Client, image_path: Path) -> list[dict]:
    with open(image_path, 'rb') as f:
        data = f.read()

    head = data[:4]
    is_jpeg = head[0] == 0xFF and head[1] == 0xD8
    media_type = 'image/jpeg' if is_jpeg else 'image/png'

    import base64
    b64 = base64.b64encode(data).decode()

    api_key = os.environ.get('ANTHROPIC_AUTH_TOKEN', '')
    base_url = os.environ.get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')

    resp = http_client.post(
        f'{base_url}/v1/messages',
        headers={
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': 'claude-sonnet-4-6',
            'max_tokens': 16384,
            'messages': [{
                'role': 'user',
                'content': [
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': media_type, 'data': b64}},
                    {'type': 'text', 'text': PROMPT},
                ],
            }],
        },
        timeout=300,
    )
    resp.raise_for_status()
    result = resp.json()

    raw_text = result['content'][0].get('text', '') if result.get('content') else ''
    text = re.sub(r'^```(?:json)?\s*', '', raw_text, flags=re.MULTILINE)
    text = re.sub(r'\s*```\s*$', '', text, flags=re.MULTILINE)

    start_idx = text.find('{')
    if start_idx == -1:
        raise ValueError(f'Vision 未返回 JSON: {text[:200]}')

    json_str = fix_inner_quotes(text[start_idx:])
    json_str = trim_to_json_end(json_str)
    json_str = repair_truncated_json(json_str)

    parsed = json.loads(json_str)
    return parsed.get('themes', [])


def main():
    parser = argparse.ArgumentParser(description='从本地图片回填 limitUpReasons')
    parser.add_argument('--dir', default='docs/jiuyan')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent.parent
    img_dir = project_root / args.dir

    if not img_dir.exists():
        print(f'[error] 目录不存在: {img_dir}')
        sys.exit(1)

    # 收集图片（优先用 _sm.jpg 压缩版本）
    images = []
    seen_dates = set()
    # 先扫压缩版
    for f in sorted(img_dir.iterdir()):
        if '_sm.jpg' in f.name:
            orig_name = f.name.replace('_sm.jpg', '.png')
            date = filename_to_date(orig_name)
            if date and date not in seen_dates:
                images.append((date, f))
                seen_dates.add(date)
    # 再扫原版
    for f in sorted(img_dir.iterdir()):
        if f.suffix.lower() in ('.png', '.jpg', '.jpeg') and '_sm' not in f.name and '_small' not in f.name:
            date = filename_to_date(f.name)
            if date and date not in seen_dates:
                images.append((date, f))
                seen_dates.add(date)

    print(f'找到 {len(images)} 张图片')

    # 查已有日期
    existing = set()
    offset = 0
    while True:
        resp = sb.table('limitUpReasons').select('pick_date').range(offset, offset + 999).execute()
        if not resp.data:
            break
        for r in resp.data:
            existing.add(r['pick_date'])
        if len(resp.data) < 1000:
            break
        offset += 1000

    to_process = [(d, p) for d, p in images if d not in existing]
    print(f'需处理: {len(to_process)}（已有 {len(images) - len(to_process)} 跳过）')

    if not to_process:
        print('无需处理')
        return

    if args.dry_run:
        for d, p in to_process:
            print(f'  {d} ← {p.name}')
        return

    http_client = httpx.Client()

    success = 0
    fail = 0

    for i, (date, path) in enumerate(to_process):
        print(f'[{i+1}/{len(to_process)}] {date} ({path.name})...', end=' ', flush=True)

        try:
            themes = parse_image(http_client, path)

            if not themes:
                print('无题材')
                fail += 1
                continue

            for t in themes:
                t['count'] = len(t.get('stocks', []))
            total_stocks = sum(t['count'] for t in themes)

            record = {
                'id': str(uuid.uuid4()),
                'pick_date': date,
                'themes': themes,
                'raw_image_url': None,
                'source': 'local-image-backfill',
                'created_at': int(time.time() * 1000),
            }
            sb.table('limitUpReasons').insert(record).execute()
            print(f'成功: {len(themes)} 题材, {total_stocks} 股票')
            success += 1

            # 间隔 2 秒
            if i < len(to_process) - 1:
                time.sleep(2)

        except Exception as e:
            print(f'失败: {str(e)[:120]}')
            fail += 1
            time.sleep(3)

    print(f'\n完成: 成功 {success}, 失败 {fail}')


if __name__ == '__main__':
    main()
