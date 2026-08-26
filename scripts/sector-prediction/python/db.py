"""Supabase 连接工具（复用 daily-review 模式）"""

import os
import time
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
