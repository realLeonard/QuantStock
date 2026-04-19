"""资金流采集：stock_sector_fund_flow_rank() → sector_daily"""

import math
import uuid

import akshare as ak
from supabase import Client

from db import now_utc_ms


def _safe_float(val, default=0.0) -> float:
    try:
        if val is None:
            return default
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (ValueError, TypeError):
        return default


def collect_fund_flow(sb: Client, today: str) -> dict:
    """
    采集当日概念板块资金流，按板块名匹配写入 sector_daily。

    参数:
      today: 当前交易日 YYYY-MM-DD

    返回: {total: int, matched: int, unmatched_names: [str]}
    """
    print('[3/4] 采集资金流...')
    now = now_utc_ms()

    df = ak.stock_sector_fund_flow_rank(indicator='今日', sector_type='概念资金流')
    if df is None or df.empty:
        print('  [error] stock_sector_fund_flow_rank() 返回为空')
        return {'total': 0, 'matched': 0, 'unmatched_names': []}

    print(f'  获取到 {len(df)} 条资金流数据')

    # 识别列名（东财接口列名可能有变动，做容错）
    col_map = _detect_columns(df)
    if not col_map.get('name'):
        print('  [error] 无法识别板块名称列')
        print(f'  可用列: {list(df.columns)}')
        return {'total': len(df), 'matched': 0, 'unmatched_names': []}

    # 查询 sector_daily 中当日已有记录
    existing = (
        sb.table('sector_daily')
        .select('id,sector_name')
        .eq('trade_date', today)
        .execute()
    )
    existing_map = {r['sector_name']: r['id'] for r in existing.data}

    matched = 0
    unmatched_names = []

    for _, row in df.iterrows():
        name = str(row.get(col_map['name'], '')).strip()
        if not name:
            continue

        fund_data = {
            'main_net_inflow': _safe_float(row.get(col_map.get('main_net_inflow', ''), None)),
            'main_net_inflow_pct': _safe_float(row.get(col_map.get('main_net_inflow_pct', ''), None)),
            'super_large_net': _safe_float(row.get(col_map.get('super_large_net', ''), None)),
            'large_net': _safe_float(row.get(col_map.get('large_net', ''), None)),
            'medium_net': _safe_float(row.get(col_map.get('medium_net', ''), None)),
            'small_net': _safe_float(row.get(col_map.get('small_net', ''), None)),
            'fund_leading_stock': str(row.get(col_map.get('leading_stock', ''), '')).strip() or None,
        }

        if name in existing_map:
            # 当日 K 线记录已存在，更新资金流字段
            sb.table('sector_daily').update(fund_data).eq('id', existing_map[name]).execute()
            matched += 1
        else:
            # 当日无 K 线记录（可能是新板块或 K 线采集失败），创建新记录
            record = {
                'id': str(uuid.uuid4()),
                'sector_name': name,
                'trade_date': today,
                **fund_data,
                'created_at': now,
            }
            try:
                sb.table('sector_daily').insert(record).execute()
                matched += 1
            except Exception as e:
                # 可能唯一约束冲突（并发场景），忽略
                print(f'    [warn] 插入 {name} 资金流失败: {e}')
                unmatched_names.append(name)

    # 不在 existing_map 也没被 insert 的，属于完全无法匹配
    print(f'  资金流匹配完成: 匹配 {matched}/{len(df)}')
    if unmatched_names[:10]:
        print(f'  未匹配（前10）: {", ".join(unmatched_names[:10])}')

    return {'total': len(df), 'matched': matched, 'unmatched_names': unmatched_names}


def _detect_columns(df) -> dict:
    """
    自动识别资金流 DataFrame 的列名。
    东财接口列名可能有变动，通过关键字匹配。
    """
    columns = list(df.columns)
    col_map = {}

    for col in columns:
        col_lower = str(col).strip()
        if col_lower in ('名称', '板块名称'):
            col_map['name'] = col
        elif '主力净流入-净额' in col_lower or col_lower == '主力净流入-净额':
            col_map['main_net_inflow'] = col
        elif '主力净流入-净占比' in col_lower or col_lower == '主力净流入-净占比':
            col_map['main_net_inflow_pct'] = col
        elif '超大单净流入-净额' in col_lower or col_lower == '超大单净流入-净额':
            col_map['super_large_net'] = col
        elif '大单净流入-净额' in col_lower or col_lower == '大单净流入-净额':
            col_map['large_net'] = col
        elif '中单净流入-净额' in col_lower or col_lower == '中单净流入-净额':
            col_map['medium_net'] = col
        elif '小单净流入-净额' in col_lower or col_lower == '小单净流入-净额':
            col_map['small_net'] = col
        elif col_lower in ('领涨股票', '领涨股'):
            col_map['leading_stock'] = col

    return col_map
