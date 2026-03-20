"""
宏观经济 & 债券数据采集器
数据来源：akshare
采集内容：CPI、PPI、PMI、M2、社融、存准率、国债收益率曲线
"""

import akshare as ak
from datetime import datetime, timedelta
from typing import Any


def fetch_cpi() -> dict[str, Any]:
    """CPI 居民消费价格指数（近6月）"""
    try:
        df = ak.macro_china_cpi_monthly()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': 'CPI居民消费价格指数近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_ppi() -> dict[str, Any]:
    """PPI 工业品出厂价格指数（近6月）"""
    try:
        df = ak.macro_china_ppi_monthly()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': 'PPI工业品出厂价格指数近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_pmi_manufacturing() -> dict[str, Any]:
    """制造业 PMI（近6月）"""
    try:
        df = ak.macro_china_pmi()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': '官方制造业PMI近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_pmi_non_manufacturing() -> dict[str, Any]:
    """非制造业 PMI（近6月）"""
    try:
        df = ak.macro_china_pmi_non_man()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': '官方非制造业PMI近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_m2() -> dict[str, Any]:
    """M2 广义货币供应量（近6月）"""
    try:
        df = ak.macro_china_m2_yearly()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': 'M2广义货币供应量近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_social_financing() -> dict[str, Any]:
    """社会融资规模增量（近6月）"""
    try:
        df = ak.macro_china_shrzgm()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(6).to_dict(orient='records'),
                'description': '社会融资规模增量近6月',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_reserve_ratio() -> dict[str, Any]:
    """存款准备金率历次调整记录（最近5次）"""
    try:
        df = ak.macro_china_reserve_requirement_ratio()
        if df is not None and not df.empty:
            return {
                'success': True,
                'data': df.tail(5).to_dict(orient='records'),
                'description': '存款准备金率历次调整',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_bond_yield() -> dict[str, Any]:
    """国债收益率曲线（近30日，中债国债）"""
    try:
        end = datetime.now()
        start = end - timedelta(days=30)
        df = ak.bond_china_yield(
            start_date=start.strftime('%Y%m%d'),
            end_date=end.strftime('%Y%m%d'),
        )
        if df is not None and not df.empty:
            # 只保留中债国债收益率曲线
            if '曲线名称' in df.columns:
                df = df[df['曲线名称'].str.contains('国债收益率', na=False)]
            return {
                'success': True,
                'data': df.tail(10).to_dict(orient='records'),
                'description': '中债国债收益率曲线近30日（1Y/5Y/10Y/30Y）',
            }
    except Exception as e:
        return {'success': False, 'error': str(e), 'data': []}
    return {'success': False, 'error': '无数据', 'data': []}


def fetch_all() -> dict[str, Any]:
    """执行全部宏观 & 债券数据采集，返回汇总结果"""
    print('  [macro] 开始采集宏观经济 & 债券数据...')

    results = {}

    print('  [macro] 采集 CPI...')
    results['cpi'] = fetch_cpi()

    print('  [macro] 采集 PPI...')
    results['ppi'] = fetch_ppi()

    print('  [macro] 采集制造业 PMI...')
    results['pmi_manufacturing'] = fetch_pmi_manufacturing()

    print('  [macro] 采集非制造业 PMI...')
    results['pmi_non_manufacturing'] = fetch_pmi_non_manufacturing()

    print('  [macro] 采集 M2...')
    results['m2'] = fetch_m2()

    print('  [macro] 采集社融...')
    results['social_financing'] = fetch_social_financing()

    print('  [macro] 采集存准率...')
    results['reserve_ratio'] = fetch_reserve_ratio()

    print('  [macro] 采集国债收益率曲线...')
    results['bond_yield'] = fetch_bond_yield()

    success_count = sum(1 for v in results.values() if v.get('success'))
    print(f'  [macro] 完成，{success_count}/{len(results)} 项成功')

    return results
