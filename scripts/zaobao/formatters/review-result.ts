/**
 * 回测结果聚合 & 注入早报 prompt 的格式化器
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface ReviewResult {
  target_date: string;
  hs300_pct: number | null;
  watch: Array<{ text: string; matched: string | null; change_pct?: number; hit?: boolean; unmapped?: boolean }>;
  avoid: Array<{ text: string; matched: string | null; change_pct?: number; hit?: boolean; unmapped?: boolean }>;
  hit_count: number;
  total_mapped: number;
  hit_rate: string;
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

  const fmtPct = (p?: number) => p === undefined ? '--' : (p >= 0 ? `+${p.toFixed(2)}` : p.toFixed(2));
  const fmtRow = (item: ReviewResult['watch'][0], expect: 'up' | 'down') => {
    if (item.unmapped) return `  ${item.text}（未匹配到板块指数，跳过）`;
    const mark = item.hit ? '✅' : '❌';
    const matchedNote = item.matched && item.matched !== item.text ? ` [${item.matched}]` : '';
    return `  ${item.text}${matchedNote} ${fmtPct(item.change_pct)}% ${mark}`;
  };

  const lines: string[] = [];
  lines.push(`【${data.report_date} 板块判断回测】沪深300 ${fmtPct(r.hs300_pct)}%  命中 ${r.hit_rate}`);
  if (r.watch.length > 0) {
    lines.push('关注板块：');
    for (const w of r.watch) lines.push(fmtRow(w, 'up'));
  }
  if (r.avoid.length > 0) {
    lines.push('规避板块：');
    for (const a of r.avoid) lines.push(fmtRow(a, 'down'));
  }

  return lines.join('\n');
}

/**
 * 读取近 N 日回测结果，聚合为命中率字符串
 * 用于 30秒速读块："📈 近7日板块命中率 23/35 ≈ 65.7%"
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

  let hit = 0;
  let total = 0;
  for (const row of data) {
    const r = row.review_result as ReviewResult | null;
    if (!r) continue;
    hit += r.hit_count ?? 0;
    total += r.total_mapped ?? 0;
  }

  if (total === 0) return null;
  const pct = ((hit / total) * 100).toFixed(1);
  return `近${data.length}日板块命中率 ${hit}/${total} ≈ ${pct}%`;
}
