import 'dotenv/config';
import { fetchList, type ThemeItem } from './fetcher.js';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);

// 拉 API 前15条
const data = await fetchList(1, 50);
const official = data.result.filter((i: ThemeItem) => i.author === null || i.author === '');
const top15 = official.slice(0, 15);

console.log('=== API 前15条 ===');
console.log('  pos  sort_no  title_red  title');
top15.forEach((i: ThemeItem, idx: number) => {
  const pos = idx + 1;
  console.log(`  ${String(pos).padStart(2)}   ${String(i.sort_no ?? 'null').padEnd(6)}   ${i.title_red}          ${i.title}`);
});

// 查 DB 对应记录
const ids = top15.map((i: ThemeItem) => i.industry_id);
const { data: rows } = await db
  .from('themeConcept')
  .select('id, name, sort_order, title_color')
  .in('id', ids);

const rowMap = new Map((rows ?? []).map((r: { id: string; name: string; sort_order: number | null; title_color: string | null }) => [r.id, r]));

console.log('\n=== DB 对应记录（按 API 顺序） ===');
top15.forEach((i: ThemeItem, idx: number) => {
  const r = rowMap.get(i.industry_id);
  const dbSort = r ? String(r.sort_order ?? 'null').padEnd(4) : '(不在DB)';
  const dbColor = r ? (r.title_color ?? 'null') : '(不在DB)';
  const match = r
    ? ((r.sort_order === idx + 1) && (r.title_color === (i.title_red === 1 ? 'red' : null)) ? '✅' : '❌')
    : '❓';
  console.log(`${String(idx + 1).padStart(2)}. API sort_no=${String(i.sort_no ?? 'null').padEnd(4)} DB sort_order=${dbSort}  API red=${i.title_red}  DB color=${dbColor}  ${match}  ${i.title}`);
});
