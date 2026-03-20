"""
财经新闻采集器
数据来源：akshare

主力源（财联社）：
  - 财联社全球财经快讯（高频）
  - 财联社电报（重磅事件，高信噪比）
  - 财联社A股公告精选

辅助源：
  - 东方财富全球快讯
  - 新浪全球快讯
  - 同花顺全球快讯
  - 央视新闻联播（政策权威）
  - 百度财经（聚合面宽）
"""

import akshare as ak
from datetime import datetime, timezone
import zoneinfo
from typing import Any


def get_beijing_date() -> str:
    """返回北京时间今日日期（YYYYMMDD）"""
    bj = datetime.now(timezone.utc).astimezone(zoneinfo.ZoneInfo('Asia/Shanghai'))
    return bj.strftime('%Y%m%d')


# ===== 财联社（主力）=====

def fetch_cls_flash() -> dict[str, Any]:
    """
    财联社全球财经快讯（最新 100 条）
    覆盖全球宏观、A股、港股、美股、大宗商品等实时快讯
    """
    try:
        df = ak.stock_info_global_cls()
        if df is not None and not df.empty:
            items = df.head(100).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '财联社快讯',
                'data': items,
                'count': len(items),
                'description': '财联社全球财经快讯（最新100条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '财联社快讯', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '财联社快讯', 'error': '无数据', 'data': [], 'count': 0}


def fetch_cls_telegraph() -> dict[str, Any]:
    """
    财联社电报（重磅事件专栏）
    经编辑筛选的高影响力事件，信噪比远高于普通快讯
    """
    try:
        df = ak.stock_telegraph_cls()
        if df is not None and not df.empty:
            items = df.head(30).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '财联社电报',
                'data': items,
                'count': len(items),
                'description': '财联社电报重磅事件（最新30条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '财联社电报', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '财联社电报', 'error': '无数据', 'data': [], 'count': 0}


def fetch_cls_stock_notice() -> dict[str, Any]:
    """
    财联社A股公告精选（重大公告提炼）
    覆盖增发、重组、业绩预告、股东变动等重大事项
    """
    try:
        df = ak.stock_notice_report(symbol='全部')
        if df is not None and not df.empty:
            items = df.head(50).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '财联社公告精选',
                'data': items,
                'count': len(items),
                'description': 'A股重大公告精选（最新50条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '财联社公告精选', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '财联社公告精选', 'error': '无数据', 'data': [], 'count': 0}


# ===== 辅助源 =====

def fetch_em_global_news() -> dict[str, Any]:
    """
    东方财富全球财经快讯（最新 100 条）
    与财联社互补，覆盖面更广
    """
    try:
        df = ak.stock_info_global_em()
        if df is not None and not df.empty:
            items = df.head(100).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '东方财富快讯',
                'data': items,
                'count': len(items),
                'description': '东方财富全球财经快讯（最新100条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '东方财富快讯', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '东方财富快讯', 'error': '无数据', 'data': [], 'count': 0}


def fetch_sina_global() -> dict[str, Any]:
    """新浪全球财经快讯（最新 50 条）"""
    try:
        df = ak.stock_info_global_sina()
        if df is not None and not df.empty:
            items = df.head(50).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '新浪全球快讯',
                'data': items,
                'count': len(items),
                'description': '新浪全球财经快讯（最新50条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '新浪全球快讯', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '新浪全球快讯', 'error': '无数据', 'data': [], 'count': 0}


def fetch_ths_flash() -> dict[str, Any]:
    """同花顺全球财经快讯（最新 50 条）"""
    try:
        df = ak.stock_info_global_ths()
        if df is not None and not df.empty:
            items = df.head(50).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '同花顺快讯',
                'data': items,
                'count': len(items),
                'description': '同花顺全球财经快讯（最新50条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '同花顺快讯', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '同花顺快讯', 'error': '无数据', 'data': [], 'count': 0}


def fetch_baidu_finance() -> dict[str, Any]:
    """
    百度财经新闻（聚合多家媒体财经头条）
    覆盖面宽，补充东方财富/财联社未收录的内容
    """
    try:
        df = ak.news_economic_baidu()
        if df is not None and not df.empty:
            items = df.head(50).to_dict(orient='records')
            return {
                'success': True,
                'source_name': '百度财经',
                'data': items,
                'count': len(items),
                'description': '百度财经聚合头条（最新50条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '百度财经', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '百度财经', 'error': '无数据', 'data': [], 'count': 0}


def fetch_cctv_news() -> dict[str, Any]:
    """
    央视新闻联播文字版（今日全文）
    政策权威源，反映官方定调
    """
    try:
        today = get_beijing_date()
        df = ak.news_cctv(date=today)
        if df is not None and not df.empty:
            items = df.to_dict(orient='records')
            return {
                'success': True,
                'source_name': '央视新闻联播',
                'data': items,
                'count': len(items),
                'description': f'央视新闻联播 {today}（{len(items)} 条）',
            }
    except Exception as e:
        return {'success': False, 'source_name': '央视新闻联播', 'error': str(e), 'data': [], 'count': 0}
    return {'success': False, 'source_name': '央视新闻联播', 'error': '无数据', 'data': [], 'count': 0}


def fetch_all() -> dict[str, Any]:
    """执行全部新闻采集，返回汇总结果"""
    print('  [news] 开始采集财经新闻...')

    results = {}

    # 财联社主力
    print('  [news] 采集财联社快讯...')
    results['cls_flash'] = fetch_cls_flash()

    print('  [news] 采集财联社电报（重磅）...')
    results['cls_telegraph'] = fetch_cls_telegraph()

    print('  [news] 采集财联社A股公告精选...')
    results['cls_stock_notice'] = fetch_cls_stock_notice()

    # 辅助源
    print('  [news] 采集东方财富快讯...')
    results['em_global'] = fetch_em_global_news()

    print('  [news] 采集新浪全球快讯...')
    results['sina_global'] = fetch_sina_global()

    print('  [news] 采集同花顺快讯...')
    results['ths_flash'] = fetch_ths_flash()

    print('  [news] 采集百度财经...')
    results['baidu_finance'] = fetch_baidu_finance()

    print('  [news] 采集央视新闻联播...')
    results['cctv'] = fetch_cctv_news()

    total = sum(r.get('count', 0) for r in results.values())
    success = sum(1 for r in results.values() if r.get('success'))
    print(f'  [news] 完成，{success}/{len(results)} 源成功，共 {total} 条新闻')

    return results
