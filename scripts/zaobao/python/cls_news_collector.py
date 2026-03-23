"""
财联社新闻采集脚本（newsItems_cls 表专用）
执行方式：python scripts/zaobao/python/cls_news_collector.py

采集来源（按写入优先级）：
  1. 热门文章排行榜   /v2/article/hot/list
  2. A股频道深度文章  /v3/depth/home/assembled/1003
  3. 财联社快讯        /nodeapi/telegraphList

时区：所有时间统一存为 UTC 毫秒（BIGINT）
去重：依赖数据库唯一索引（cls_id），首次写入定终身
"""

import os
import sys
import re
import uuid
import time
import hashlib
import requests
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# 加载环境变量（本地开发读 .env.local，CI 读系统环境变量）
project_root = Path(__file__).resolve().parents[3]
env_file = project_root / 'apps' / 'web' / '.env.local'
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()

from supabase import create_client, Client


# ===== 常量 =====
RETENTION_DAYS     = 7    # 保留最近7天数据
DEPTH_WINDOW_HOURS = 3    # A股深度文章时间窗口（小时）
FLASH_WINDOW_HOURS = 4    # 快讯时间窗口（小时）
FLASH_RN           = 50   # 快讯每次取条数
DEPTH_TAKE         = 20   # 深度文章取前N条再过滤

# 通用请求 headers
HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ),
    'Referer': 'https://www.cls.cn/depth?id=1003',
}

# 报告类识别正则（宽匹配，不限前缀）
REPORT_PATTERN = re.compile(r'早报|午报|晚报|周报|周末要闻')

# 提醒类关键词
REMINDER_TITLE_KEYWORDS   = ['投资日历']
REMINDER_SUBJECT_KEYWORDS = ['提醒电报']

# 快讯标题/摘要清洗正则（顺序执行，清洗无效前缀）
FLASH_CLEAN_PATTERNS = [
    re.compile(r'^财联社\d+月\d+日电[，,]\s*'),  # 财联社3月23日电，
    re.compile(r'^据报道[，,]\s*'),
    re.compile(r'^据悉[，,]\s*'),
    re.compile(r'^消息称[，,]\s*'),
    re.compile(r'^【[^】]*】\s*'),               # 【标签】前缀（无独立title时去掉）
]

# 快讯摘要括号内容清洗（有独立title时使用）
FLASH_BRACKET_PATTERN = re.compile(r'【[^】]*】')


# ===== 工具函数 =====

def now_utc_ms() -> int:
    """当前 UTC 毫秒时间戳"""
    return int(time.time() * 1000)


def ctime_to_ms(ctime: int) -> int:
    """财联社 ctime（Unix 秒）→ UTC 毫秒"""
    return ctime * 1000


def cutoff_ms(hours: int) -> int:
    """hours 小时前的 UTC 毫秒（采集时间窗口下限）"""
    return int((time.time() - hours * 3600) * 1000)


def retention_cutoff_ms() -> int:
    """RETENTION_DAYS 天前的 UTC 毫秒（清理用）"""
    return int((time.time() - RETENTION_DAYS * 86400) * 1000)


# ===== 预警 =====

def send_alert(msg: str) -> None:
    """双保险预警：stderr 输出（触发 GitHub Actions 邮件）+ Bark 推送"""
    print(f'[ALERT] {msg}', file=sys.stderr)
    bark_key = os.environ.get('BARK_KEY', '').strip()
    if bark_key:
        try:
            requests.get(
                f'https://api.day.app/{bark_key}/财联社采集预警/{msg}',
                timeout=5
            )
        except Exception:
            pass


# ===== 环境变量检查 =====

def check_env() -> None:
    """启动时检查必要环境变量，缺失则输出明确错误并退出"""
    missing = []

    has_url = any(os.environ.get(k) for k in [
        'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'
    ])
    if not has_url:
        missing.append('SUPABASE_URL')

    has_key = any(os.environ.get(k) for k in [
        'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'
    ])
    if not has_key:
        missing.append('SUPABASE_ANON_KEY')

    if missing:
        print(f'[ERROR] 缺少必要环境变量: {missing}', file=sys.stderr)
        sys.exit(1)


# ===== Supabase 连接 =====

def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
        os.environ.get('SUPABASE_ANON_KEY') or
        os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    )
    return create_client(url, key)


def connect_supabase_with_retry(max_retries: int = 3) -> Client:
    """连接 Supabase，失败自动重试，超过次数则预警退出"""
    for i in range(max_retries):
        try:
            sb = get_supabase_client()
            sb.table('newsItems_cls').select('id').limit(1).execute()
            return sb
        except Exception as e:
            print(f'  [supabase] 连接失败 ({i + 1}/{max_retries}): {e}')
            if i < max_retries - 1:
                time.sleep(5)
    send_alert('Supabase 连接失败，重试3次后仍无法连接')
    sys.exit(1)


# ===== sign 生成 =====

# 财联社固定公共参数（所有带 sign 的接口都包含）
_BASE_PARAMS = {'app': 'CailianpressWeb', 'os': 'web', 'sv': '8.4.6'}


def generate_sign(extra_params: dict | None = None) -> str:
    """
    财联社 sign 生成算法（从 JS bundle 逆向）：
      1. 合并公共参数与业务参数
      2. 按 key 字母升序排列，拼接为 k=v&k2=v2（None 值跳过）
      3. SHA1(串) → 40 字符 hex（KjvB 模块）
      4. MD5(sha1_hex) → 32 字符 hex（aCH8 模块）= 最终 sign
    """
    params = {**_BASE_PARAMS, **(extra_params or {})}
    # None 值跳过，空字符串保留
    sorted_str = '&'.join(f'{k}={v}' for k, v in sorted(params.items()) if v is not None)
    sha1_hex = hashlib.sha1(sorted_str.encode('utf-8')).hexdigest()
    return hashlib.md5(sha1_hex.encode('utf-8')).hexdigest()


def fetch_sign() -> str:
    """生成当前 sign（无业务参数时为静态值）"""
    sign = generate_sign()
    print(f'  [sign] 动态生成: {sign}')
    return sign


def validate_sign(sign: str) -> bool:
    """用 hot/list 接口验证 sign 有效性"""
    try:
        r = requests.get(
            'https://www.cls.cn/v2/article/hot/list',
            headers=HEADERS,
            params={'app': 'CailianpressWeb', 'os': 'web', 'sv': '8.4.6', 'sign': sign},
            timeout=10
        )
        data = r.json()
        valid = data.get('errno', -1) == 0 and bool(data.get('data'))
        if not valid:
            print(f'  [sign] 验证失败: errno={data.get("errno")}, data={bool(data.get("data"))}')
        return valid
    except Exception as e:
        print(f'  [sign] 验证请求失败: {e}')
        return False


# ===== 分类规则 =====

def detect_categories(
    title: str,
    subjects: list,
    level: str,
    base_categories: list
) -> list:
    """
    在 base_categories 基础上，根据规则追加分类标签
    支持多分类，同一条新闻可属于多个分类
    """
    cats = list(base_categories)

    # 报告类（早报/午报/晚报/周报/周末要闻）
    if REPORT_PATTERN.search(title) and '报告' not in cats:
        cats.append('报告')

    # 提醒类：标题含关键词
    if any(k in title for k in REMINDER_TITLE_KEYWORDS) and '提醒' not in cats:
        cats.append('提醒')

    # 提醒类：subjects 含提醒电报
    subject_names = [s.get('subject_name', '') for s in (subjects or [])]
    if any(k in subject_names for k in REMINDER_SUBJECT_KEYWORDS) and '提醒' not in cats:
        cats.append('提醒')

    # 重点（快讯中 level=A/B）
    if level in ('A', 'B') and '快讯' in cats and '重点' not in cats:
        cats.append('重点')

    return cats


# ===== 快讯标题清洗 =====

def clean_flash_title(content: str) -> str:
    """
    从快讯 content 提取标题：
    清洗无效前缀 → 截取前30个中文字符
    返回空字符串表示该条应被跳过
    """
    text = content.strip()
    for pattern in FLASH_CLEAN_PATTERNS:
        text = pattern.sub('', text).strip()

    if not text:
        return ''

    # 截取前30个中文字符（含标点，超出截断）
    chars = []
    zh_count = 0
    for ch in text:
        chars.append(ch)
        if '\u4e00' <= ch <= '\u9fff':
            zh_count += 1
        if zh_count >= 30:
            break

    return ''.join(chars).strip()


# ===== 写入数据库 =====

def upsert_news(sb: Client, items: list) -> tuple:
    """
    写入 newsItems_cls 表
    依赖数据库唯一索引（cls_id）自动去重，重复则捕获 23505 静默跳过
    返回 (inserted, skipped)
    """
    inserted, skipped = 0, 0
    for item in items:
        record = {
            'id':           str(uuid.uuid4()),
            'cls_id':       item.get('cls_id'),
            'title':        item['title'],
            'summary':      item.get('summary', ''),
            'categories':   item.get('categories', []),
            'level':        item.get('level', 'A'),
            'url':          item.get('url', ''),
            'published_at': item['published_at'],
            'created_at':   now_utc_ms(),
        }
        try:
            sb.table('newsItems_cls').insert(record).execute()
            inserted += 1
        except Exception as e:
            err = str(e).lower()
            if 'duplicate' in err or 'unique' in err or '23505' in err:
                skipped += 1
            else:
                print(f'  [db] 写入异常: {e}')
    return inserted, skipped


# ===== 数据清理 =====

def cleanup_old_news(sb: Client) -> None:
    """清理 RETENTION_DAYS 天前的旧数据，失败不阻断主流程"""
    cutoff = retention_cutoff_ms()
    try:
        sb.table('newsItems_cls').delete().lt('published_at', cutoff).execute()
        print(f'  [db] 已清理 {RETENTION_DAYS} 天前旧数据')
    except Exception as e:
        print(f'  [db] 清理失败（不影响采集）: {e}')


# ===== 三个采集来源 =====

def collect_hot() -> list:
    """来源一（最高优先级）：热门文章排行榜"""
    try:
        sign = generate_sign()
        r = requests.get(
            'https://www.cls.cn/v2/article/hot/list',
            headers=HEADERS,
            params={**_BASE_PARAMS, 'sign': sign},
            timeout=10
        )
        articles = r.json().get('data', [])
        items = []
        for art in articles:
            title = str(art.get('title') or '').strip()
            if not title:
                continue
            cls_id = str(art['id'])
            cats = detect_categories(title, [], '', ['热门'])
            items.append({
                'cls_id':       cls_id,
                'title':        title,
                'summary':      str(art.get('brief') or ''),
                'categories':   cats,
                'level':        'A',
                'url':          f'https://www.cls.cn/detail/{cls_id}',
                'published_at': ctime_to_ms(art['ctime']),
            })
        print(f'  [热门] 采集 {len(items)} 条')
        return items
    except Exception as e:
        print(f'  [热门] 采集失败: {e}')
        return []


def collect_depth_ashare() -> list:
    """来源二：A股频道深度文章"""
    try:
        sign = generate_sign()
        r = requests.get(
            'https://www.cls.cn/v3/depth/home/assembled/1003',
            headers=HEADERS,
            params={**_BASE_PARAMS, 'sign': sign},
            timeout=10
        )
        data = r.json()
        if data.get('errno', -1) != 0:
            print(f'  [A股] API 异常: errno={data.get("errno")}')
            return []

        depth_list = (data.get('data') or {}).get('depth_list', [])[:DEPTH_TAKE]
        cutoff = cutoff_ms(DEPTH_WINDOW_HOURS)
        items = []
        for art in depth_list:
            pub_ms = ctime_to_ms(art['ctime'])
            if pub_ms < cutoff:
                continue
            title = str(art.get('title') or '').strip()
            if not title:
                continue
            cls_id = str(art['id'])
            cats = detect_categories(title, [], '', ['A股'])
            items.append({
                'cls_id':       cls_id,
                'title':        title,
                'summary':      str(art.get('brief') or ''),
                'categories':   cats,
                'level':        'A',
                'url':          f'https://www.cls.cn/detail/{cls_id}',
                'published_at': pub_ms,
            })
        print(f'  [A股] 采集 {len(items)} 条（取前 {DEPTH_TAKE} 条，{DEPTH_WINDOW_HOURS}h 窗口）')
        return items
    except Exception as e:
        print(f'  [A股] 采集失败: {e}')
        return []


def collect_flash() -> list:
    """来源三（最低优先级）：财联社快讯（不需要 sign）"""
    try:
        r = requests.get(
            'https://www.cls.cn/nodeapi/telegraphList',
            headers={**HEADERS, 'Referer': 'https://www.cls.cn/telegraph'},
            params={'rn': FLASH_RN, 'app': 'CailianpressWeb', 'os': 'web', 'sv': '8.4.6'},
            timeout=10
        )
        roll_data = r.json().get('data', {}).get('roll_data', [])
        cutoff = cutoff_ms(FLASH_WINDOW_HOURS)
        items = []
        for art in roll_data:
            pub_ms = ctime_to_ms(art['ctime'])
            if pub_ms < cutoff:
                continue

            cls_id   = str(art['id'])
            level    = str(art.get('level') or 'C')
            subjects = art.get('subjects') or []
            content  = str(art.get('content') or '').strip()
            raw_title = str(art.get('title') or '').strip()

            # 标题处理：有 title 直接用，否则从 content 提取
            if raw_title:
                title = raw_title
            else:
                title = clean_flash_title(content)
                if not title:
                    continue  # 清洗后为空则跳过

            cats = detect_categories(title, subjects, level, ['快讯'])

            # 等级过滤：只保留 A/B，报告/提醒类不受限
            if level not in ('A', 'B') and '报告' not in cats and '提醒' not in cats:
                continue

            # 摘要清洗：统一去除【括号】内容和无效前缀
            summary = FLASH_BRACKET_PATTERN.sub('', content)
            for p in FLASH_CLEAN_PATTERNS:
                summary = p.sub('', summary)
            summary = summary.strip()

            items.append({
                'cls_id':       cls_id,
                'title':        title,
                'summary':      summary,
                'categories':   cats,
                'level':        level,
                'url':          str(art.get('shareurl') or ''),
                'published_at': pub_ms,
            })
        print(f'  [快讯] 采集 {len(items)} 条（rn={FLASH_RN}，{FLASH_WINDOW_HOURS}h 窗口）')
        return items
    except Exception as e:
        print(f'  [快讯] 采集失败: {e}')
        return []


# ===== 主流程 =====

def run(mode: str = 'full'):
    mode_label = {'full': '全部来源', 'flash': '仅快讯', 'depth': '热门+A股'}[mode]
    print(f'\n{"=" * 55}')
    print(f'财联社新闻采集（{mode_label}）- {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'{"=" * 55}\n')

    # Step 0: 环境变量检查
    check_env()

    need_sign = mode in ('full', 'depth')

    # Step 1: 生成并验证 sign（快讯模式不需要）
    if need_sign:
        print('[1/5] 生成 sign...')
        sign = fetch_sign()
        if not validate_sign(sign):
            send_alert(f'sign 验证失败，请检查财联社接口是否变更，sign={sign}')
            sys.exit(1)
        print(f'      sign 验证通过\n')
    else:
        print('[1/5] 快讯模式，跳过 sign\n')

    # Step 2: 连接 Supabase
    print('[2/5] 连接 Supabase...')
    sb = connect_supabase_with_retry()
    print('      连接成功\n')

    # Step 3: 按模式采集
    print('[3/5] 采集新闻...')
    hot_items, depth_items, flash_items = [], [], []
    if mode in ('full', 'depth'):
        hot_items   = collect_hot()
        depth_items = collect_depth_ashare()
    if mode in ('full', 'flash'):
        flash_items = collect_flash()
    total_collected = len(hot_items) + len(depth_items) + len(flash_items)
    print(f'\n      合计采集：热门 {len(hot_items)} + A股 {len(depth_items)} + 快讯 {len(flash_items)} = {total_collected} 条\n')

    # Step 4: 写入数据库（优先级：热门 > A股 > 快讯）
    print('[4/5] 写入数据库...')
    total_inserted, total_skipped = 0, 0
    for name, items in [('热门', hot_items), ('A股', depth_items), ('快讯', flash_items)]:
        if not items:
            continue
        ins, skip = upsert_news(sb, items)
        total_inserted += ins
        total_skipped  += skip
        print(f'      {name}：写入 {ins} 条，跳过重复 {skip} 条')

    # Step 5: 清理旧数据
    print('\n[5/5] 清理旧数据...')
    cleanup_old_news(sb)

    print(f'\n{"=" * 55}')
    print(f'采集完成！新增 {total_inserted} 条，跳过重复 {total_skipped} 条')
    print(f'{"=" * 55}\n')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '--mode',
        choices=['full', 'flash', 'depth'],
        default='full',
        help='full=全部来源, flash=仅快讯, depth=热门+A股'
    )
    args = parser.parse_args()
    run(mode=args.mode)
