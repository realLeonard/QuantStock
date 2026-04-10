"""模块6: 行业分布统计（聚合计算，不调 API）"""

from utils import get_stock_industry_batch


def compute_industry_distribution(
    hot_stocks: list,
    limit_up_ladder: list,
    dragon_tiger: list,
) -> list:
    """
    将热门股 + 连板天梯 + 龙虎榜按行业聚合统计
    返回: [{
        industry, hot_count, limit_count, dragon_count, total,
        top_stocks: ["股票A", "股票B🔥"]
    }]
    """
    # 收集所有需要查行业的股票代码
    codes_needing_industry: list[str] = []

    # 热门股（没有行业信息，需要查）
    for s in hot_stocks:
        if s.get('code'):
            codes_needing_industry.append(s['code'])

    # 龙虎榜（没有行业信息，需要查）
    for s in dragon_tiger:
        if s.get('code'):
            codes_needing_industry.append(s['code'])

    # 批量查询行业
    industry_map = {}
    if codes_needing_industry:
        print(f'  [info] 批量查询 {len(set(codes_needing_industry))} 只个股的行业信息...')
        industry_map = get_stock_industry_batch(list(set(codes_needing_industry)))

    # 按行业聚合
    industry_data: dict[str, dict] = {}

    def _ensure(industry: str) -> dict:
        if industry not in industry_data:
            industry_data[industry] = {
                'industry': industry,
                'hot_count': 0,
                'limit_count': 0,
                'dragon_count': 0,
                'total': 0,
                'stocks': [],  # (名称, 来源标记)
            }
        return industry_data[industry]

    # 热门股
    for s in hot_stocks:
        industry = industry_map.get(s.get('code', ''), '未知')
        d = _ensure(industry)
        d['hot_count'] += 1
        d['stocks'].append((s.get('name', ''), 'hot'))

    # 连板天梯（已有行业信息）
    for s in limit_up_ladder:
        industries = s.get('industries', [])
        industry = industries[0] if industries else '未知'
        d = _ensure(industry)
        d['limit_count'] += 1
        d['stocks'].append((s.get('name', ''), 'limit'))

    # 龙虎榜
    for s in dragon_tiger:
        industry = industry_map.get(s.get('code', ''), '未知')
        d = _ensure(industry)
        d['dragon_count'] += 1
        d['stocks'].append((s.get('name', ''), 'dragon'))

    # 计算合计 + 格式化代表个股
    result = []
    for d in industry_data.values():
        d['total'] = d['hot_count'] + d['limit_count'] + d['dragon_count']
        # 代表个股：龙虎榜来源加🔥，去重
        seen = set()
        top_stocks = []
        for name, source in d['stocks']:
            if name and name not in seen:
                seen.add(name)
                display = f'{name}🔥' if source == 'dragon' else name
                top_stocks.append(display)
        d['top_stocks'] = top_stocks[:10]  # 最多展示10只
        del d['stocks']
        result.append(d)

    # 按合计降序
    result.sort(key=lambda x: x['total'], reverse=True)

    return result
