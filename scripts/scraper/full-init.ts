/**
 * 全量初始化脚本 - 清库 + 分批同步 + 批次状态持久化
 *
 * 用法：
 *   npx tsx full-init.ts --start [--batch-size 50]   清库 + 建计划 + 运行所有批次
 *   npx tsx full-init.ts --run                        不清库，继续跑未完成批次
 *   npx tsx full-init.ts --retry <批次号>             重跑指定批次（单个）
 *   npx tsx full-init.ts --retry 3,5,7               重跑多个批次（逗号分隔）
 *   npx tsx full-init.ts --status                    查看所有批次状态
 *   npx tsx full-init.ts --plan [--batch-size 50]    只建计划不运行（调试用）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { importTheme } from './importer.js';
import { randomUUID } from 'crypto';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const PLAN_FILE = new URL('./sync-plan.json', import.meta.url).pathname;
const DEFAULT_BATCH_SIZE = 50;

// ─── 数据结构 ────────────────────────────────────────────────────────────────

type ThemeResultStatus = 'success' | 'success_no_img' | 'skipped_empty' | 'failed';
type BatchStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

interface ThemeResult {
  id: string;
  name: string;
  status: ThemeResultStatus;
  stockCount: number;
  reason?: string;
  processedAt: string;
}

interface BatchSummary {
  total: number;
  success: number;
  successNoImg: number;
  skippedEmpty: number;
  failed: number;
}

interface BatchRecord {
  batchId: number;
  themeIds: string[];
  status: BatchStatus;
  results: ThemeResult[];
  startedAt?: string;
  finishedAt?: string;
  summary?: BatchSummary;
}

interface SyncPlan {
  createdAt: string;
  batchSize: number;
  totalThemes: number;
  batches: BatchRecord[];
}

// ─── 计划文件读写 ─────────────────────────────────────────────────────────────

function loadPlan(): SyncPlan {
  if (!existsSync(PLAN_FILE)) throw new Error(`计划文件不存在: ${PLAN_FILE}，请先运行 --start 或 --plan`);
  return JSON.parse(readFileSync(PLAN_FILE, 'utf-8')) as SyncPlan;
}

function savePlan(plan: SyncPlan): void {
  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2), 'utf-8');
}

// ─── 命令解析 ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

  if (has('--status'))  return { cmd: 'status' as const };
  if (has('--plan'))    return { cmd: 'plan'   as const, batchSize: parseInt(get('--batch-size') ?? '', 10) || DEFAULT_BATCH_SIZE };
  if (has('--run'))     return { cmd: 'run'    as const };
  if (has('--start'))   return { cmd: 'start'  as const, batchSize: parseInt(get('--batch-size') ?? '', 10) || DEFAULT_BATCH_SIZE };
  if (has('--retry')) {
    const val = get('--retry') ?? '';
    const ids = val.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (ids.length === 0) throw new Error('--retry 需要提供批次号，如 --retry 3 或 --retry 3,5,7');
    return { cmd: 'retry' as const, batchIds: ids };
  }
  throw new Error('请指定命令：--start | --run | --retry <批次号> | --status | --plan');
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.cmd === 'status') {
    printStatus(loadPlan());
    return;
  }

  if (opts.cmd === 'plan') {
    const items = await fetchAllItems();
    const plan = buildPlan(items, opts.batchSize);
    savePlan(plan);
    console.log(`✅ 计划已保存：${plan.batches.length} 批次，${plan.totalThemes} 个主题，每批 ${plan.batchSize} 个`);
    return;
  }

  if (opts.cmd === 'start') {
    // 1. 清库
    await clearDb();
    // 2. 建计划
    const items = await fetchAllItems();
    const plan = buildPlan(items, opts.batchSize);
    savePlan(plan);
    console.log(`✅ 计划已保存：${plan.batches.length} 批次，${plan.totalThemes} 个主题`);
    console.log('开始运行...\n');
    // 3. 运行全部批次
    await runPendingBatches(items);
    return;
  }

  if (opts.cmd === 'run') {
    const plan = loadPlan();
    const pending = plan.batches.filter(b => b.status === 'pending' || b.status === 'running');
    if (pending.length === 0) {
      console.log('所有批次已完成，无需运行。');
      printStatus(plan);
      return;
    }
    console.log(`继续运行 ${pending.length} 个未完成批次...`);
    const items = await fetchAllItems();
    await runPendingBatches(items);
    return;
  }

  if (opts.cmd === 'retry') {
    const plan = loadPlan();
    console.log(`重跑批次：${opts.batchIds.join(', ')}`);
    // 只重置需要重试的主题结果，保留已成功的
    for (const batchId of opts.batchIds) {
      const batch = plan.batches.find(b => b.batchId === batchId);
      if (!batch) { console.warn(`  ⚠️  批次 ${batchId} 不存在`); continue; }
      // 保留上次成功的结果，只清除 skipped_empty 和 failed
      const kept = batch.results.filter(r => r.status === 'success' || r.status === 'success_no_img');
      const toRetry = batch.results.filter(r => r.status === 'skipped_empty' || r.status === 'failed');
      console.log(`  批次 ${batchId}：保留 ${kept.length} 个已成功，重跑 ${toRetry.length} 个`);
      batch.results = kept;
      batch.status = 'pending';
      batch.finishedAt = undefined;
      batch.summary = undefined;
    }
    savePlan(plan);
    const items = await fetchAllItems();
    await runPendingBatches(items, opts.batchIds);
    return;
  }
}

// ─── 清库 ─────────────────────────────────────────────────────────────────────

async function clearDb(): Promise<void> {
  console.log('清空数据库...');
  const { error: e1 } = await db.from('themeStocks').delete().neq('id', '');
  if (e1) throw new Error('删除 themeStocks 失败: ' + e1.message);
  const { error: e2 } = await db.from('themeConcept').delete().neq('id', '');
  if (e2) throw new Error('删除 themeConcept 失败: ' + e2.message);
  const { count } = await db.from('themeConcept').select('*', { count: 'exact', head: true });
  console.log(`✅ 清库完成，当前主题数: ${count ?? 0}\n`);
}

// ─── 建批次计划 ───────────────────────────────────────────────────────────────

function buildPlan(items: ThemeItem[], batchSize: number): SyncPlan {
  const batches: BatchRecord[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    batches.push({
      batchId: batches.length + 1,
      themeIds: slice.map(it => it.industry_id),
      status: 'pending',
      results: [],
    });
  }
  return {
    createdAt: new Date().toISOString(),
    batchSize,
    totalThemes: items.length,
    batches,
  };
}

// ─── 运行待处理批次 ───────────────────────────────────────────────────────────

async function runPendingBatches(allItems: ThemeItem[], onlyBatchIds?: number[]): Promise<void> {
  const itemMap = new Map(allItems.map(i => [i.industry_id, i]));
  const plan = loadPlan();

  const toRun = plan.batches.filter(b =>
    (b.status === 'pending' || b.status === 'running') &&
    (onlyBatchIds ? onlyBatchIds.includes(b.batchId) : true)
  );

  console.log(`共 ${toRun.length} 个批次待处理\n`);

  for (const batch of toRun) {
    await runBatch(batch, itemMap, plan);
  }

  // 最终汇总
  const finalPlan = loadPlan();
  console.log('\n' + '='.repeat(50));
  console.log('全部批次运行完毕');
  printStatus(finalPlan);
}

// ─── 运行单个批次 ─────────────────────────────────────────────────────────────

async function runBatch(
  batch: BatchRecord,
  itemMap: Map<string, ThemeItem>,
  plan: SyncPlan,
): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`批次 ${batch.batchId}/${plan.batches.length}（${batch.themeIds.length} 个主题）`);
  console.log('─'.repeat(50));

  batch.status = 'running';
  batch.startedAt = new Date().toISOString();
  // 注意：batch.results 在 retry 模式下已保留了上次成功的记录，不清空
  savePlan(plan);

  // 已成功的主题 id 集合，跳过不重复处理
  const doneIds = new Set(
    batch.results.filter(r => r.status === 'success' || r.status === 'success_no_img').map(r => r.id)
  );

  for (const themeId of batch.themeIds) {
    if (doneIds.has(themeId)) continue; // 已成功，跳过

    const item = itemMap.get(themeId);
    if (!item) {
      batch.results.push({ id: themeId, name: themeId, status: 'failed', stockCount: 0, reason: 'API 列表中未找到该主题', processedAt: new Date().toISOString() });
      savePlan(plan);
      continue;
    }

    const result = await processItem(item);
    batch.results.push(result);
    savePlan(plan); // 每个主题完成立即保存，防止中断丢失进度
    await sleep(1200);
  }

  // 批次完成
  batch.finishedAt = new Date().toISOString();
  batch.summary = calcSummary(batch.results);
  const s = batch.summary;

  // 有失败或待重试则标 partial，全部成功则 success，全部失败则 failed
  if (s.success + s.successNoImg === s.total) batch.status = 'success';
  else if (s.failed === s.total) batch.status = 'failed';
  else batch.status = 'partial';

  savePlan(plan);

  // 批次小结
  const icon = batch.status === 'success' ? '✅' : batch.status === 'partial' ? '⚠️ ' : '❌';
  console.log(`\n${icon} 批次 ${batch.batchId} 完成：成功 ${s.success + s.successNoImg} | 待重试 ${s.skippedEmpty} | 失败 ${s.failed}`);
}

// ─── 处理单个主题 ─────────────────────────────────────────────────────────────

async function processItem(item: ThemeItem): Promise<ThemeResult> {
  console.log(`\n  [${item.title}]`);

  let imgUrls: string[] = [];
  try {
    imgUrls = JSON.parse(item.imgs || '[]') as string[];
  } catch {
    imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : [];
  }

  const hasImages = imgUrls.length > 0;

  const rows: StockRow[] = [];
  for (let imgIdx = 0; imgIdx < imgUrls.length; imgIdx++) {
    console.log(`    解析图片 ${imgIdx + 1}/${imgUrls.length}...`);
    try {
      const partial = await parseTableImage(imgUrls[imgIdx]);
      rows.push(...partial);
      console.log(`      提取到 ${partial.length} 个分类行`);
    } catch (e) {
      console.warn(`      图片 ${imgIdx + 1} 最终失败: ${(e as Error).message}`);
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

  // 有图片但解析为空 → 跳过写入，下次重试该批次时自动重试
  if (hasImages && stocks.length === 0) {
    console.warn(`    ⚠️  有图片但解析结果为空，跳过写入`);
    return { id: item.industry_id, name: item.title, status: 'skipped_empty', stockCount: 0, reason: '有图片但 Vision 解析结果为空', processedAt: new Date().toISOString() };
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
    await importTheme(processedTheme);
    const status: ThemeResultStatus = stocks.length > 0 ? 'success' : 'success_no_img';
    console.log(`    ✅ 成功，共 ${stocks.length} 支股票`);
    return { id: item.industry_id, name: item.title, status, stockCount: stocks.length, processedAt: new Date().toISOString() };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`    ❌ 失败: ${reason}`);
    return { id: item.industry_id, name: item.title, status: 'failed', stockCount: 0, reason, processedAt: new Date().toISOString() };
  }
}

// ─── 状态展示 ────────────────────────────────────────────────────────────────

function printStatus(plan: SyncPlan): void {
  console.log(`\n计划创建于: ${plan.createdAt}  |  总主题: ${plan.totalThemes}  |  批次数: ${plan.batches.length}  |  每批: ${plan.batchSize}`);
  console.log('─'.repeat(70));
  console.log('批次  状态       成功  无图片  待重试  失败  完成时间');
  console.log('─'.repeat(70));

  let totalSuccess = 0, totalNoImg = 0, totalSkipped = 0, totalFailed = 0;

  for (const b of plan.batches) {
    const s = b.summary;
    const icon = { success: '✅', partial: '⚠️ ', failed: '❌', pending: '⏳', running: '🔄' }[b.status];
    const finAt = b.finishedAt ? new Date(b.finishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '-';
    const succ = s?.success ?? 0;
    const noImg = s?.successNoImg ?? 0;
    const skip = s?.skippedEmpty ?? 0;
    const fail = s?.failed ?? 0;
    console.log(`  ${String(b.batchId).padStart(2)}  ${icon} ${b.status.padEnd(8)}  ${String(succ).padStart(4)}  ${String(noImg).padStart(6)}  ${String(skip).padStart(6)}  ${String(fail).padStart(4)}  ${finAt}`);
    totalSuccess += succ; totalNoImg += noImg; totalSkipped += skip; totalFailed += fail;
  }

  console.log('─'.repeat(70));
  console.log(`合计：成功 ${totalSuccess} | 无图片 ${totalNoImg} | 待重试 ${totalSkipped} | 失败 ${totalFailed}`);

  // 给出下一步建议
  const needRetry = plan.batches.filter(b => b.status === 'partial' || b.status === 'failed');
  const pending   = plan.batches.filter(b => b.status === 'pending');
  if (pending.length > 0) {
    console.log(`\n⏳ 还有 ${pending.length} 个批次未开始，运行 --run 继续`);
  }
  if (needRetry.length > 0) {
    const ids = needRetry.map(b => b.batchId).join(',');
    console.log(`\n⚠️  以下批次有失败/待重试主题，可运行 --retry ${ids} 重跑：`);
    for (const b of needRetry) {
      const s = b.summary!;
      console.log(`   批次 ${b.batchId}：待重试 ${s.skippedEmpty} | 失败 ${s.failed}`);
    }
  }
  if (pending.length === 0 && needRetry.length === 0) {
    console.log('\n🎉 所有批次已成功完成！');
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

async function fetchAllItems(): Promise<ThemeItem[]> {
  const all: ThemeItem[] = [];
  let start = 1;
  const limit = 50;
  console.log('拉取 API 主题列表...');
  while (true) {
    const data = await fetchList(start, limit);
    const official = data.result.filter((i: ThemeItem) => i.author === null || i.author === '');
    all.push(...official);
    console.log(`  start=${start}，本页 ${data.result.length} 条，官方 ${official.length} 条，已获取 ${all.length}`);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await sleep(500);
  }
  console.log(`✅ 共获取 ${all.length} 个官方主题\n`);
  return all;
}

function calcSummary(results: ThemeResult[]): BatchSummary {
  return {
    total:        results.length,
    success:      results.filter(r => r.status === 'success').length,
    successNoImg: results.filter(r => r.status === 'success_no_img').length,
    skippedEmpty: results.filter(r => r.status === 'skipped_empty').length,
    failed:       results.filter(r => r.status === 'failed').length,
  };
}

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
