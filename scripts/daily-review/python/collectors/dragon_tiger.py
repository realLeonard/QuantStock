"""模块5: 龙虎榜明细"""

import akshare as ak

from utils import safe_float


def collect_dragon_tiger(date_str: str) -> list:
    """
    采集模块5: 龙虎榜明细（当日全部上榜个股）
    返回: [{ code, name, change_pct, buy_amount, sell_amount, net_amount, reason }]

    注意: 龙虎榜数据一般在收盘后 1-2 小时才更新，17:00 采集时可能还没出来
    """
    result = []
    date_yyyymmdd = date_str.replace('-', '')

    try:
        df = ak.stock_lhb_detail_em(
            start_date=date_yyyymmdd,
            end_date=date_yyyymmdd,
        )
    except TypeError:
        # akshare 内部 data_json["result"]["pages"] 为 None 时抛出
        # 说明当日龙虎榜数据尚未发布
        print(f'  [info] {date_str} 龙虎榜数据尚未发布（盘后延迟更新）')
        return result
    except Exception as e:
        print(f'  [warn] 获取龙虎榜失败: {e}')
        return result

    if df is None or df.empty:
        print(f'  [warn] {date_str} 无龙虎榜数据')
        return result

    # 实际列名: 代码, 名称, 涨跌幅, 龙虎榜买入额, 龙虎榜卖出额, 龙虎榜净买额, 上榜原因
    # 同一个股票可能多次上榜（不同原因），按股票代码聚合
    stock_map: dict[str, dict] = {}

    for _, row in df.iterrows():
        code = str(row.get('代码', '')).strip()
        if not code:
            continue

        buy = safe_float(row.get('龙虎榜买入额', row.get('买入额', 0)))
        sell = safe_float(row.get('龙虎榜卖出额', row.get('卖出额', 0)))
        reason = str(row.get('上榜原因', row.get('解读', ''))).strip()

        if code in stock_map:
            existing = stock_map[code]
            existing['buy_amount'] += buy
            existing['sell_amount'] += sell
            existing['net_amount'] = existing['buy_amount'] - existing['sell_amount']
            if reason and reason not in existing['reason']:
                existing['reason'] += f'; {reason}'
        else:
            stock_map[code] = {
                'code': code,
                'name': str(row.get('名称', '')).strip(),
                'change_pct': safe_float(row.get('涨跌幅')),
                'buy_amount': buy,
                'sell_amount': sell,
                'net_amount': buy - sell,
                'reason': reason,
            }

    result = list(stock_map.values())

    # 金额单位统一为万元
    # akshare 返回的是元为单位（通常 > 1e6），转为万
    if result and abs(result[0]['buy_amount']) > 1e6:
        for item in result:
            item['buy_amount'] = round(item['buy_amount'] / 1e4, 2)
            item['sell_amount'] = round(item['sell_amount'] / 1e4, 2)
            item['net_amount'] = round(item['net_amount'] / 1e4, 2)
    else:
        for item in result:
            item['buy_amount'] = round(item['buy_amount'], 2)
            item['sell_amount'] = round(item['sell_amount'], 2)
            item['net_amount'] = round(item['net_amount'], 2)

    # 按净额降序
    result.sort(key=lambda x: x['net_amount'], reverse=True)

    return result
