"""Supabase 连接和数据写入工具"""

import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client, Client

# 优先加载项目根目录 apps/web/.env.local
_project_root = Path(__file__).resolve().parents[3]
_env_file = _project_root / 'apps' / 'web' / '.env.local'
if _env_file.exists():
    load_dotenv(_env_file)
else:
    load_dotenv()


def get_supabase_client() -> Client:
    """获取 Supabase 客户端"""
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = (
        os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
        or os.environ.get('SUPABASE_ANON_KEY')
        or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    )
    if not url or not key:
        raise ValueError('缺少 Supabase 环境变量（SUPABASE_URL / SUPABASE_ANON_KEY）')
    return create_client(url, key)


def now_utc_ms() -> int:
    """当前 UTC 毫秒时间戳"""
    return int(time.time() * 1000)


def save_daily_review(sb: Client, report_date: str, data: dict) -> None:
    """
    写入或更新 dailyReview 表
    report_date: "2026-04-10" 格式
    data: 包含各模块数据的字典
    """
    record = {
        'id': str(uuid.uuid4()),
        'report_date': report_date,
        'market_overview': data.get('market_overview'),
        'market_sentiment': data.get('market_sentiment'),
        'hot_stocks': data.get('hot_stocks'),
        'limit_up_ladder': data.get('limit_up_ladder'),
        'dragon_tiger': data.get('dragon_tiger'),
        'industry_distribution': data.get('industry_distribution'),
        'limit_industry_distribution': data.get('limit_industry_distribution'),
        'sector_fund_flow': data.get('sector_fund_flow'),
        'stock_fund_flow': data.get('stock_fund_flow'),
        'ths_hot_stocks': data.get('ths_hot_stocks'),
        'ths_hot_concepts': data.get('ths_hot_concepts'),
        'ths_hot_industries': data.get('ths_hot_industries'),
        'ai_summary': data.get('ai_summary'),
        'limit_analysis': data.get('limit_analysis'),
        'ai_analysis': data.get('ai_analysis'),
        'filtered_news': data.get('filtered_news') or [],
        'hot_money_moves': data.get('hot_money_moves') or [],
        'margin_data': data.get('margin_data'),
        'status': data.get('status', 'success'),
        'created_at': now_utc_ms(),
    }

    # 检查是否已存在当日记录
    existing = (
        sb.table('dailyReview')
        .select('id')
        .eq('report_date', report_date)
        .execute()
    )

    if existing.data:
        # 更新已有记录
        existing_id = existing.data[0]['id']
        del record['id']
        sb.table('dailyReview').update(record).eq('id', existing_id).execute()
        print(f'  [db] 已更新 {report_date} 的复盘记录')
    else:
        # 插入新记录
        sb.table('dailyReview').insert(record).execute()
        print(f'  [db] 已插入 {report_date} 的复盘记录')
