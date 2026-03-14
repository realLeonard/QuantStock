/**
 * 一次性修复脚本：将 DB 中 updated_at 与 API update_time 不一致的主题批量纠正。
 * 只更新时间戳，不动股票数据。修复完成后此脚本不再需要运行。
 *
 * 用法：
 *   npx tsx fix-updated-at.ts          # 预览（dry-run，不写入 DB）
 *   npx tsx fix-updated-at.ts --apply  # 实际写入
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchList, type ThemeItem } from './fetcher.js';

const isDryRun = !process.argv.includes('--apply');

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
}

async function fetchAllItems(): Promise<ThemeItem[]> {
  const all: ThemeItem[] = [];
  let start = 1;
  const limit = 50;
  while (true) {
    const data = await fetchList(start, limit);
    all.push(...data.result);
    process.stdout.write(`\r  拉取列表中... ${all.length}/${data.totalCount}`);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await sleep(500);
  }
  console.log();
  return all;
}

async function fetchDbThemes(): Promise<Map<string, number>> {
  const { data, error } = await getDb().from('themeConcept').select('id, updated_at');
  if (error) throw new Error('查询 DB 失败: ' + error.message);
  return new Map((data ?? []).map((r: { id: string; updated_at: number }) => [r.id, r.updated_at]));
}

async function main() {
  console.log(`[fix-updated-at] ${isDryRun ? '预览模式（加 --apply 才会写入）' : '⚠️  写入模式'}`);
  console.log('---');

  console.log('1. 拉取 API 全量主题...');
  const apiItems = await fetchAllItems();
  console.log(`   共 ${apiItems.length} 个主题`);

  console.log('2. 读取 DB 现有 updated_at...');
  const dbThemes = await fetchDbThemes();
  console.log(`   DB 共 ${dbThemes.size} 个主题`);

  console.log('3. 比对差异...');
  const toFix: Array<{ id: string; title: string; dbVal: number; apiVal: number }> = [];

  for (const item of apiItems) {
    if (!item.update_time) continue;
    const dbVal = dbThemes.get(item.industry_id);
    if (dbVal === undefined) continue; // 新增主题，不在 DB，跳过
    const apiVal = parseBeijingTime(item.update_time);
    if (apiVal !== dbVal) {
      toFix.push({ id: item.industry_id, title: item.title, dbVal, apiVal });
    }
  }

  if (toFix.length === 0) {
    console.log('   ✅ 无需修复，所有 updated_at 已正确');
    return;
  }

  console.log(`   发现 ${toFix.length} 个 updated_at 不一致：`);
  for (const { title, dbVal, apiVal } of toFix) {
    const dbDate = dbVal ? new Date(dbVal).toISOString() : '(null/0)';
    const apiDate = new Date(apiVal).toISOString();
    console.log(`   - ${title.slice(0, 20).padEnd(20)} DB: ${dbDate}  →  API: ${apiDate}`);
  }

  if (isDryRun) {
    console.log('\n预览完成，未写入任何数据。运行 npx tsx fix-updated-at.ts --apply 执行修复。');
    return;
  }

  console.log('\n4. 开始写入...');
  let fixed = 0;
  let failed = 0;
  for (const { id, title, apiVal } of toFix) {
    const { error } = await getDb()
      .from('themeConcept')
      .update({ updated_at: apiVal })
      .eq('id', id);
    if (error) {
      console.error(`   ❌ [${title.slice(0, 15)}] 失败: ${error.message}`);
      failed++;
    } else {
      console.log(`   ✅ [${title.slice(0, 15)}]`);
      fixed++;
    }
    await sleep(100);
  }

  console.log(`\n完成！修复 ${fixed} 个，失败 ${failed} 个`);
}

// API 返回的时间字符串是北京时间（UTC+8），无时区标识
// 必须显式加 +08:00，保证在任何机器上解析结果一致
function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
