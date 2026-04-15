/**
 * 将昨日复盘 dailyReview 行 + limitUpReasons 行格式化为 AI 可读的紧凑 Markdown。
 *
 * 定位：给早报 AI 提供"昨日客观盘面"素材，不包含任何 AI 加工结论。
 */

// ===== 类型定义（宽松结构，字段可缺）=====
interface Indice {
  name?: string;
  close?: number | null;
  change_pct?: number | null;
  amount?: number | null;
}
interface MarketOverview {
  indices?: Indice[];
  margin?: { balance?: number | null; change?: number | null };
  volume?: { today?: number | null; avg_5d?: number | null; change_pct?: number | null };
}
interface MarketSentiment {
  up_count?: number;
  down_count?: number;
  limit_up?: number;
  limit_down?: number;
  broken_limit?: number;
  broken_rate?: number;
  strong_stocks?: number;
  weak_stocks?: number;
}
interface LadderStock {
  code: string;
  name: string;
  continuous_limit?: number;
  industries?: string[];
}
interface LimitAnalysis {
  promotion?: { rate?: number; promoted_count?: number; yesterday_count?: number };
  seal_stats?: {
    total_seal_fund?: number;
    avg_seal_fund?: number;
    yizi_count?: number;
    early_seal_count?: number;
    total_count?: number;
  };
  premium_summary?: {
    yesterday_limit_count?: number;
    premium_count?: number;
    premium_rate?: number;
    avg_premium?: number;
  };
}
interface SectorFlowItem {
  sector?: string;
  net_amount?: number;
  change_pct?: number;
  top_stocks?: string[];
}
interface StockFlowItem {
  code?: string;
  name?: string;
  net_amount?: number;
  change_pct?: number;
}
interface ThsHot {
  order?: number;
  name?: string;
  code?: string;
  rate?: number;
  rise_and_fall?: number;
  hot_tag?: string;
}
interface DragonTigerItem {
  code?: string;
  name?: string;
  change_pct?: number;
  buy_amount?: number;
  sell_amount?: number;
  net_amount?: number;
  reason?: string;
}
interface HotMoneyMove {
  nickname?: string;
  tier?: number;
  stock_code?: string;
  stock_name?: string;
  direction?: 'buy' | 'sell';
  amount?: number;
}
interface MarginData {
  trade_date?: string;
  total_balance?: number | null;
  daily_change?: number | null;
  change_5d?: number[];
  consecutive_days?: number;
  balance_percentile_1y?: number | null;
}

export interface DailyReviewRow {
  market_overview?: MarketOverview | null;
  market_sentiment?: MarketSentiment | null;
  limit_up_ladder?: LadderStock[] | null;
  limit_analysis?: LimitAnalysis | null;
  sector_fund_flow?: { inflow?: SectorFlowItem[]; outflow?: SectorFlowItem[] } | null;
  stock_fund_flow?: { inflow?: StockFlowItem[]; outflow?: StockFlowItem[] } | null;
  ths_hot_concepts?: ThsHot[] | null;
  ths_hot_industries?: ThsHot[] | null;
  dragon_tiger?: DragonTigerItem[] | null;
  hot_money_moves?: HotMoneyMove[] | null;
  margin_data?: MarginData | null;
}

interface LimitUpReasonStock {
  board?: string;
  code?: string;
  name?: string;
  time?: string;
  float_mv?: number | null;
  turnover_amt?: number | null;
  keyword?: string;
}
export interface LimitUpReasonsRow {
  themes?: Array<{ name?: string; count?: number; stocks?: LimitUpReasonStock[] }> | null;
}

// ===== 工具函数 =====
const fmt = (v: unknown, digits = 2): string => {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : String(v);
};
const sign = (v: number | null | undefined): string => {
  if (v === null || v === undefined) return '-';
  return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2);
};

// ===== 各块 formatter =====

function fmtIndices(mo: MarketOverview | null | undefined): string {
  const idx = mo?.indices ?? [];
  if (idx.length === 0) return '（无指数数据）';
  const lines = idx.map(i => {
    const pct = typeof i.change_pct === 'number' ? sign(i.change_pct) + '%' : '-';
    const amt = i.amount ? `成交 ${fmt(i.amount, 0)} 亿` : '';
    return `- ${i.name}：${fmt(i.close)} ${pct}${amt ? '｜' + amt : ''}`;
  });
  const vol = mo?.volume;
  if (vol?.today) {
    const chg = typeof vol.change_pct === 'number' ? sign(vol.change_pct) + '%' : '-';
    lines.push(`- 两市成交：${fmt(vol.today, 0)} 亿（5日均量 ${fmt(vol.avg_5d ?? 0, 0)}，${chg}）`);
  }
  return lines.join('\n');
}

function fmtSentiment(ms: MarketSentiment | null | undefined): string {
  if (!ms) return '（无情绪数据）';
  return [
    `- 上涨 ${ms.up_count ?? 0} / 下跌 ${ms.down_count ?? 0}`,
    `- 涨停 ${ms.limit_up ?? 0} / 跌停 ${ms.limit_down ?? 0}`,
    `- 炸板 ${ms.broken_limit ?? 0}（炸板率 ${fmt(ms.broken_rate, 1)}%）`,
    `- 涨超7% ${ms.strong_stocks ?? 0} / 跌超7% ${ms.weak_stocks ?? 0}`,
  ].join('\n');
}

/** 连板天梯 × limitUpReasons 关键词 join */
function fmtLadder(
  ladder: LadderStock[] | null | undefined,
  la: LimitAnalysis | null | undefined,
  lur: LimitUpReasonsRow | null | undefined
): string {
  if (!ladder || ladder.length === 0) return '（无连板数据）';

  // 建 code → { keyword, theme } 映射
  const reasonMap = new Map<string, { keyword: string; theme: string; time: string; float_mv: number | null }>();
  for (const t of lur?.themes ?? []) {
    for (const s of t.stocks ?? []) {
      if (s.code) {
        reasonMap.set(s.code, {
          keyword: s.keyword ?? '',
          theme: t.name ?? '',
          time: s.time ?? '',
          float_mv: s.float_mv ?? null,
        });
      }
    }
  }

  // 按连板数分组
  const groups = new Map<number, LadderStock[]>();
  for (const s of ladder) {
    const lvl = s.continuous_limit ?? 1;
    if (!groups.has(lvl)) groups.set(lvl, []);
    groups.get(lvl)!.push(s);
  }
  const sortedLevels = Array.from(groups.keys()).sort((a, b) => b - a);

  const lines: string[] = [];
  for (const lvl of sortedLevels) {
    const stocks = groups.get(lvl)!;
    if (lvl <= 1) {
      // 首板只输出总数，不展开（太多）
      lines.push(`- 首板：${stocks.length} 只`);
      continue;
    }
    lines.push(`- ${lvl}连板（${stocks.length}只）`);
    for (const s of stocks.slice(0, 10)) {
      const info = reasonMap.get(s.code);
      const parts: string[] = [];
      if (info?.keyword || info?.theme) {
        const kw = info.keyword || info.theme;
        parts.push(kw);
      } else if (s.industries && s.industries.length) {
        parts.push(s.industries.slice(0, 2).join('/'));
      }
      if (info?.time) parts.push(`封${info.time}`);
      if (info?.float_mv) parts.push(`流通${fmt(info.float_mv, 0)}亿`);
      const tail = parts.length ? `｜${parts.join('｜')}` : '';
      lines.push(`  • ${s.name}(${s.code})${tail}`);
    }
    if (stocks.length > 10) lines.push(`  …… 其余 ${stocks.length - 10} 只`);
  }

  // 打板统计
  if (la?.promotion || la?.seal_stats || la?.premium_summary) {
    lines.push('');
    if (la.promotion) {
      lines.push(
        `- 晋级率：${fmt(la.promotion.rate, 1)}%（昨日涨停 ${la.promotion.yesterday_count ?? 0} → 今日继续 ${la.promotion.promoted_count ?? 0}）`
      );
    }
    if (la.seal_stats) {
      const s = la.seal_stats;
      lines.push(
        `- 封单：总 ${fmt(s.total_seal_fund, 1)}亿｜均 ${fmt(s.avg_seal_fund, 2)}亿｜一字板 ${s.yizi_count ?? 0}｜早盘封 ${s.early_seal_count ?? 0}`
      );
    }
    if (la.premium_summary) {
      const p = la.premium_summary;
      lines.push(
        `- 昨日涨停今日溢价率：${fmt(p.premium_rate, 1)}%（均涨幅 +${fmt(p.avg_premium, 2)}%）`
      );
    }
  }

  return lines.join('\n');
}

/** 涨停题材聚合（韭研） */
function fmtThemeAggregation(lur: LimitUpReasonsRow | null | undefined): string {
  const themes = lur?.themes ?? [];
  if (themes.length === 0) return '（无题材聚合）';
  const lines = themes
    .slice(0, 15)
    .map(t => {
      const names = (t.stocks ?? []).slice(0, 5).map(s => s.name).filter(Boolean).join('、');
      return `- ${t.name} ×${t.count ?? t.stocks?.length ?? 0}${names ? `（${names}）` : ''}`;
    });
  return lines.join('\n');
}

function fmtSectorFlow(sf: { inflow?: SectorFlowItem[]; outflow?: SectorFlowItem[] } | null | undefined): string {
  if (!sf) return '（无板块资金数据）';
  const lines: string[] = [];
  if (sf.inflow?.length) {
    lines.push('**流入 TOP10：**');
    sf.inflow.slice(0, 10).forEach((s, i) => {
      const pct = typeof s.change_pct === 'number' ? `${sign(s.change_pct)}%` : '-';
      const top = s.top_stocks?.[0] ? `｜领涨 ${s.top_stocks[0]}` : '';
      lines.push(`${i + 1}. ${s.sector} ${sign(s.net_amount ?? 0)}亿（${pct}）${top}`);
    });
  }
  if (sf.outflow?.length) {
    lines.push('**流出 TOP10：**');
    sf.outflow.slice(0, 10).forEach((s, i) => {
      const pct = typeof s.change_pct === 'number' ? `${sign(s.change_pct)}%` : '-';
      lines.push(`${i + 1}. ${s.sector} ${sign(s.net_amount ?? 0)}亿（${pct}）`);
    });
  }
  return lines.join('\n');
}

function fmtStockFlow(sf: { inflow?: StockFlowItem[]; outflow?: StockFlowItem[] } | null | undefined): string {
  if (!sf) return '（无个股资金数据）';
  const lines: string[] = [];
  if (sf.inflow?.length) {
    lines.push('**流入 TOP10：**');
    sf.inflow.slice(0, 10).forEach((s, i) => {
      const pct = typeof s.change_pct === 'number' ? `${sign(s.change_pct)}%` : '-';
      lines.push(`${i + 1}. ${s.name}(${s.code}) ${sign(s.net_amount ?? 0)}亿（${pct}）`);
    });
  }
  if (sf.outflow?.length) {
    lines.push('**流出 TOP10：**');
    sf.outflow.slice(0, 10).forEach((s, i) => {
      const pct = typeof s.change_pct === 'number' ? `${sign(s.change_pct)}%` : '-';
      lines.push(`${i + 1}. ${s.name}(${s.code}) ${sign(s.net_amount ?? 0)}亿（${pct}）`);
    });
  }
  return lines.join('\n');
}

function fmtThsHot(list: ThsHot[] | null | undefined, label: string): string {
  if (!list || list.length === 0) return `（无${label}数据）`;
  return list
    .slice(0, 10)
    .map((x, i) => {
      const pct = typeof x.rise_and_fall === 'number' ? `${sign(x.rise_and_fall)}%` : '-';
      return `${i + 1}. ${x.name} ${pct}${x.hot_tag ? `｜${x.hot_tag}` : ''}`;
    })
    .join('\n');
}

function fmtDragonTiger(dt: DragonTigerItem[] | null | undefined): string {
  if (!dt || dt.length === 0) return '（无龙虎榜数据）';
  const lines: string[] = [];
  const topBuy = [...dt].sort((a, b) => (b.net_amount ?? 0) - (a.net_amount ?? 0)).slice(0, 5);
  const topSell = [...dt].sort((a, b) => (a.net_amount ?? 0) - (b.net_amount ?? 0)).slice(0, 5);
  lines.push('**净买 TOP5（单位：万元）：**');
  topBuy.forEach((x, i) => {
    const pct = typeof x.change_pct === 'number' ? `${sign(x.change_pct)}%` : '-';
    lines.push(`${i + 1}. ${x.name}(${x.code}) 净${sign(x.net_amount ?? 0)}万 ${pct}｜${x.reason ?? ''}`);
  });
  lines.push('**净卖 TOP5：**');
  topSell.forEach((x, i) => {
    const pct = typeof x.change_pct === 'number' ? `${sign(x.change_pct)}%` : '-';
    lines.push(`${i + 1}. ${x.name}(${x.code}) 净${sign(x.net_amount ?? 0)}万 ${pct}｜${x.reason ?? ''}`);
  });
  return lines.join('\n');
}

function fmtHotMoney(hm: HotMoneyMove[] | null | undefined): string {
  if (!hm || hm.length === 0) return '（无游资动向）';
  return hm
    .slice(0, 15)
    .map(m => {
      const dir = m.direction === 'buy' ? '买入' : '卖出';
      const amt = m.amount ? `${fmt(m.amount, 0)}万` : '-';
      return `- ${m.nickname}（T${m.tier ?? '-'}）${dir} ${m.stock_name}(${m.stock_code}) ${amt}`;
    })
    .join('\n');
}

function fmtMargin(md: MarginData | null | undefined): string {
  if (!md || md.total_balance == null) return '（无两融数据）';
  const pct5 = (md.change_5d ?? []).reduce((a, b) => a + b, 0);
  return [
    `- 融资余额：${fmt(md.total_balance, 0)} 亿（截至 ${md.trade_date ?? '-'}，T-1 披露）`,
    `- 1Y 历史分位：${fmt(md.balance_percentile_1y ?? 0, 1)}%`,
    `- 5日累计变化：${sign(Number(pct5.toFixed(2)))} 亿`,
    `- 连续净增/净减：${md.consecutive_days ?? 0} 日`,
  ].join('\n');
}

// ===== 主入口 =====

/**
 * 生成"昨日客观盘面"数据块（Markdown 格式）
 *
 * @param review - dailyReview 行（仅使用客观字段，不读 ai_analysis/ai_summary）
 * @param limitUp - 韭研涨停简图行（可选，有则与 ladder join 增强关键词）
 */
export function formatReviewForZaobao(
  review: DailyReviewRow,
  limitUp?: LimitUpReasonsRow | null
): string {
  const tradeDate = review.margin_data?.trade_date ?? null;

  const sections: string[] = [];

  sections.push('### 指数与成交');
  sections.push(fmtIndices(review.market_overview));

  sections.push('\n### 市场宽度（涨跌停/炸板）');
  sections.push(fmtSentiment(review.market_sentiment));

  sections.push('\n### 连板天梯 × 涨停逻辑');
  sections.push(fmtLadder(review.limit_up_ladder, review.limit_analysis, limitUp));

  sections.push('\n### 昨日涨停题材聚合（韭研）');
  sections.push(fmtThemeAggregation(limitUp));

  sections.push('\n### 板块资金（双向 TOP10）');
  sections.push(fmtSectorFlow(review.sector_fund_flow));

  sections.push('\n### 个股资金（双向 TOP10）');
  sections.push(fmtStockFlow(review.stock_fund_flow));

  sections.push('\n### 同花顺热门概念 TOP10');
  sections.push(fmtThsHot(review.ths_hot_concepts, '概念'));

  sections.push('\n### 同花顺热门行业 TOP10');
  sections.push(fmtThsHot(review.ths_hot_industries, '行业'));

  sections.push('\n### 龙虎榜');
  sections.push(fmtDragonTiger(review.dragon_tiger));

  sections.push('\n### 游资席位动向');
  sections.push(fmtHotMoney(review.hot_money_moves));

  sections.push('\n### 两融杠杆');
  sections.push(fmtMargin(review.margin_data));

  const header = `## 昨日客观盘面（来源：复盘过程数据${tradeDate ? `，两融截至 ${tradeDate}` : ''}）\n\n> **说明**：以下均为客观统计数据，不含任何 AI 判断结论。请独立推演今日方向。\n`;

  return header + '\n' + sections.join('\n');
}
