import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchList } from './fetcher.js';
import { parseTableImage } from './vision.js';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const THEME_ID = process.argv[2];
if (!THEME_ID) {
  console.error('用法: npx tsx check-theme.ts <theme_id>');
  process.exit(1);
}

function sanitizeCat(value: string, themeTitle: string): string {
  if (!value) return '';
  if (value.trim() === themeTitle.trim()) return '';
  if (value.length > 20) return '';
  return value.trim();
}

async function main() {
  let target: any = null;
  let start = 1;
  while (!target) {
    const data = await fetchList(start, 50);
    target = data.result.find((i: any) => i.industry_id === THEME_ID);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
  }
  if (!target) { console.log('API 未找到该主题'); return; }

  console.log(`主题：${target.title}`);
  const imgUrls: string[] = JSON.parse(target.imgs || '[]');
  console.log(`图片数：${imgUrls.length}\n`);

  const cleanTitle = target.title.replace(/[（(].*/u, '').trim();
  const apiStocks: any[] = [];
  for (let i = 0; i < imgUrls.length; i++) {
    console.log(`解析图片 ${i + 1}/${imgUrls.length}...`);
    const rows = await parseTableImage(imgUrls[i]);
    for (const row of rows) {
      for (const s of row.stocks) {
        apiStocks.push({
          name: s.name,
          highlight: s.highlight || '',
          cat1: sanitizeCat(row.cat1, cleanTitle),
          cat2: sanitizeCat(row.cat2, cleanTitle),
          cat3: sanitizeCat(row.cat3, cleanTitle),
          relation: s.relation || '',
        });
      }
    }
  }

  const { data: dbStocks } = await db
    .from('themeStocks')
    .select('name, highlight, cat1, cat2, cat3, relation, sort_order')
    .eq('theme_id', THEME_ID)
    .order('sort_order');

  console.log(`\nAPI 解析：${apiStocks.length} 支 | DB：${dbStocks?.length} 支\n`);

  const maxLen = Math.max(apiStocks.length, dbStocks?.length ?? 0);
  let diffCount = 0;

  for (let i = 0; i < maxLen; i++) {
    const a = apiStocks[i];
    const d = dbStocks?.[i];

    if (!a) { console.log(`[${i+1}] ⚠️  DB 多余：${d.name}`); diffCount++; continue; }
    if (!d) { console.log(`[${i+1}] ⚠️  DB 缺少：${a.name}`); diffCount++; continue; }

    const diffs: string[] = [];
    if (a.name !== d.name) diffs.push(`name: DB="${d.name}" → API="${a.name}"`);
    if (a.highlight !== d.highlight) diffs.push(`highlight: DB="${d.highlight||'无'}" → API="${a.highlight||'无'}"`);
    if (a.cat1 !== d.cat1) diffs.push(`cat1: DB="${d.cat1}" → API="${a.cat1}"`);
    if (a.cat2 !== d.cat2) diffs.push(`cat2: DB="${d.cat2}" → API="${a.cat2}"`);
    if (a.cat3 !== d.cat3) diffs.push(`cat3: DB="${d.cat3}" → API="${a.cat3}"`);
    if (a.relation !== d.relation) diffs.push(`relation:\n      DB ="${d.relation}"\n      API="${a.relation}"`);

    if (diffs.length > 0) {
      console.log(`[${i+1}] ${d.name}\n    ${diffs.join('\n    ')}`);
      diffCount++;
    } else {
      console.log(`[${i+1}] ${d.name} ✅`);
    }
  }

  console.log(`\n总计：${diffCount} 条有差异 / ${maxLen} 条`);
}
main().catch(console.error);
