"""模块: 资讯预筛（v2 新增，3 路径打分）

从 newsItems_cls 抽取对盘面有影响的新闻，按时段分段，输出候选给 AI 做二次精选。

时间窗：前一日 15:00 BJ ~ 今日生成时刻
时段标记：
  - pre_market  : 今日 09:15 之前（含昨日盘后）
  - intraday    : 今日 09:15 ~ 15:00
  - post_market : 今日 15:00 之后

三路径打分（同时命中多路径优先级最高）：
  1. 关键词路径     — 预埋政策 / 产业 / 主题 / 风险等关键词词典
  2. 早报路径       — 与今日早报 content/summary 产生文本关联
  3. 市场锚点路径   — 反查当日涨停/连板/行业/资金流/龙虎榜/热度榜，匹配命中
去重：标题归一化 md5 合并同事件转发
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

_BJ_TZ = timezone(timedelta(hours=8))

# =============================================================
#  一、关键词词典（白名单 / 黑名单 / 标题强信号）
#  —— 维护思路：覆盖政策、宏观、产业、主题、公司行为、业绩、风险
#     权重 1~3；命中越多分越高；与市场锚点、早报互为补充
# =============================================================

POSITIVE_KEYWORDS: dict[str, int] = {
    # ---------- 政策 / 宏观（权重 3，最高）----------
    '政策': 3, '国务院': 3, '国常会': 3, '中央': 3, '顶层设计': 3,
    '两会': 3, '政治局': 3, '人民日报': 3, '新华社': 2,
    '央行': 3, '证监会': 3, '财政部': 3, '发改委': 3, '工信部': 3,
    '商务部': 2, '国资委': 2, '银保监': 2, '外汇局': 2,
    '降准': 3, '降息': 3, '加息': 3, '利率': 2, 'LPR': 3, 'MLF': 2,
    '逆回购': 2, '公开市场': 2, '流动性': 2,
    '财政刺激': 3, '财政支持': 2, '刺激': 2, '补贴': 3, '税收': 2,
    '减税': 2, '退税': 2, '专项债': 2, '特别国债': 3, '地方债': 2,
    '出口管制': 3, '关税': 3, '反倾销': 2, '贸易摩擦': 2, '制裁': 3,
    '禁令': 2, '白名单': 2, '黑名单': 2,
    '国产替代': 2, '自主可控': 2, '卡脖子': 2, '供应链安全': 2,
    '十四五': 1, '十五五': 2, '规划': 1, '纲要': 1, '方案': 1,
    'PMI': 2, 'CPI': 2, 'PPI': 2, 'GDP': 2, '社融': 2, '信贷': 2,

    # ---------- AI / 算力 / 半导体（权重 2）----------
    'AI': 2, '人工智能': 2, '大模型': 2, 'AGI': 2, 'GPT': 2,
    'DeepSeek': 2, 'ChatGPT': 2, '豆包': 2, 'Kimi': 1, 'Claude': 2,
    'Sora': 2, 'OpenAI': 2, 'Anthropic': 2, '英伟达': 2, 'NVIDIA': 2,
    '算力': 2, '数据中心': 2, 'IDC': 2, '液冷': 2, '服务器': 1,
    '光模块': 2, 'CPO': 2, 'OIO': 2, '硅光': 2, '800G': 2, '1.6T': 2,
    'HBM': 2, '存储芯片': 2, 'DRAM': 1, 'NAND': 1,
    '半导体': 2, '芯片': 2, '晶圆': 2, '光刻': 2, 'EDA': 2,
    '先进封装': 2, '第三代半导体': 2, '碳化硅': 2, '氮化镓': 2,
    '设备国产化': 2, '成熟制程': 1, '算法': 1,
    '数据要素': 2, '数据交易': 2, '数据资产': 2, '东数西算': 2,

    # ---------- 机器人 / 新能源 / 低空（权重 2）----------
    '机器人': 2, '人形机器人': 2, 'Optimus': 2, '特斯拉机器人': 2,
    '灵巧手': 2, '谐波减速器': 2, 'RV减速器': 2, '伺服电机': 2,
    '丝杠': 1, '六维力传感器': 2, '具身智能': 2,
    '固态电池': 2, '半固态': 2, '钠电池': 1, '钙钛矿': 2,
    '超充': 2, '换电': 1, 'HJT': 1, 'TOPCon': 1, 'BC电池': 1,
    '核聚变': 2, '可控核聚变': 2, 'BEST': 2,
    '低空经济': 2, 'eVTOL': 2, '飞行汽车': 2, 'UAM': 2, '无人机': 1,
    '商业航天': 2, '卫星互联网': 2, '星链': 2, '可回收火箭': 2,
    '氢能': 1, '绿氢': 1, '绿电': 1,

    # ---------- 消费电子 / 苹果链 / 华为链（权重 2）----------
    '华为': 2, '鸿蒙': 2, 'HarmonyOS': 2, '问界': 2, '智界': 2,
    '鸿蒙智行': 2, '昇腾': 2, '麒麟': 1, '星闪': 2, '盘古': 2,
    '苹果': 2, 'iPhone': 1, 'Apple': 1, 'MR': 2, '苹果链': 2,
    'Vision': 1, 'Meta': 1, 'XR': 2, 'AR眼镜': 2, 'AI眼镜': 2,
    '消费电子': 2, '折叠屏': 1, 'AI手机': 2, 'AIPC': 2, 'AI PC': 2,

    # ---------- 军工 / 周期（权重 2）----------
    '军工': 2, '国防': 1, '航天': 2, '航空': 1, '大飞机': 2, 'C919': 2,
    '导弹': 1, '航母': 1, '战斗机': 1,
    '有色': 1, '黄金': 2, '白银': 1, '铜': 1, '锂': 1, '稀土': 2,
    '小金属': 1, '钨': 1, '钼': 1,
    '煤炭': 1, '油气': 1, '油价': 2, '石油': 1, 'OPEC': 2,

    # ---------- 医药 / 消费（权重 2）----------
    '医药': 1, '创新药': 2, 'BD': 2, '出海': 2, 'License-out': 2,
    'GLP-1': 2, '减肥药': 2, '司美格鲁肽': 2, 'CXO': 2, 'ADC': 2,
    '基因编辑': 2, '基因治疗': 2, 'CGT': 2, '集采': -1, '医保谈判': 1,
    '白酒': 1, '茅台': 1, '新消费': 2, '谷子经济': 2, 'IP': 1,
    '免税': 1, '旅游': 1, '消费复苏': 1,

    # ---------- 产业催化 / 公司重大（权重 2）----------
    '订单': 2, '大单': 2, '中标': 2, '招标': 2, '签约': 2, '合作': 1,
    '战略合作': 2, '量产': 2, '交付': 2, '出货': 1, '放量': 2,
    '投产': 2, '开工': 2, '封顶': 1, '立项': 2, '获批': 2, '获证': 2,
    '注册证': 2, 'FDA': 2, 'NMPA': 2,
    '技术突破': 2, '首台': 2, '首批': 2, '首条': 2, '首次': 2,
    '发布会': 1, '新品': 1, '上市': 1, '商用': 2, '量产爬坡': 2,
    '并购': 2, '收购': 2, '重组': 2, '借壳': 3, '资产注入': 2,
    '分拆': 2, '分拆上市': 2, '增持': 2, '举牌': 3,
    '停牌': 1, '复牌': 2, '回购': 2, '注销': 2, '股权激励': 1,
    '定增': 1, '配股': 0, '可转债': 0,
    '分红': 1, '高送转': 2, '特别分红': 2, '现金分红': 1,

    # ---------- 业绩（权重 1~2）----------
    '业绩预增': 2, '业绩预告': 2, '业绩翻倍': 3, '业绩大增': 2,
    '扭亏': 2, '扭亏为盈': 2, '超预期': 2, '好于预期': 2,
    '营收': 1, '净利润': 1, '同比增长': 1, '毛利率': 1, '净利率': 1,
    '季报': 1, '年报': 1, '三季报': 1, '一季报': 1, '中报': 1,

    # ---------- 游资 / 机构信号（权重 2）----------
    '龙虎榜': 2, '机构席位': 2, '机构净买': 2, '机构买入': 2,
    '游资': 1, '知名游资': 2, '北上资金': 1, '外资': 1, '南下资金': 1,
    '社保': 1, '养老金': 1, '险资': 2, '汇金': 3, '国家队': 3,
    '中央汇金': 3, 'ETF': 1, '宽基ETF': 2,

    # ---------- 主题补充（权重 2）----------
    '脑机接口': 2, 'BCI': 2, '区块链': 1, '稳定币': 2, '数字货币': 2,
    '元宇宙': 1, '虚拟电厂': 2, '特高压': 1, '智能电网': 1,
    '智算': 2, 'AI应用': 2, 'AI智能体': 2, 'Agent': 2,
    '合成生物': 2, '生物制造': 2,
    '黑神话': 1, '游戏': 1, '影视': 1,
    '一带一路': 2, '出海': 2, '海外订单': 2,
}

NEGATIVE_KEYWORDS: dict[str, int] = {
    # 减持 / 质押
    '减持计划': -3, '拟减持': -3, '清仓式减持': -4, '大股东减持': -3,
    '股东减持': -2, '高管减持': -2, '股东质押': -2, '补充质押': -1,
    # 监管 / 问询
    '问询函': -1, '监管函': -1, '警示函': -2, '关注函': -1,
    '处罚': -2, '罚款': -2, '行政处罚': -2,
    # 诉讼 / 立案 / 调查（立案本身是重大事件，不降权）
    '股东诉讼': -2, '诉讼': -1, '涉嫌违规': -2, '违规': -2,
    # 业绩
    '业绩预减': -1, '业绩下滑': -1, '业绩变脸': -3, '巨亏': -2,
    '计提': -1, '商誉减值': -2, '存货减值': -1,
    # 其他
    '高管变动': -1, '辞职': -1, '离职': -1, '基金持仓': -1,
    '流拍': -2, '退市风险': -3, '*ST': -2, 'ST': -1,
    '债务违约': -3, '逾期': -2, '暴雷': -3,
}

TITLE_STRONG_MARKERS = [
    '重磅', '突发', '独家', '重大', '紧急', '首次', '首度', '创纪录',
    '历史新高', '历史新低', '刷新纪录', '涨停', '跌停', '封死',
    '大涨', '暴涨', '狂飙', '飙升', '大跌', '暴跌',
]


# =============================================================
#  二、市场锚点（反向抽取）
# =============================================================

def build_market_anchors(data: dict) -> dict:
    """
    从当日采集数据中抽取市场锚点，用于反向匹配新闻。

    阈值（用户定稿）：
      - 连板天梯：board_count ≥ 2 → stocks
      - 涨停行业分布：limit_up_count ≥ 3 → industries
      - 板块资金流：流入 Top10 板块
      - 个股资金流：净流入 Top10 股票
      - 龙虎榜：机构净买 Top5 股票
      - 热度榜：热门股 / 热门概念 / 热门行业 Top10

    返回：
      {
        'stocks': { 'name+code' → weight },
        'industries': { 'name' → weight },
        'concepts': { 'name' → weight },
      }
    """
    stocks: dict[str, int] = {}
    industries: dict[str, int] = {}
    concepts: dict[str, int] = {}

    def _bump(d: dict[str, int], key: str, w: int) -> None:
        if not key:
            return
        key = str(key).strip()
        if not key:
            return
        d[key] = max(d.get(key, 0), w)

    # ---- 1. 连板天梯 ≥ 2 板 ----
    for item in (data.get('limit_up_ladder') or []):
        board = int(item.get('board_count') or item.get('boards') or 0)
        if board < 2:
            continue
        name = item.get('name') or item.get('stock_name') or ''
        code = item.get('code') or item.get('stock_code') or ''
        if name:
            _bump(stocks, name, min(3 + board, 7))  # 板数越高权重越高，封顶 7
        if code:
            _bump(stocks, code, min(3 + board, 7))

    # ---- 2. 涨跌停行业分布 ≥ 3 家涨停 ----
    for item in (data.get('limit_industry_distribution') or []):
        up_cnt = int(item.get('limit_up') or item.get('up_count') or item.get('count') or 0)
        if up_cnt < 3:
            continue
        name = item.get('industry') or item.get('name') or ''
        if name:
            _bump(industries, name, min(4 + up_cnt // 2, 7))

    # ---- 3. 板块资金流 Top10 ----
    sff = data.get('sector_fund_flow') or {}
    for item in (sff.get('inflow') or [])[:10]:
        name = item.get('name') or item.get('sector') or item.get('industry') or ''
        if name:
            _bump(industries, name, 4)

    # ---- 4. 个股资金流 Top10 ----
    pff = data.get('stock_fund_flow') or {}
    for item in (pff.get('inflow') or [])[:10]:
        name = item.get('name') or item.get('stock_name') or ''
        code = item.get('code') or item.get('stock_code') or ''
        if name:
            _bump(stocks, name, 4)
        if code:
            _bump(stocks, code, 4)

    # ---- 5. 龙虎榜机构净买 Top5 ----
    dt_list = data.get('dragon_tiger') or []
    # 按机构净买额排序（兼容多种字段名）
    def _inst_net_buy(x: dict) -> float:
        for k in ('inst_net_buy', 'institution_net', '机构净买', 'net_amount'):
            if k in x and x[k] is not None:
                try:
                    return float(x[k])
                except Exception:
                    pass
        return 0.0
    dt_sorted = sorted(dt_list, key=_inst_net_buy, reverse=True)[:5]
    for item in dt_sorted:
        name = item.get('name') or item.get('stock_name') or ''
        code = item.get('code') or item.get('stock_code') or ''
        if name:
            _bump(stocks, name, 4)
        if code:
            _bump(stocks, code, 4)

    # ---- 6. 同花顺热度榜（个股 / 概念 / 行业）Top10 ----
    for item in (data.get('ths_hot_stocks') or [])[:10]:
        name = item.get('name') or item.get('stock_name') or ''
        code = item.get('code') or item.get('stock_code') or ''
        if name:
            _bump(stocks, name, 3)
        if code:
            _bump(stocks, code, 3)
    for item in (data.get('ths_hot_concepts') or [])[:10]:
        name = item.get('name') or item.get('concept') or ''
        if name:
            _bump(concepts, name, 3)
    for item in (data.get('ths_hot_industries') or [])[:10]:
        name = item.get('name') or item.get('industry') or ''
        if name:
            _bump(industries, name, 3)

    return {'stocks': stocks, 'industries': industries, 'concepts': concepts}


# =============================================================
#  三、早报锚点（expectation match）
# =============================================================

def fetch_daily_report_anchors(sb: Any, date_str: str) -> dict:
    """
    读取今日 dailyReport（trading 类型），返回 content+summary 原文供子串检索。
    不做结构化抽取，留给 _score_news 做 substring 匹配。
    """
    result = {'text': '', 'summary': ''}
    try:
        resp = (
            sb.table('dailyReport')
            .select('content,summary,report_date,report_type')
            .eq('report_date', date_str)
            .eq('report_type', 'trading')
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if rows:
            result['text'] = rows[0].get('content') or ''
            result['summary'] = rows[0].get('summary') or ''
    except Exception as e:
        print(f'  [warn] 读取 dailyReport 失败: {e}')
    return result


# =============================================================
#  四、工具
# =============================================================

def _dedup_key(title: str) -> str:
    """标题去重：去掉括号 / 标点 / 数字后 hash。"""
    cleaned = re.sub(
        r'[（）()【】\[\]《》""""\'\'、，。！？：；,.!?:;\s\d%一二三四五六七八九十]+',
        '',
        title,
    )
    return hashlib.md5(cleaned.encode('utf-8')).hexdigest()


def _classify_segment(published_at_ms: int, date_str: str) -> str:
    """按北京时间区分盘前 / 盘中 / 盘后。"""
    dt = datetime.fromtimestamp(published_at_ms / 1000, tz=_BJ_TZ)
    today = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=_BJ_TZ)
    market_open = today.replace(hour=9, minute=15)
    market_close = today.replace(hour=15, minute=0)
    if dt < market_open:
        return 'pre_market'
    if dt < market_close:
        return 'intraday'
    return 'post_market'


def _score_news(
    row: dict,
    anchors: dict,
    report: dict,
) -> tuple[int, list[str], list[str], bool]:
    """
    3 路径打分。
    返回 (score, keyword_hits, anchored_from, matched_daily_report)
    """
    title = (row.get('title') or '').strip()
    summary = (row.get('summary') or '').strip()
    level = (row.get('level') or 'C').upper()
    blob = f'{title} {summary}'

    score = 0
    # ---- 基础：等级 ----
    if level == 'A':
        score += 5
    elif level == 'B':
        score += 2

    # ---- 路径1：关键词 ----
    keyword_hits: list[str] = []
    for kw, w in POSITIVE_KEYWORDS.items():
        if kw in blob:
            score += w
            keyword_hits.append(kw)
    for kw, w in NEGATIVE_KEYWORDS.items():
        if kw in blob:
            score += w  # w 本身是负值
            keyword_hits.append(kw)
    for marker in TITLE_STRONG_MARKERS:
        if marker in title:
            score += 3
            keyword_hits.append(marker)

    # ---- 路径2：市场锚点（反查）----
    anchored_from: list[str] = []
    for name, w in anchors.get('stocks', {}).items():
        if len(name) >= 2 and name in blob:
            score += w
            anchored_from.append(f'股票:{name}')
    for name, w in anchors.get('industries', {}).items():
        if len(name) >= 2 and name in blob:
            score += w
            anchored_from.append(f'行业:{name}')
    for name, w in anchors.get('concepts', {}).items():
        if len(name) >= 2 and name in blob:
            score += w
            anchored_from.append(f'概念:{name}')

    # ---- 路径3：早报匹配 ----
    matched_daily_report = False
    report_text = (report.get('text') or '') + ' ' + (report.get('summary') or '')
    if report_text.strip() and len(title) >= 4:
        # 取标题里的中文片段做子串匹配（避免单字误中）
        segs = re.findall(r'[\u4e00-\u9fa5A-Za-z0-9]{2,}', title)
        for seg in segs:
            if len(seg) >= 2 and seg in report_text:
                matched_daily_report = True
                break
        if matched_daily_report:
            score += 4  # 早报命中 +4

    # ---- 多路径加成：命中 2+ 路径再加 3 ----
    paths_hit = (
        (1 if keyword_hits else 0)
        + (1 if anchored_from else 0)
        + (1 if matched_daily_report else 0)
    )
    if paths_hit >= 2:
        score += 3

    # 去重保留顺序、限条数
    keyword_hits = list(dict.fromkeys(keyword_hits))[:6]
    anchored_from = list(dict.fromkeys(anchored_from))[:6]

    return score, keyword_hits, anchored_from, matched_daily_report


# =============================================================
#  五、主入口
# =============================================================

def filter_important_news(
    sb: Any,
    date_str: str,
    anchors: dict | None = None,
    report: dict | None = None,
    limit: int = 50,
) -> list[dict]:
    """
    筛选重要资讯候选给 AI 精选。

    Args:
      sb: Supabase Client
      date_str: 'YYYY-MM-DD'（北京时间日期）
      anchors: build_market_anchors(data) 的结果；None 时自动视为空
      report: fetch_daily_report_anchors(sb, date_str) 的结果；None 时自动视为空
      limit: 最多返回条数

    Returns:
      [{
         cls_id, title, summary, level, url,
         segment, score, published_at, published_bj,
         keyword_hits, anchored_from, matched_daily_report, paths_hit
      }]
    """
    anchors = anchors or {'stocks': {}, 'industries': {}, 'concepts': {}}
    report = report or {'text': '', 'summary': ''}

    # 时间窗
    today_bj = datetime.strptime(date_str, '%Y-%m-%d').replace(tzinfo=_BJ_TZ)
    start_bj = (today_bj - timedelta(days=1)).replace(
        hour=15, minute=0, second=0, microsecond=0
    )
    end_bj = datetime.now(_BJ_TZ)
    if end_bj.date() < today_bj.date():
        end_bj = today_bj.replace(hour=23, minute=59, second=59)

    start_ms = int(start_bj.timestamp() * 1000)
    end_ms = int(end_bj.timestamp() * 1000)

    try:
        resp = (
            sb.table('newsItems_cls')
            .select('cls_id,title,summary,categories,level,url,published_at')
            .gte('published_at', start_ms)
            .lte('published_at', end_ms)
            .order('published_at', desc=True)
            .limit(1000)
            .execute()
        )
        rows = resp.data or []
    except Exception as e:
        print(f'  [warn] 查询 newsItems_cls 失败: {e}')
        return []

    if not rows:
        return []

    # 打分 + 去重
    seen: dict[str, dict] = {}
    for row in rows:
        title = (row.get('title') or '').strip()
        if not title or len(title) < 4:
            continue
        level = (row.get('level') or 'C').upper()

        score, kw_hits, anc_from, rep_match = _score_news(row, anchors, report)

        # level C 且无任何加分 → 丢弃
        if score <= 0 and level not in ('A', 'B'):
            continue

        key = _dedup_key(title)
        prev = seen.get(key)
        if prev and score <= prev['_score']:
            continue

        pub_ms = int(row.get('published_at') or 0)
        segment = _classify_segment(pub_ms, date_str) if pub_ms else 'intraday'
        pub_bj = (
            datetime.fromtimestamp(pub_ms / 1000, tz=_BJ_TZ).strftime('%Y-%m-%d %H:%M')
            if pub_ms
            else ''
        )
        paths_hit = (
            (1 if kw_hits else 0)
            + (1 if anc_from else 0)
            + (1 if rep_match else 0)
        )

        seen[key] = {
            '_score': score,
            'cls_id': row.get('cls_id'),
            'title': title,
            'summary': (row.get('summary') or '')[:200],
            'level': level,
            'url': row.get('url') or '',
            'published_at': pub_ms,
            'published_bj': pub_bj,
            'segment': segment,
            'keyword_hits': kw_hits,
            'anchored_from': anc_from,
            'matched_daily_report': rep_match,
            'paths_hit': paths_hit,
        }

    # 按 (路径数, 分数, 发布时间) 三维排序
    items = sorted(
        seen.values(),
        key=lambda x: (-x['paths_hit'], -x['_score'], -x['published_at']),
    )
    items = items[:limit]
    for item in items:
        score = item.pop('_score', 0)
        item['score'] = score

    return items
