/**
 * 修复存量 0 股票主题：针对 DB 中股票数为 0 的主题，重新拉取并写入股票数据
 * 使用场景：昨晚全量同步因 Vision 大量超时导致 670 个主题股票为空
 *
 * 运行方式：
 *   npx tsx repair-empty-stocks.ts            # 全量修复
 *   npx tsx repair-empty-stocks.ts --test     # 测试：只处理 1 个
 *   npx tsx repair-empty-stocks.ts --batch 50 # 每次只处理 N 个（避免单次超时）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { updateThemeStocks, importTheme } from './importer.js';

const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);

const isTest  = process.argv.includes('--test');
const batchArg = process.argv.indexOf('--batch');
// 默认每批处理 50 个，防止单次运行超时（GitHub Actions 6h 限制）
const BATCH_SIZE = isTest ? 1 : (batchArg !== -1 ? parseInt(process.argv[batchArg + 1], 10) || 50 : 50);

// ─── 结果类型 ────────────────────────────────────────────────────────────────

type RepairStatus = 'success' | 'skipped_empty' | 'no_images' | 'not_in_api' | 'failed';

interface RepairResult {
  id: string;
  name: string;
  status: RepairStatus;
  stockCount: number;
  reason?: string;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[修复脚本] 0 股票主题补跑 | 批次上限: ${BATCH_SIZE}`);
  console.log('---');

  // 1. 查询 DB 中 0 股票的主题
  const zeroStockIds = await fetchZeroStockThemeIds();
  console.log(`DB 中共 ${zeroStockIds.size} 个 0 股票主题`);

  if (zeroStockIds.size === 0) {
    console.log('无需修复，退出。');
    return;
  }

  // 2. 从 API 拉取全量列表，取出需要修复的主题数据
  console.log('拉取 API 主题列表...');
  const apiItems = await fetchAllItems();
  const needRepair = apiItems.filter(i => zeroStockIds.has(i.industry_id));
  const batch = needRepair.slice(0, BATCH_SIZE);

  console.log(`API 中找到 ${needRepair.length} 个待修复主题，本批处理 ${batch.length} 个`);
  if (needRepair.length > BATCH_SIZE) {
    console.log(`  ⚠️  剩余 ${needRepair.length - BATCH_SIZE} 个，下次运行继续处理`);
  }

  // 3. 逐个修复
  const results: RepairResult[] = [];
  for (const item of batch) {
    results.push(await repairItem(item));
    await sleep(1200);
  }

  // 4. 重试失败项
  const toRetry = results.filter(r => r.status === 'failed');
  if (toRetry.length > 0) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`重试 ${toRetry.length} 个失败主题...`);
    await sleep(5_000);

    const itemMap = new Map(batch.map(i => [i.industry_id, i]));
    for (const r of toRetry) {
      const item = itemMap.get(r.id);
      if (!item) continue;
      const retryResult = await repairItem(item);
      const idx = results.findIndex(x => x.id === r.id);
      if (idx !== -1) results[idx] = retryResult;
      await sleep(2400);
    }
  }

  printSummary(results, zeroStockIds.size);
}

// ─── 修复单个主题 ─────────────────────────────────────────────────────────────

async function repairItem(item: ThemeItem): Promise<RepairResult> {
  console.log(`\n[修复] [${item.title}]`);

  const base = { id: item.industry_id, name: item.title };

  // 解析图片 URL
  let imgUrls: string[] = [];
  try {
    imgUrls = JSON.parse(item.imgs || '[]') as string[];
  } catch {
    imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : [];
  }

  if (imgUrls.length === 0) {
    console.log('  本身无图片，正常写入（股票为空）');
    // 主题已在 DB，但需要确认 updated_at 正确；股票为空是合理情况，无需修改
    return { ...base, status: 'no_images', stockCount: 0 };
  }

  // 解析图片
  const rows: StockRow[] = [];
  for (let imgIdx = 0; imgIdx < imgUrls.length; imgIdx++) {
    console.log(`  解析图片 ${imgIdx + 1}/${imgUrls.length}...`);
    try {
      const partial = await parseTableImage(imgUrls[imgIdx]);
      rows.push(...partial);
      console.log(`    提取到 ${partial.length} 个分类行`);
    } catch (e) {
      console.warn(`    图片 ${imgIdx + 1} 最终失败: ${(e as Error).message}`);
    }
    if (imgIdx < imgUrls.length - 1) await sleep(600);
  }

  const cleanTitle = item.title.replace(/[（(].*/u, '').trim();
  const stocks = rows.flatMap(r =>
    r.stocks.map(s => ({
      name: s.name,
      cat1: sanitizeCat(r.cat1, cleanTitle),
      cat2: sanitizeCat(r.cat2, cleanTitle),
      cat3: sanitizeCat(r.cat3, cleanTitle),
      highlight: s.highlight,
      relation: s.relation === s.name ? '' : s.relation,
    }))
  );

  if (stocks.length === 0) {
    console.warn(`  ⚠️  有 ${imgUrls.length} 张图片但解析结果仍为空，跳过写入`);
    return { ...base, status: 'skipped_empty', stockCount: 0, reason: '有图片但 Vision 解析结果为空' };
  }

  const processedTheme = {
    id: item.industry_id,
    name: cleanTitle,
    overview: item.content || '',
    createdAt: item.create_time ? parseBeijingTime(item.create_time) : Date.now(),
    updatedAt: item.update_time
      ? parseBeijingTime(item.update_time)
      : (item.create_time ? parseBeijingTime(item.create_time) : Date.now()),
    stocks,
  };

  try {
    // 用 updateThemeStocks：主题已在 DB，只需重建股票
    await updateThemeStocks(processedTheme);
    console.log(`  ✅ 修复成功，共 ${stocks.length} 支股票`);
    return { ...base, status: 'success', stockCount: stocks.length };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`  ❌ 写入失败: ${reason}`);
    return { ...base, status: 'failed', stockCount: 0, reason };
  }
}

// ─── DB 查询 ─────────────────────────────────────────────────────────────────

async function fetchZeroStockThemeIds(): Promise<Set<string>> {
  // 拉取所有主题 id
  const { data: themes, error: te } = await db.from('themeConcept').select('id');
  if (te) throw new Error('查询主题失败: ' + te.message);

  // 拉取所有有股票的 theme_id（去重）
  const { data: stockRows, error: se } = await db.from('themeStocks').select('theme_id');
  if (se) throw new Error('查询股票失败: ' + se.message);

  const hasStocks = new Set((stockRows ?? []).map((r: { theme_id: string }) => r.theme_id));
  return new Set((themes ?? []).map((t: { id: string }) => t.id).filter(id => !hasStocks.has(id)));
}

async function fetchAllItems(): Promise<ThemeItem[]> {
  const all: ThemeItem[] = [];
  let start = 1;
  const limit = 50;
  while (true) {
    const data = await fetchList(start, limit);
    const official = data.result.filter((i: ThemeItem) => i.author === null || i.author === '');
    all.push(...official);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await sleep(500);
  }
  return all;
}

// ─── 汇总打印 ────────────────────────────────────────────────────────────────

function printSummary(results: RepairResult[], totalZero: number) {
  console.log(`\n${'='.repeat(50)}`);
  console.log('修复汇总');
  console.log('='.repeat(50));

  const success  = results.filter(r => r.status === 'success');
  const noImg    = results.filter(r => r.status === 'no_images');
  const skipped  = results.filter(r => r.status === 'skipped_empty');
  const failed   = results.filter(r => r.status === 'failed');
  const remaining = totalZero - results.length;

  console.log(`✅ 修复成功       : ${success.length} 个`);
  console.log(`✅ 无图片（正常） : ${noImg.length} 个`);
  console.log(`🔁 解析仍为空     : ${skipped.length} 个（下次继续重试）`);
  console.log(`❌ 失败           : ${failed.length} 个`);
  if (remaining > 0) console.log(`⏳ 未处理（下批） : ${remaining} 个`);

  if (skipped.length > 0) {
    console.log('\n── 解析仍为空的主题 ──');
    for (const r of skipped) console.log(`  ${r.name}`);
  }

  if (failed.length > 0) {
    console.log('\n── 失败主题 ──');
    for (const r of failed) {
      console.log(`  ${r.name}${r.reason ? `（${r.reason.slice(0, 80)}）` : ''}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  if (skipped.length + failed.length + remaining > 0) {
    console.log('下次运行此脚本将自动继续处理剩余主题。');
  } else {
    console.log('全部修复完成 🎉');
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function sanitizeCat(value: string, themeTitle: string): string {
  if (!value) return '';
  if (value.trim() === themeTitle.trim()) return '';
  if (value.length > 20) return '';
  return value.trim();
}

function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
