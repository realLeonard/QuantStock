"""
每日早报数据采集入口
执行方式：python scripts/zaobao/python/main.py

功能：
1. 调用 akshare 采集 A 股行情数据
2. 调用 yfinance 采集国际市场数据
3. 调用 feedparser 采集 RSS 财经新闻
4. 全部写入 Supabase rawMarketData 表
"""

import os
import sys
import uuid
import json
import time
from datetime import datetime, timezone, date, time as dt_time
from pathlib import Path
import decimal

# 加载 .env.local 环境变量
from dotenv import load_dotenv

# 优先加载项目根目录下 apps/web/.env.local
# main.py 在 scripts/zaobao/python/，parents[3] = 项目根目录
project_root = Path(__file__).resolve().parents[3]
env_file = project_root / 'apps' / 'web' / '.env.local'
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()

from supabase import create_client, Client
from fetchers import akshare_fetcher, yfinance_fetcher, rss_fetcher, macro_fetcher


def json_safe(obj):
    """递归将 payload 中不可序列化的类型转为字符串"""
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe(i) for i in obj]
    if isinstance(obj, (datetime, date, dt_time)):
        return obj.isoformat()
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, float) and (obj != obj):  # NaN
        return None
    return obj


def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    if not url or not key:
        raise ValueError('缺少 Supabase 环境变量（SUPABASE_URL / SUPABASE_ANON_KEY）')
    return create_client(url, key)


def get_today_date() -> str:
    """返回今日日期字符串（北京时间，格式：YYYY-MM-DD）"""
    # 北京时间 = UTC+8
    now_bj = datetime.now(timezone.utc).astimezone(
        __import__('zoneinfo').ZoneInfo('Asia/Shanghai')
    )
    return now_bj.strftime('%Y-%m-%d')


def save_to_supabase(sb: Client, data_date: str, data_type: str, source: str, payload: dict) -> None:
    """将采集结果写入 rawMarketData 表（同日同源先删后插，保证幂等）"""
    safe_payload = json_safe(payload)

    # 先删除同日同源旧记录，再插入新记录（避免 upsert 需要唯一约束）
    sb.table('rawMarketData').delete().eq('data_date', data_date).eq('source', source).execute()

    record = {
        'id': str(uuid.uuid4()),
        'data_date': data_date,
        'data_type': data_type,
        'source': source,
        'payload': safe_payload,
        'created_at': int(time.time() * 1000),
    }

    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = sb.table('rawMarketData').insert(record).execute()
            print(f'  [DB] 写入成功: {source} ({data_date})')
            return
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2)
            else:
                print(f'  [DB] 写入失败 ({source}): {e}')


def save_market_breadth(sb: Client, data_date: str, breadth: dict) -> None:
    """将涨跌家数写入 marketBreadth 表（幂等：同日存在则跳过）"""
    if not breadth or not any(breadth.values()):
        print('  [marketBreadth] 无有效数据，跳过')
        return
    try:
        # 检查当日是否已有记录
        existing = sb.table('marketBreadth').select('id').eq('trade_date', data_date).execute()
        if existing.data:
            print(f'  [marketBreadth] {data_date} 已存在，跳过')
            return
        record = {
            'id': str(uuid.uuid4()),
            'trade_date': data_date,
            'rise': breadth.get('rise', 0),
            'fall': breadth.get('fall', 0),
            'flat': breadth.get('flat', 0),
            'limit_up': breadth.get('limit_up', 0),
            'limit_down': breadth.get('limit_down', 0),
            'created_at': int(time.time() * 1000),
        }
        sb.table('marketBreadth').insert(record).execute()
        print(f'  [marketBreadth] 写入成功: 涨{breadth.get("rise")} 跌{breadth.get("fall")} 涨停{breadth.get("limit_up")}')

        # 清理1年前的旧数据
        from datetime import date as dt_date
        one_year_ago = (dt_date.today().replace(year=dt_date.today().year - 1)).isoformat()
        sb.table('marketBreadth').delete().lt('trade_date', one_year_ago).execute()
    except Exception as e:
        print(f'  [marketBreadth] 写入失败: {e}')


def run_collection():
    print(f'\n{"="*50}')
    print(f'每日早报数据采集 - {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    print(f'{"="*50}\n')

    # 连接 Supabase
    print('[1/5] 连接 Supabase...')
    try:
        sb = get_supabase_client()
        print('      连接成功')
    except Exception as e:
        print(f'      连接失败: {e}')
        sys.exit(1)

    data_date = get_today_date()
    print(f'      采集日期: {data_date}\n')

    # 采集 A 股数据
    print('[2/5] 采集 A 股数据（akshare）...')
    try:
        a_share_data = akshare_fetcher.fetch_all()
        save_to_supabase(sb, data_date, 'a_share', 'akshare', a_share_data)
        # 写入 marketBreadth 表
        breadth = a_share_data.get('market_breadth', {}).get('structured', {})
        save_market_breadth(sb, data_date, breadth)
    except Exception as e:
        print(f'      A 股数据采集失败: {e}')

    print()

    # 采集国际市场数据
    print('[3/5] 采集国际市场数据（yfinance）...')
    try:
        intl_data = yfinance_fetcher.fetch_all()
        save_to_supabase(sb, data_date, 'intl_market', 'yfinance', intl_data)
    except Exception as e:
        print(f'      国际市场数据采集失败: {e}')

    print()

    # 采集宏观经济 & 债券数据
    print('[4/5] 采集宏观经济 & 债券数据（akshare）...')
    try:
        macro_data = macro_fetcher.fetch_all()
        save_to_supabase(sb, data_date, 'macro', 'akshare_macro', macro_data)
    except Exception as e:
        print(f'      宏观数据采集失败: {e}')

    print()

    # 采集央视新闻联播（保留在每日脚本）
    print('[5/5] 采集央视新闻联播...')
    try:
        cctv_data = rss_fetcher.fetch_cctv_news()
        save_to_supabase(sb, data_date, 'news', 'cctv', cctv_data)
    except Exception as e:
        print(f'      央视新闻采集失败: {e}')

    print(f'\n{"="*50}')
    print('采集完成！数据已写入 Supabase')
    print(f'{"="*50}\n')


if __name__ == '__main__':
    run_collection()
