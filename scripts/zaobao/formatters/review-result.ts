/**
 * 回测结果聚合 & 注入早报 prompt 的格式化器
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface StockItem {
  name: string;
  code?: string | null;
  change_pct?: number;
  unmapped?: boolean;
  hit?: boolean;
  error?: string;
}

interface SectorItem {
  text: string;
  matched: string | null;
  change_pct?: number;
  hit?: boolean;
  unmapped?: boolean;
  stocks: StockItem[];
  stock_hit?: number;
  stock_total?: number;
  excess_pct?: number;
  hit_basis?: 'excess' | 'absolute';
}

interface ReviewResult {
  target_date: string;
  hs300_pct: number | null;
  watch: SectorItem[];
  avoid: SectorItem[];
  hit_count: number;
  total_mapped: number;
  hit_rate: string;
  stock_hit_count?: number;
  stock_total?: number;
  stock_hit_rate?: string;
}

const fmtPct = (p?: number) => p === undefined ? '--' : (p >= 0 ? `+${p.toFixed(2)}` : p.toFixed(2));

/**
 * 拼接单个板块行的个股命中明细
 * 格式："    个股：沪电股份 +2.10% ✅ / 华工科技 -0.80% ❌ / 光库科技（无数据）"
 */
function buildStockLine(stocks: StockItem[]): string | null {
  if (!stocks || stocks.length === 0) return null;
  const parts = stocks.map(s => {
    if (s.unmapped) return `${s.name}（${s.error ?? '无数据'}）`;
    const mark = s.hit ? '✅' : '❌';
    return `${s.name} ${fmtPct(s.change_pct)}% ${mark}`;
  });
  return `    个股：${parts.join(' / ')}`;
}

/**
 * 单个板块行（板块涨跌 + 超额 + 个股明细）
 * 板块未匹配时仍然展示个股（个股命中独立于板块）
 */
function buildSectorBlock(item: SectorItem): string[] {
  const lines: string[] = [];
  const matchedNote = item.matched && item.matched !== item.text ? ` [${item.matched}]` : '';
  if (item.unmapped) {
    lines.push(`  ${item.text}${matchedNote}（板块未匹配，跳过板块判定）`);
  } else {
    const mark = item.hit ? '✅' : '❌';
    const excessNote = item.excess_pct !== undefined ? ` (超额 ${fmtPct(item.excess_pct)}%)` : '';
    lines.push(`  ${item.text}${matchedNote} ${fmtPct(item.change_pct)}%${excessNote} ${mark}`);
  }
  const stockLine = buildStockLine(item.stocks);
  if (stockLine) lines.push(stockLine);
  return lines;
}

/**
 * 读取单日回测结果，格式化为"昨日命中回顾"文本块（代码硬注入，AI 不可篡改）
 */
export async function loadYesterdayReviewBlock(sb: SupabaseClient, beforeDate: string): Promise<string | null> {
  const { data } = await sb
    .from('dailyReport')
    .select('report_date, review_result')
    .lt('report_date', beforeDate)
    .eq('report_type', 'trading')
    .not('review_result', 'is', null)
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.review_result) return null;
  const r = data.review_result as ReviewResult;

  const stockSummary = r.stock_hit_rate ?? `${r.stock_hit_count ?? 0}/${r.stock_total ?? 0}`;
  // 判定口径：当任一板块用 excess 判定时，标注"基于超额"，否则按绝对涨幅
  const allItems = [...(r.watch ?? []), ...(r.avoid ?? [])];
  const usesExcess = allItems.some(s => s.hit_basis === 'excess');
  const sectorBasis = usesExcess ? '板块命中(超额≥0.3%)' : '板块命中(绝对≥0.3%)';
  const lines: string[] = [];
  lines.push(
    `【${data.report_date} 回测】沪深300 ${fmtPct(r.hs300_pct ?? undefined)}% | ${sectorBasis} ${r.hit_rate} | 个股命中(绝对≥1%) ${stockSummary}`
  );
  if (r.watch.length > 0) {
    lines.push('关注板块：');
    for (const w of r.watch) lines.push(...buildSectorBlock(w));
  }
  if (r.avoid.length > 0) {
    lines.push('规避板块：');
    for (const a of r.avoid) lines.push(...buildSectorBlock(a));
  }

  return lines.join('\n');
}

/**
 * 读取近 N 日回测结果，聚合为命中率字符串
 * 用于 30秒速读块："近7日 板块命中率 23/35 ≈ 65.7% / 个股命中率 47/100 ≈ 47.0%"
 */
export async function loadRecentHitRate(sb: SupabaseClient, beforeDate: string, days = 7): Promise<string | null> {
  const { data } = await sb
    .from('dailyReport')
    .select('review_result')
    .lt('report_date', beforeDate)
    .eq('report_type', 'trading')
    .not('review_result', 'is', null)
    .order('report_date', { ascending: false })
    .limit(days);

  if (!data || data.length === 0) return null;

  let sectorHit = 0;
  let sectorTotal = 0;
  let stockHit = 0;
  let stockTotal = 0;
  for (const row of data) {
    const r = row.review_result as ReviewResult | null;
    if (!r) continue;
    sectorHit += r.hit_count ?? 0;
    sectorTotal += r.total_mapped ?? 0;
    stockHit += r.stock_hit_count ?? 0;
    stockTotal += r.stock_total ?? 0;
  }

  if (sectorTotal === 0 && stockTotal === 0) return null;

  const sectorPct = sectorTotal > 0 ? `${((sectorHit / sectorTotal) * 100).toFixed(1)}%` : '--';
  const stockPct = stockTotal > 0 ? `${((stockHit / stockTotal) * 100).toFixed(1)}%` : '--';
  return `近${data.length}日 板块命中率 ${sectorHit}/${sectorTotal} ≈ ${sectorPct} / 个股命中率 ${stockHit}/${stockTotal} ≈ ${stockPct}`;
}
