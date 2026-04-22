"""limitUpReasons 历史回填脚本

用法：python3 backfill-limit-up.py [--from 2026-02-13] [--to 2026-04-13] [--dry-run]

逐日调用 jiuyan-image-fetch.ts 拉取涨停简图并写入 DB。
幂等：已存在的日期自动跳过。周末自动跳过。
"""

import argparse
import json
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

# 加载环境变量
from dotenv import load_dotenv
env_path = Path(__file__).resolve().parent.parent.parent / 'apps' / 'web' / '.env.local'
load_dotenv(env_path)

import os
from supabase import create_client

url = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '')
key = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
if not url or not key:
    print('[error] 缺少 Supabase 环境变量')
    sys.exit(1)

sb = create_client(url, key)

SCRIPT_DIR = Path(__file__).resolve().parent
FETCH_SCRIPT = SCRIPT_DIR / 'jiuyan-image-fetch.ts'

# 2026 年 A 股休市日（春节、清明、劳动节等）
HOLIDAYS_2026 = {
    # 春节 2/14-2/20（调休 2/14 周六、2/15 周日上班但仍休市到 2/22）
    '2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17',
    '2026-02-18', '2026-02-19', '2026-02-20',
    # 清明 4/4-4/6
    '2026-04-04', '2026-04-05', '2026-04-06',
}


def is_non_trading(date_str: str) -> bool:
    d = datetime.strptime(date_str, '%Y-%m-%d')
    return d.weekday() >= 5 or date_str in HOLIDAYS_2026


def generate_dates(from_date: str, to_date: str) -> list[str]:
    dates = []
    cur = datetime.strptime(from_date, '%Y-%m-%d')
    end = datetime.strptime(to_date, '%Y-%m-%d')
    while cur <= end:
        ds = cur.strftime('%Y-%m-%d')
        if not is_non_trading(ds):
            dates.append(ds)
        cur += timedelta(days=1)
    return dates


def main():
    parser = argparse.ArgumentParser(description='limitUpReasons 历史回填')
    parser.add_argument('--from', dest='from_date', default='2026-02-13')
    parser.add_argument('--to', dest='to_date', default='2026-04-13')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    print(f'limitUpReasons 历史回填')
    print(f'范围: {args.from_date} ~ {args.to_date}')
    if args.dry_run:
        print('(dry-run 模式)')
    print()

    # 查已有日期
    existing_dates = set()
    offset = 0
    while True:
        resp = sb.table('limitUpReasons').select('pick_date').range(offset, offset + 999).execute()
        if not resp.data:
            break
        for r in resp.data:
            existing_dates.add(r['pick_date'])
        if len(resp.data) < 1000:
            break
        offset += 1000

    print(f'DB 已有 {len(existing_dates)} 天数据')

    # 生成日期列表
    all_dates = generate_dates(args.from_date, args.to_date)
    dates = [d for d in all_dates if d not in existing_dates]

    print(f'需回填: {len(dates)} 天'
          f'（跳过 {len(all_dates) - len(dates)} 天：周末+已有）\n')

    if not dates:
        print('无需回填')
        return

    if args.dry_run:
        for i, d in enumerate(dates):
            print(f'  [{i+1}/{len(dates)}] {d} (dry-run)')
        return

    success = 0
    fail = 0
    skip = 0
    consecutive_fails = 0

    for i, date in enumerate(dates):
        print(f'[{i+1}/{len(dates)}] {date}...', end=' ', flush=True)

        try:
            proc = subprocess.run(
                ['npx', '--yes', 'tsx', str(FETCH_SCRIPT), date],
                cwd=str(SCRIPT_DIR),
                capture_output=True,
                text=True,
                timeout=300,
                env={**os.environ},
            )

            if proc.returncode != 0:
                stderr = proc.stderr.strip()
                # API 返回 errCode=0 但无图片 → 非交易日，不算真正失败
                if 'errCode=0' in stderr:
                    print('无涨停简图（非交易日/假期），跳过')
                    skip += 1
                    consecutive_fails = 0
                    time.sleep(1)
                    continue
                print(f'脚本失败: {stderr[:150]}')
                fail += 1
                consecutive_fails += 1
                if consecutive_fails >= 3:
                    print('\n连续失败 3 次，停止。请检查 JIUYAN_SESSION。')
                    break
                time.sleep(5)
                continue

            data = json.loads(proc.stdout.strip())
            themes = data.get('themes', [])

            if not themes:
                print('无题材（非交易日），跳过')
                skip += 1
                consecutive_fails = 0
                time.sleep(1)
                continue

            # 写入 DB
            record = {
                'id': str(uuid.uuid4()),
                'pick_date': date,
                'themes': themes,
                'raw_image_url': data.get('raw_image_url'),
                'source': 'jiuyan-image-backfill',
                'created_at': int(time.time() * 1000),
            }
            sb.table('limitUpReasons').insert(record).execute()
            print(f'成功: {data["theme_count"]} 题材, {data["stock_count"]} 股票')
            success += 1
            consecutive_fails = 0

            # 间隔 3 秒
            if i < len(dates) - 1:
                time.sleep(3)

        except subprocess.TimeoutExpired:
            print('超时(300s)')
            fail += 1
            consecutive_fails += 1
            if consecutive_fails >= 3:
                print('\n连续失败 3 次，停止。')
                break
            time.sleep(5)
        except json.JSONDecodeError as e:
            print(f'JSON 解析失败: {e}')
            fail += 1
            consecutive_fails += 1
            time.sleep(5)
        except Exception as e:
            print(f'异常: {str(e)[:100]}')
            fail += 1
            consecutive_fails += 1
            time.sleep(5)

    print(f'\n回填完成: 成功 {success}, 失败 {fail}, 跳过(非交易日) {skip}')


if __name__ == '__main__':
    main()
