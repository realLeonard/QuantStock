"""
marketBreadth 历史数据初始化脚本
使用 baostock 获取全市场 A 股每日涨跌幅，聚合后写入 Supabase

运行方式：
  cd scripts/zaobao/python
  python3 init_market_breadth.py

说明：
- 上涨：pctChg > 0（已包含涨停）
- 下跌：pctChg < 0（已包含跌停）
- 平盘：pctChg == 0
- 涨停：pctChg >= 9.9%（ST 股 5% 涨停会漏，误差 < 1%）
- 跌停：pctChg <= -9.9%（同上）
- 跳过 DB 中已有的交易日，支持断点续跑
"""

import os
import sys
import uuid
import time
import pandas as pd
from pathlib import Path
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parents[3]
env_file = project_root / 'apps' / 'web' / '.env.local'
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()

import baostock as bs
from supabase import create_client, Client


# ===== 配置 =====
START_DATE    = '2026-01-01'   # 回填起始日期（baostock 格式：YYYY-MM-DD）
SLEEP_BETWEEN = 0.02           # 每次请求间隔（秒）
PROGRESS_EVERY = 50            # 每 N 只股票打印一次进度


def get_supabase_client() -> Client:
    url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = (os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or
           os.environ.get('SUPABASE_ANON_KEY') or
           os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
    if not url or not key:
        raise ValueError('缺少 Supabase 环境变量')
    return create_client(url, key)


def get_existing_dates(sb: Client) -> set[str]:
    """获取 DB 中已有记录的交易日集合"""
    result = sb.table('marketBreadth').select('trade_date').execute()
    return {row['trade_date'] for row in (result.data or [])}


def now_utc_ms() -> int:
    return int(time.time() * 1000)


def fetch_all_codes() -> list[str]:
    """从 baostock 获取全市场 A 股代码列表（格式：sh.600519）"""
    rs = bs.query_stock_basic(code_name='')
    rows = []
    while rs.error_code == '0' and rs.next():
        rows.append(rs.get_row_data())
    df = pd.DataFrame(rows, columns=rs.fields)
    # 只保留上市状态（status=1）的 A 股，排除 B 股和已退市
    df = df[df['type'] == '1']      # type=1 为股票
    df = df[df['status'] == '1']    # status=1 为上市
    codes = df['code'].tolist()
    return codes


def collect_hist_data(codes: list[str], start: str, end: str) -> dict[str, dict]:
    """
    遍历所有股票，拉取历史涨跌幅，按交易日聚合涨跌家数
    返回 {trade_date: {rise, fall, flat, limit_up, limit_down}}
    """
    date_stats: dict[str, dict] = {}
    total = len(codes)
    errors = 0

    for i, code in enumerate(codes):
        try:
            rs = bs.query_history_k_data_plus(
                code,
                'date,pctChg',
                start_date=start,
                end_date=end,
                frequency='d',
                adjustflag='3',
            )
            rows = []
            while rs.error_code == '0' and rs.next():
                rows.append(rs.get_row_data())

            if not rows:
                time.sleep(SLEEP_BETWEEN)
                continue

            df = pd.DataFrame(rows, columns=['date', 'pctChg'])
            df['pctChg'] = pd.to_numeric(df['pctChg'], errors='coerce').fillna(0)

            for trade_date, grp in df.groupby('date'):
                if trade_date not in date_stats:
                    date_stats[trade_date] = {
                        'rise': 0, 'fall': 0, 'flat': 0,
                        'limit_up': 0, 'limit_down': 0,
                    }
                s = date_stats[trade_date]
                s['rise']       += int((grp['pctChg'] > 0).sum())
                s['fall']       += int((grp['pctChg'] < 0).sum())
                s['flat']       += int((grp['pctChg'] == 0).sum())
                s['limit_up']   += int((grp['pctChg'] >= 9.9).sum())
                s['limit_down'] += int((grp['pctChg'] <= -9.9).sum())

        except Exception:
            errors += 1

        time.sleep(SLEEP_BETWEEN)

        if (i + 1) % PROGRESS_EVERY == 0 or (i + 1) == total:
            print(
                f'  进度: {i+1}/{total} ({(i+1)/total*100:.1f}%)'
                f'  已有 {len(date_stats)} 个交易日'
                f'  失败 {errors} 只'
            )

    print(f'\n  采集完成，{len(date_stats)} 个交易日，{errors} 只股票失败（通常为停牌/退市）')
    return date_stats


def save_to_db(sb: Client, date_stats: dict[str, dict], skip_dates: set[str]) -> None:
    """将聚合结果写入 marketBreadth 表，跳过已存在的日期"""
    to_write = {d: s for d, s in date_stats.items() if d not in skip_dates}
    if not to_write:
        print('  无新数据需要写入')
        return

    print(f'  共 {len(to_write)} 个交易日待写入...')
    success = 0
    for trade_date in sorted(to_write.keys()):
        s = to_write[trade_date]
        record = {
            'id': str(uuid.uuid4()),
            'trade_date': trade_date,
            'rise':       s['rise'],
            'fall':       s['fall'],
            'flat':       s['flat'],
            'limit_up':   s['limit_up'],
            'limit_down': s['limit_down'],
            'created_at': now_utc_ms(),
        }
        try:
            sb.table('marketBreadth').insert(record).execute()
            print(
                f'  ✓ {trade_date}  '
                f'涨{s["rise"]:4d} 跌{s["fall"]:4d} 平{s["flat"]:3d} '
                f'涨停{s["limit_up"]:3d} 跌停{s["limit_down"]:3d}'
            )
            success += 1
        except Exception as e:
            err = str(e).lower()
            if 'duplicate' in err or '23505' in err:
                print(f'  ○ {trade_date} 已存在，跳过')
            else:
                print(f'  ✗ {trade_date} 写入失败: {e}')

    print(f'\n  写入完成：{success}/{len(to_write)} 条成功')


def main() -> None:
    end_date = __import__('datetime').date.today().strftime('%Y-%m-%d')

    print(f'\n{"="*60}')
    print(f'marketBreadth 历史初始化（基于 baostock）')
    print(f'日期范围：{START_DATE} → {end_date}')
    print(f'{"="*60}\n')

    # 连接 baostock
    print('[1/5] 连接 baostock...')
    lg = bs.login()
    if lg.error_code != '0':
        print(f'  baostock 登录失败: {lg.error_msg}')
        sys.exit(1)
    print(f'  登录成功')

    # 连接 Supabase
    print('\n[2/5] 连接 Supabase...')
    try:
        sb = get_supabase_client()
        existing = get_existing_dates(sb)
        print(f'  连接成功，DB 中已有 {len(existing)} 条记录')
    except Exception as e:
        print(f'  连接失败: {e}')
        bs.logout()
        sys.exit(1)

    # 获取股票列表
    print('\n[3/5] 获取全市场股票列表...')
    codes = fetch_all_codes()
    print(f'  共 {len(codes)} 只股票')

    # 采集历史行情
    print(f'\n[4/5] 拉取历史行情...')
    date_stats = collect_hist_data(codes, START_DATE, end_date)

    # 写入数据库
    print('\n[5/5] 写入数据库...')
    save_to_db(sb, date_stats, existing)

    bs.logout()

    print(f'\n{"="*60}')
    print('初始化完成！')
    print(f'{"="*60}\n')


if __name__ == '__main__':
    main()
