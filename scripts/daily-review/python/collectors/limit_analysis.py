"""模块: 打板分析（溢价率 + 首板晋级率 + 封单数据）"""

from datetime import datetime, timedelta, timezone

import akshare as ak

from utils import safe_float, safe_int, date_to_yyyymmdd

_BJ_TZ = timezone(timedelta(hours=8))


def _get_previous_trade_date(date_str: str) -> str:
    """
    获取 date_str 的上一个交易日（YYYYMMDD 格式）
    降级策略：若交易日历获取失败，取前一自然日（跳过周末）
    """
    try:
        df = ak.tool_trade_date_hist_sina()
        dates = sorted(
            [d.replace('-', '') for d in df['trade_date'].astype(str).tolist()]
        )
        target = date_to_yyyymmdd(date_str)
        # 找到 target 之前的最后一个交易日
        prev = None
        for d in dates:
            if d >= target:
                break
            prev = d
        if prev:
            return prev
    except Exception as e:
        print(f'  [warn] 获取上一交易日失败: {e}')

    # 降级：往前推自然日，跳过周末
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    dt -= timedelta(days=1)
    while dt.weekday() >= 5:
        dt -= timedelta(days=1)
    return dt.strftime('%Y%m%d')


def collect_limit_analysis(date_str: str) -> dict:
    """
    采集打板分析数据：
    1. 打板溢价率（昨日涨停股今日表现）
    2. 首板晋级率（昨日涨停 → 今日继续涨停的比例）
    3. 封单数据（封板资金、封板时间、炸板次数）

    返回结构:
    {
      'premium_summary': { ... },
      'premium_details': [ ... ],
      'promotion': { ... },
      'seal_stats': { ... },
      'seal_details': [ ... ],
    }
    """
    date_yyyymmdd = date_to_yyyymmdd(date_str)
    prev_date = _get_previous_trade_date(date_str)

    result = {
        'premium_summary': None,
        'premium_details': [],
        'promotion': None,
        'seal_stats': None,
        'seal_details': [],
    }

    # ========== A. 打板溢价率 ==========
    # stock_zt_pool_previous_em: 昨日涨停股今日表现
    try:
        df_prev = ak.stock_zt_pool_previous_em(date=date_yyyymmdd)
        if df_prev is not None and not df_prev.empty:
            # 排除 ST
            if '名称' in df_prev.columns:
                df_prev = df_prev[
                    ~df_prev['名称'].str.contains('ST', case=False, na=False)
                ]

            total = len(df_prev)
            premium_details = []

            for _, row in df_prev.iterrows():
                change_pct = safe_float(row.get('涨跌幅'))
                # 连板数字段
                continuous = safe_int(row.get('连板数', 0))
                premium_details.append({
                    'code': str(row.get('代码', '')).strip(),
                    'name': str(row.get('名称', '')).strip(),
                    'change_pct': round(change_pct, 2),
                    'continuous_limit': continuous,
                })

            # 计算溢价统计
            changes = [d['change_pct'] for d in premium_details]
            premium_count = sum(1 for c in changes if c > 0)
            avg_premium = (
                round(sum(c for c in changes if c > 0) / premium_count, 2)
                if premium_count > 0
                else 0.0
            )

            result['premium_summary'] = {
                'yesterday_limit_count': total,
                'premium_count': premium_count,
                'premium_rate': round(premium_count / total * 100, 1) if total > 0 else 0,
                'avg_premium': avg_premium,
            }
            # 按涨跌幅降序
            result['premium_details'] = sorted(
                premium_details, key=lambda x: x['change_pct'], reverse=True
            )
        else:
            print('  [warn] 昨日涨停池数据为空')
    except Exception as e:
        print(f'  [warn] 获取打板溢价率失败: {e}')

    # ========== B. 首板晋级率 ==========
    # 今日涨停池 ∩ 昨日涨停池
    try:
        df_today = ak.stock_zt_pool_em(date=date_yyyymmdd)
        df_yesterday = ak.stock_zt_pool_em(date=prev_date)

        today_codes = set()
        yesterday_codes = set()

        if df_today is not None and not df_today.empty:
            if '名称' in df_today.columns:
                df_today = df_today[
                    ~df_today['名称'].str.contains('ST', case=False, na=False)
                ]
            today_codes = set(df_today['代码'].astype(str).str.strip())

        if df_yesterday is not None and not df_yesterday.empty:
            if '名称' in df_yesterday.columns:
                df_yesterday = df_yesterday[
                    ~df_yesterday['名称'].str.contains('ST', case=False, na=False)
                ]
            yesterday_codes = set(df_yesterday['代码'].astype(str).str.strip())

        if yesterday_codes:
            promoted = today_codes & yesterday_codes
            # 获取晋级股名称
            promoted_stocks = []
            if promoted and df_today is not None:
                name_map = dict(
                    zip(
                        df_today['代码'].astype(str).str.strip(),
                        df_today['名称'].astype(str).str.strip(),
                    )
                )
                promoted_stocks = [
                    name_map.get(code, code) for code in promoted
                ]

            result['promotion'] = {
                'rate': round(len(promoted) / len(yesterday_codes) * 100, 1),
                'promoted_count': len(promoted),
                'yesterday_count': len(yesterday_codes),
                'promoted_stocks': sorted(promoted_stocks),
            }
        else:
            result['promotion'] = {
                'rate': 0,
                'promoted_count': 0,
                'yesterday_count': 0,
                'promoted_stocks': [],
            }
    except Exception as e:
        print(f'  [warn] 获取首板晋级率失败: {e}')

    # ========== C. 封单数据 ==========
    # 从今日涨停池提取封单相关字段
    try:
        df_zt = ak.stock_zt_pool_em(date=date_yyyymmdd)
        if df_zt is not None and not df_zt.empty:
            # 排除 ST
            if '名称' in df_zt.columns:
                df_zt = df_zt[
                    ~df_zt['名称'].str.contains('ST', case=False, na=False)
                ]

            seal_details = []
            total_seal_fund = 0.0
            yizi_count = 0
            early_seal_count = 0

            for _, row in df_zt.iterrows():
                # 封板资金（单位：元 → 亿）
                seal_fund_raw = safe_float(row.get('封板资金', 0))
                seal_fund = round(seal_fund_raw / 1e8, 2)  # 转亿
                total_seal_fund += seal_fund

                first_time = str(row.get('首次封板时间', '')).strip()
                last_time = str(row.get('最后封板时间', '')).strip()
                broken = safe_int(row.get('炸板次数', 0))

                seal_details.append({
                    'code': str(row.get('代码', '')).strip(),
                    'name': str(row.get('名称', '')).strip(),
                    'seal_fund': seal_fund,
                    'first_seal_time': first_time,
                    'last_seal_time': last_time,
                    'broken_count': broken,
                })

                # 判断一字板：首次封板时间 <= 09:25
                if first_time and first_time <= '09:25':
                    yizi_count += 1

                # 判断早盘封板：首次封板时间 <= 10:00
                if first_time and first_time <= '10:00':
                    early_seal_count += 1

            count = len(seal_details)
            result['seal_stats'] = {
                'total_seal_fund': round(total_seal_fund, 1),
                'avg_seal_fund': round(total_seal_fund / count, 2) if count > 0 else 0,
                'yizi_count': yizi_count,
                'early_seal_count': early_seal_count,
                'total_count': count,
            }
            # 按封板资金降序
            result['seal_details'] = sorted(
                seal_details, key=lambda x: x['seal_fund'], reverse=True
            )
        else:
            print('  [warn] 今日涨停池数据为空，无法获取封单数据')
    except Exception as e:
        print(f'  [warn] 获取封单数据失败: {e}')

    return result
