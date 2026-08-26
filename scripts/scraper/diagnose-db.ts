import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);

async function main() {
  // 拉取所有主题
  const { data: themes, error: te } = await db
    .from('themeConcept')
    .select('id, name, overview, updated_at')
    .order('updated_at', { ascending: false });
  if (te) throw new Error('查询主题失败: ' + te.message);

  // 拉取各主题股票数量
  const { data: stockCounts, error: se } = await db
    .from('themeStocks')
    .select('theme_id');
  if (se) throw new Error('查询股票失败: ' + se.message);

  // 按 theme_id 汇总
  const countMap = new Map<string, number>();
  for (const row of stockCounts ?? []) {
    countMap.set(row.theme_id, (countMap.get(row.theme_id) ?? 0) + 1);
  }

  const total = themes?.length ?? 0;

  // 0 股票的主题
  const zeroStock = (themes ?? []).filter(t => (countMap.get(t.id) ?? 0) === 0);

  // 无描述的主题（overview 为空、null、纯空格）
  const noOverview = (themes ?? []).filter(t => !t.overview?.trim());

  // 又 0 股票 又无描述
  const bothMissing = zeroStock.filter(t => !t.overview?.trim());

  console.log(`\n总主题数: ${total}`);
  console.log(`0 股票  : ${zeroStock.length} 个（${pct(zeroStock.length, total)}）`);
  console.log(`无描述  : ${noOverview.length} 个（${pct(noOverview.length, total)}）`);
  console.log(`两者都缺: ${bothMissing.length} 个`);

  if (zeroStock.length > 0) {
    console.log('\n─── 0 股票主题（含描述情况）──────────────────────────────');
    for (const t of zeroStock) {
      const hasDesc = t.overview?.trim() ? '有描述' : '无描述';
      const date = new Date(t.updated_at + 8 * 3600 * 1000).toISOString().slice(0, 10);
      console.log(`  [${date}] ${hasDesc}  ${t.name}  (${t.id})`);
    }
  }

  if (noOverview.length > 0) {
    const nonZeroNoDesc = noOverview.filter(t => (countMap.get(t.id) ?? 0) > 0);
    if (nonZeroNoDesc.length > 0) {
      console.log('\n─── 有股票但无描述的主题 ──────────────────────────────────');
      for (const t of nonZeroNoDesc) {
        const cnt = countMap.get(t.id) ?? 0;
        const date = new Date(t.updated_at + 8 * 3600 * 1000).toISOString().slice(0, 10);
        console.log(`  [${date}] ${cnt} 支股票  ${t.name}  (${t.id})`);
      }
    }
  }
}

function pct(n: number, total: number) {
  return total === 0 ? '0%' : `${((n / total) * 100).toFixed(1)}%`;
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
