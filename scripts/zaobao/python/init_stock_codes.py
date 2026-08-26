"""
stockCodes 表初始化脚本
拉取全市场 A 股股票代码、名称，并按代码前缀推断交易所与板块后写入 Supabase

运行方式：
  cd scripts/zaobao/python
  python init_stock_codes.py

板块判断规则（按代码前缀）：
  SH 上交所
    60xxxx → 主板
    688xxx → 科创板
  SZ 深交所
    00xxxx / 001xxx / 002xxx / 003xxx → 主板（含原中小板，2021年已合并）
    300xxx / 301xxx                   → 创业板
  BJ 北交所
    8xxxxx / 4xxxxx / 9xxxxx          → 北交所
"""

import os
import sys
import time
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


def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = (os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
           os.environ.get('SUPABASE_ANON_KEY') or
           os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
    if not url or not key:
        raise ValueError('缺少 Supabase 环境变量')
    return create_client(url, key)


def infer_exchange_board(code: str) -> tuple[str, str]:
    """根据股票代码推断交易所和板块"""
    if code.startswith('60'):
        return 'SH', '主板'
    if code.startswith('688'):
        return 'SH', '科创板'
    if code.startswith('300') or code.startswith('301'):
        return 'SZ', '创业板'
    if code.startswith('00') or code.startswith('001') or code.startswith('002') or code.startswith('003'):
        return 'SZ', '主板'
    if code.startswith('8') or code.startswith('4') or code.startswith('9'):
        return 'BJ', '北交所'
    # 兜底（极少数边缘代码）
    return 'SZ', '主板'


def fetch_stock_list() -> list[dict]:
    """从 akshare 获取全量 A 股列表，返回含代码、名称、交易所、板块的列表"""
    print('  拉取股票列表...')
    df = ak.stock_info_a_code_name()
    # 列名：code / name
    records = []
    now_ms = int(time.time() * 1000)
    for _, row in df.iterrows():
        code = str(row['code']).zfill(6)
        name = str(row['name']).strip()
        exchange, board = infer_exchange_board(code)
        records.append({
            'code': code,
            'name': name,
            'exchange': exchange,
            'board': board,
            'created_at': now_ms,
        })
    return records


def save_to_db(sb: Client, records: list[dict]) -> None:
    """批量 upsert 写入 stockCodes 表"""
    total = len(records)
    print(f'  共 {total} 只股票，开始写入（upsert）...')

    BATCH = 500  # 每批写入数量
    success = 0
    for i in range(0, total, BATCH):
        batch = records[i:i + BATCH]
        try:
            sb.table('stockCodes').upsert(batch, on_conflict='code').execute()
            success += len(batch)
            print(f'  进度: {min(i + BATCH, total)}/{total}')
        except Exception as e:
            print(f'  ✗ 第 {i//BATCH + 1} 批写入失败: {e}')

    print(f'\n  写入完成：{success}/{total} 条成功')


def main() -> None:
    print('\n' + '=' * 55)
    print('stockCodes 初始化')
    print('=' * 55 + '\n')

    print('[1/3] 连接 Supabase...')
    try:
        sb = get_supabase_client()
        existing = sb.table('stockCodes').select('code', count='exact').execute()
        print(f'  连接成功，DB 中已有 {existing.count} 条记录')
    except Exception as e:
        print(f'  连接失败: {e}')
        sys.exit(1)

    print('\n[2/3] 获取股票列表...')
    try:
        records = fetch_stock_list()
        # 按交易所统计
        sh = sum(1 for r in records if r['exchange'] == 'SH')
        sz = sum(1 for r in records if r['exchange'] == 'SZ')
        bj = sum(1 for r in records if r['exchange'] == 'BJ')
        print(f'  共 {len(records)} 只：SH {sh} / SZ {sz} / BJ {bj}')
        # 按板块统计
        boards: dict[str, int] = {}
        for r in records:
            boards[r['board']] = boards.get(r['board'], 0) + 1
        for b, cnt in sorted(boards.items()):
            print(f'    {b}: {cnt} 只')
    except Exception as e:
        print(f'  获取失败: {e}')
        sys.exit(1)

    print('\n[3/3] 写入数据库...')
    save_to_db(sb, records)

    print('\n' + '=' * 55)
    print('初始化完成！')
    print('=' * 55 + '\n')


if __name__ == '__main__':
    main()
