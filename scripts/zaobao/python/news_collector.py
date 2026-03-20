"""
每小时新闻采集脚本（方案二：持续写入 newsItems 表）
执行方式：python scripts/zaobao/python/news_collector.py

采集逻辑：
- 采集各新闻源最新条目
- 过滤：只保留最近 3 小时内发布的新闻（overlap 兜底）
- 去重写入 Supabase newsItems 表
- 清理 2 天前的旧数据
- 时区：所有时间统一存为 UTC 毫秒（BIGINT）
"""

import os
import sys
import uuid
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv

project_root = Path(__file__).resolve().parents[3]
env_file = project_root / 'apps' / 'web' / '.env.local'
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()

import akshare as ak
from supabase import create_client, Client


# ===== 常量 =====
OVERLAP_HOURS = 3        # 每次采集时往前看3小时（兜底上一次漏跑的情况）
RETENTION_DAYS = 2       # 只保留最近2天的新闻


def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or \
          os.environ.get('SUPABASE_ANON_KEY') or \
          os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not key:
        raise ValueError('缺少 Supabase 环境变量')
    return create_client(url, key)


def now_utc_ms() -> int:
    """当前 UTC 毫秒时间戳"""
    return int(time.time() * 1000)


def parse_beijing_time(s: str) -> int:
    """
    解析北京时间字符串（无时区标识）→ UTC 毫秒
    支持格式：'2026-03-20 10:23:00' 或 '2026-03-20 10:23'
    """
    s = s.strip()
    try:
        fmt = '%Y-%m-%d %H:%M:%S' if len(s) > 16 else '%Y-%m-%d %H:%M'
        naive = datetime.strptime(s, fmt)
        # 显式指定 +08:00，不依赖本地时区
        bj_aware = naive.replace(tzinfo=timezone(timedelta(hours=8)))
        return int(bj_aware.timestamp() * 1000)
    except Exception:
        return now_utc_ms()


def cutoff_utc_ms() -> int:
    """返回 OVERLAP_HOURS 小时前的 UTC 毫秒（过滤时间窗口下限）"""
    return int((time.time() - OVERLAP_HOURS * 3600) * 1000)


def retention_cutoff_ms() -> int:
    """返回 RETENTION_DAYS 天前的 UTC 毫秒（清理上限）"""
    return int((time.time() - RETENTION_DAYS * 86400) * 1000)


# ===== 各新闻源采集 =====

def collect_cls_focus() -> list[dict]:
    """财联社重点新闻（symbol='重点'）"""
    try:
        df = ak.stock_info_global_cls(symbol='重点')
        if df is None or df.empty:
            return []
        items = []
        for _, row in df.iterrows():
            # 时间字段名可能为 '时间' 或 'time'
            time_val = row.get('时间') or row.get('time') or ''
            pub_ms = parse_beijing_time(str(time_val)) if time_val else now_utc_ms()
            title = str(row.get('内容') or row.get('content') or row.get('title') or '')
            if not title:
                continue
            items.append({
                'source': 'cls_focus',
                'title': title,
                'published_at': pub_ms,
                'url': str(row.get('链接') or row.get('url') or ''),
            })
        return items
    except Exception as e:
        print(f'  [collect] 财联社重点 采集失败: {e}')
        return []


def collect_cls_flash() -> list[dict]:
    """财联社全量快讯（symbol='全部'），取最新200条"""
    try:
        df = ak.stock_info_global_cls(symbol='全部')
        if df is None or df.empty:
            return []
        items = []
        for _, row in df.head(200).iterrows():
            time_val = row.get('时间') or row.get('time') or ''
            pub_ms = parse_beijing_time(str(time_val)) if time_val else now_utc_ms()
            title = str(row.get('内容') or row.get('content') or row.get('title') or '')
            if not title:
                continue
            items.append({
                'source': 'cls_flash',
                'title': title,
                'published_at': pub_ms,
                'url': str(row.get('链接') or row.get('url') or ''),
            })
        return items
    except Exception as e:
        print(f'  [collect] 财联社快讯 采集失败: {e}')
        return []


def collect_cls_notice() -> list[dict]:
    """财联社A股公告精选"""
    try:
        df = ak.stock_notice_report(symbol='全部')
        if df is None or df.empty:
            return []
        items = []
        for _, row in df.head(50).iterrows():
            time_val = row.get('时间') or row.get('date') or row.get('公告日期') or ''
            pub_ms = parse_beijing_time(str(time_val)) if time_val else now_utc_ms()
            title = str(row.get('内容') or row.get('title') or row.get('公告内容') or '')
            if not title:
                continue
            items.append({
                'source': 'cls_notice',
                'title': title,
                'published_at': pub_ms,
                'url': str(row.get('链接') or row.get('url') or ''),
            })
        return items
    except Exception as e:
        print(f'  [collect] 财联社公告 采集失败: {e}')
        return []


def collect_em_flash() -> list[dict]:
    """东方财富全球快讯"""
    try:
        df = ak.stock_info_global_em()
        if df is None or df.empty:
            return []
        items = []
        for _, row in df.head(100).iterrows():
            time_val = row.get('时间') or row.get('time') or ''
            pub_ms = parse_beijing_time(str(time_val)) if time_val else now_utc_ms()
            title = str(row.get('内容') or row.get('content') or row.get('title') or '')
            if not title:
                continue
            items.append({
                'source': 'em_flash',
                'title': title,
                'published_at': pub_ms,
                'url': str(row.get('链接') or row.get('url') or ''),
            })
        return items
    except Exception as e:
        print(f'  [collect] 东方财富快讯 采集失败: {e}')
        return []


def collect_ths_flash() -> list[dict]:
    """同花顺全球快讯"""
    try:
        df = ak.stock_info_global_ths()
        if df is None or df.empty:
            return []
        items = []
        for _, row in df.head(50).iterrows():
            time_val = row.get('时间') or row.get('time') or ''
            pub_ms = parse_beijing_time(str(time_val)) if time_val else now_utc_ms()
            title = str(row.get('内容') or row.get('content') or row.get('title') or '')
            if not title:
                continue
            items.append({
                'source': 'ths_flash',
                'title': title,
                'published_at': pub_ms,
                'url': str(row.get('链接') or row.get('url') or ''),
            })
        return items
    except Exception as e:
        print(f'  [collect] 同花顺快讯 采集失败: {e}')
        return []


# ===== 时间过滤 =====

def filter_by_window(items: list[dict]) -> list[dict]:
    """只保留最近 OVERLAP_HOURS 小时内的新闻"""
    cutoff = cutoff_utc_ms()
    filtered = [i for i in items if i['published_at'] >= cutoff]
    return filtered


# ===== 写入 Supabase =====

def upsert_news(sb: Client, items: list[dict]) -> tuple[int, int]:
    """
    去重写入 newsItems 表
    返回 (写入成功数, 重复跳过数)
    """
    if not items:
        return 0, 0

    inserted = 0
    skipped = 0

    for item in items:
        record = {
            'id': str(uuid.uuid4()),
            'title': item['title'],
            'source': item['source'],
            'published_at': item['published_at'],
            'url': item.get('url', ''),
            'created_at': now_utc_ms(),
        }
        try:
            sb.table('newsItems').insert(record).execute()
            inserted += 1
        except Exception as e:
            err_str = str(e).lower()
            if 'duplicate' in err_str or 'unique' in err_str or '23505' in err_str:
                skipped += 1
            else:
                print(f'  [db] 写入异常: {e}')

    return inserted, skipped


def cleanup_old_news(sb: Client) -> None:
    """清理 RETENTION_DAYS 天前的旧新闻"""
    cutoff = retention_cutoff_ms()
    try:
        sb.table('newsItems').delete().lt('published_at', cutoff).execute()
        print(f'  [db] 清理 {RETENTION_DAYS} 天前旧数据完成')
    except Exception as e:
        print(f'  [db] 清理失败: {e}')


# ===== 主流程 =====

def run():
    print(f'\n{"="*50}')
    print(f'新闻采集 - {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'采集窗口：最近 {OVERLAP_HOURS} 小时')
    print(f'{"="*50}\n')

    print('[1/3] 连接 Supabase...')
    try:
        sb = get_supabase_client()
        print('      连接成功')
    except Exception as e:
        print(f'      连接失败: {e}')
        sys.exit(1)

    print('\n[2/3] 采集各新闻源...')
    all_items: list[dict] = []

    sources = [
        ('财联社重点', collect_cls_focus),
        ('财联社快讯', collect_cls_flash),
        ('财联社公告', collect_cls_notice),
        ('东方财富',   collect_em_flash),
        ('同花顺',     collect_ths_flash),
    ]

    for name, fn in sources:
        print(f'  采集 {name}...')
        items = fn()
        filtered = filter_by_window(items)
        print(f'    采集 {len(items)} 条，过滤后 {len(filtered)} 条在时间窗口内')
        all_items.extend(filtered)

    print(f'\n  合计 {len(all_items)} 条待写入')

    print('\n[3/3] 写入数据库...')
    inserted, skipped = upsert_news(sb, all_items)
    print(f'  写入 {inserted} 条，重复跳过 {skipped} 条')

    # 每次运行顺带清理旧数据
    cleanup_old_news(sb)

    print(f'\n{"="*50}')
    print(f'采集完成！新增 {inserted} 条新闻')
    print(f'{"="*50}\n')


if __name__ == '__main__':
    run()
