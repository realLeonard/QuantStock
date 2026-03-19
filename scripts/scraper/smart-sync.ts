/**
 * 智能同步：对比线上与 DB，按需补全
 *
 * 逻辑：
 *   1. 拉取 API 全部官方主题
 *   2. 查 DB 所有主题及股票数
 *   3. 分三类处理：
 *      - 不在 DB → 新增
 *      - 在 DB 但股票为 0 → 重新解析股票
 *      - 在 DB 且有股票 → 跳过
 *   4. 分批处理，每个主题完成后实时写进度到 sync-state.json
 *   5. 支持中断续跑、按批次重跑
 *
 * 用法：
 *   npx tsx smart-sync.ts              # 全量对比补全
 *   npx tsx smart-sync.ts --status     # 查看上次进度
 *   npx tsx smart-sync.ts --retry <批次号>  # 重跑指定批次（只跑该批次中失败/待重试的）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { importTheme } from './importer.js';

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
const STATE_FILE = new URL('./sync-state.json', import.meta.url).pathname;
const BATCH_SIZE = 50;

// 永久跳过的主题 ID（不处理、不写入 DB）
const SKIP_IDS = new Set([
  '7df6369f82f34e15ae1f7f6d6342efa3', // 北交所(251029)：股票过多，手动排除
]);

// ─── 数据结构 ────────────────────────────────────────────────────────────────

type ItemStatus = 'success' | 'success_no_img' | 'skipped_empty' | 'failed';
type BatchStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

interface ItemRecord {
  id: string;
  name: string;
  mode: 'insert' | 'update';   // insert=不在DB，update=在DB但0股票
  status: ItemStatus;
  stockCount: number;
  reason?: string;
  processedAt: string;
}

interface BatchRecord {
  batchId: number;
  itemIds: string[];            // 需要处理的 theme_id 列表（已过滤掉无需处理的）
  status: BatchStatus;
  results: ItemRecord[];
  startedAt?: string;
  finishedAt?: string;
}

interface SyncState {
  createdAt: string;
  totalApi: number;             // API 总主题数
  totalSkipped: number;         // 已有股票、跳过不处理的数量
  totalToProcess: number;       // 需要处理的总数
  batches: BatchRecord[];
}

// ─── 状态文件 ────────────────────────────────────────────────────────────────

function saveState(state: SyncState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState(): SyncState {
  if (!existsSync(STATE_FILE)) throw new Error('状态文件不存在，请先运行 npx tsx smart-sync.ts');
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
}

// ─── 参数解析 ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--status')) return { cmd: 'status' as const };
  if (args.includes('--retry')) {
    const idx = args.indexOf('--retry');
    const ids = (args[idx + 1] ?? '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (!ids.length) throw new Error('--retry 需要批次号，如 --retry 3 或 --retry 1,2,3');
    return { cmd: 'retry' as const, batchIds: ids };
  }
  return { cmd: 'run' as const };
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (opts.cmd === 'status') {
    printStatus(loadState());
    return;
  }

  if (opts.cmd === 'retry') {
    const state = loadState();
    for (const batchId of opts.batchIds) {
      const batch = state.batches.find(b => b.batchId === batchId);
      if (!batch) { console.warn(`批次 ${batchId} 不存在`); continue; }
      // 只重置失败/待重试的记录，保留成功的
      const kept = batch.results.filter(r => r.status === 'success' || r.status === 'success_no_img');
      const doneIds = new Set(kept.map(r => r.id));
      console.log(`批次 ${batchId}：保留 ${kept.length} 个已成功，重跑 ${batch.itemIds.length - doneIds.size} 个`);
      batch.results = kept;
      batch.status = 'pending';
      batch.finishedAt = undefined;
    }
    saveState(state);
    const apiItems = await fetchApiItems();
    await runBatches(state, apiItems, opts.batchIds);
    return;
  }

  // cmd === 'run'：对比 DB 重新建立状态，跳过已有股票的主题
  console.log('── 对比 API 与 DB ──────────────────────────────');
  const [apiItems, dbState] = await Promise.all([fetchApiItems(), fetchDbState()]);

  const toInsert: ThemeItem[] = [];
  const toUpdate: ThemeItem[] = [];
  const skipped: string[] = [];

  for (const item of apiItems) {
    const cnt = dbState.get(item.industry_id);
    if (cnt === undefined) {
      toInsert.push(item);     // 不在 DB
    } else if (cnt === 0) {
      toUpdate.push(item);     // 在 DB 但无股票
    } else {
      skipped.push(item.industry_id); // 有股票，跳过
    }
  }

  console.log(`API 主题: ${apiItems.length} | 跳过(有股票): ${skipped.length} | 新增: ${toInsert.length} | 补股票: ${toUpdate.length}`);

  if (toInsert.length === 0 && toUpdate.length === 0) {
    console.log('\n✅ 所有主题数据已完整，无需处理');
    return;
  }

  // 将需要处理的主题合并，按批次切分
  const toProcess = [
    ...toInsert.map(i => ({ item: i, mode: 'insert' as const })),
    ...toUpdate.map(i => ({ item: i, mode: 'update' as const })),
  ];

  const batches: BatchRecord[] = [];
  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const slice = toProcess.slice(i, i + BATCH_SIZE);
    batches.push({
      batchId: batches.length + 1,
      itemIds: slice.map(x => x.item.industry_id),
      status: 'pending',
      results: [],
    });
  }

  const state: SyncState = {
    createdAt: new Date().toISOString(),
    totalApi: apiItems.length,
    totalSkipped: skipped.length,
    totalToProcess: toProcess.length,
    batches,
  };
  saveState(state);
  console.log(`\n共 ${batches.length} 个批次，${toProcess.length} 个主题待处理\n`);

  await runBatches(state, apiItems);
}

// ─── 批次执行 ────────────────────────────────────────────────────────────────

async function runBatches(state: SyncState, apiItems: ThemeItem[], onlyIds?: number[]) {
  const itemMap = new Map(apiItems.map(i => [i.industry_id, i]));
  // 位置映射：第几条（1-indexed），用于 sort_order 和 title_color
  const posMap = new Map(apiItems.map((i, idx) => [i.industry_id, idx + 1]));
  const toRun = state.batches.filter(b =>
    (b.status === 'pending' || b.status === 'running') &&
    (onlyIds ? onlyIds.includes(b.batchId) : true)
  );

  console.log(`待处理批次: ${toRun.length}`);

  for (const batch of toRun) {
    await runBatch(batch, itemMap, posMap, state);
  }

  console.log('\n' + '='.repeat(50));
  printStatus(loadState());
}

async function runBatch(batch: BatchRecord, itemMap: Map<string, ThemeItem>, posMap: Map<string, number>, state: SyncState) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`批次 ${batch.batchId}/${state.batches.length}（${batch.itemIds.length} 个主题）`);

  batch.status = 'running';
  batch.startedAt = new Date().toISOString();
  saveState(state);

  const doneIds = new Set(
    batch.results.filter(r => r.status === 'success' || r.status === 'success_no_img').map(r => r.id)
  );

  for (const themeId of batch.itemIds) {
    if (doneIds.has(themeId)) continue;

    const item = itemMap.get(themeId);
    if (!item) {
      batch.results.push({ id: themeId, name: themeId, mode: 'insert', status: 'failed', stockCount: 0, reason: 'API 列表中未找到', processedAt: new Date().toISOString() });
      saveState(state);
      continue;
    }

    // 判断是 insert 还是 update（从 state 的 itemIds 中无法直接判断，靠 DB 状态）
    // 实际上 importTheme 已经是幂等的（upsert + 删旧股票 + 插新股票），insert/update 逻辑一致
    const globalPos = posMap.get(themeId) ?? 9999;
    const result = await processItem(item, globalPos);
    batch.results.push(result);
    saveState(state);
    await sleep(1200);
  }

  batch.finishedAt = new Date().toISOString();
  const s = calcSummary(batch.results, batch.itemIds.length);
  batch.status = s.success + s.successNoImg >= batch.itemIds.length ? 'success'
    : s.failed === batch.itemIds.length ? 'failed'
    : 'partial';
  saveState(state);

  const icon = { success: '✅', partial: '⚠️ ', failed: '❌' }[batch.status] ?? '';
  console.log(`${icon} 批次 ${batch.batchId} 完成：成功 ${s.success + s.successNoImg} | 待重试 ${s.skippedEmpty} | 失败 ${s.failed}`);
}

// ─── 处理单个主题 ─────────────────────────────────────────────────────────────

async function processItem(item: ThemeItem, globalPos: number): Promise<ItemRecord> {
  console.log(`\n  [${item.title}]`);

  let imgUrls: string[] = [];
  try { imgUrls = JSON.parse(item.imgs || '[]'); }
  catch { imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : []; }

  const hasImages = imgUrls.length > 0;
  const rows: StockRow[] = [];

  for (let i = 0; i < imgUrls.length; i++) {
    console.log(`    解析图片 ${i + 1}/${imgUrls.length}...`);
    try {
      const partial = await parseTableImage(imgUrls[i]);
      rows.push(...partial);
      console.log(`      提取 ${partial.length} 行`);
    } catch (e) {
      console.warn(`      图片 ${i + 1} 失败: ${(e as Error).message}`);
    }
    if (i < imgUrls.length - 1) await sleep(600);
  }

  const cleanTitle = item.title.replace(/[（(].*/u, '').trim();
  const stocks = rows.flatMap(r => r.stocks.map(s => ({
    name: s.name,
    cat1: sanitizeCat(r.cat1, cleanTitle),
    cat2: sanitizeCat(r.cat2, cleanTitle),
    cat3: sanitizeCat(r.cat3, cleanTitle),
    highlight: s.highlight,
    relation: s.relation,
  })));

  if (hasImages && stocks.length === 0) {
    console.warn(`    ⚠️  有图片但解析为空，跳过写入（下次重试）`);
    return { id: item.industry_id, name: item.title, mode: 'insert', status: 'skipped_empty', stockCount: 0, reason: '有图片但 Vision 解析为空', processedAt: new Date().toISOString() };
  }

  try {
    await importTheme({
      id: item.industry_id,
      name: cleanTitle,
      overview: item.content || '',
      createdAt: item.create_time ? parseBeijingTime(item.create_time) : Date.now(),
      updatedAt: item.update_time ? parseBeijingTime(item.update_time) : (item.create_time ? parseBeijingTime(item.create_time) : Date.now()),
      stocks,
      // 前15条写入 sort_order（API 列表实际位置，1-indexed）
      sortOrder: globalPos <= 15 ? globalPos : undefined,
      // 主题名称颜色（red 或 null 均写入，保持与 API 同步）
      titleColor: item.title_red === 1 ? 'red' : null,
    });
    const status: ItemStatus = stocks.length > 0 ? 'success' : 'success_no_img';
    console.log(`    ✅ 成功，${stocks.length} 支股票`);
    return { id: item.industry_id, name: item.title, mode: 'insert', status, stockCount: stocks.length, processedAt: new Date().toISOString() };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`    ❌ 失败: ${reason}`);
    return { id: item.industry_id, name: item.title, mode: 'insert', status: 'failed', stockCount: 0, reason, processedAt: new Date().toISOString() };
  }
}

// ─── DB / API 查询 ────────────────────────────────────────────────────────────

// 返回 Map<theme_id, stockCount>
// 注意：Supabase 默认限制 1000 行，必须分页拉取，否则大量主题被误判为 0 股票
async function fetchDbState(): Promise<Map<string, number>> {
  // 拉取所有主题 id（主题数量有限，单次足够）
  const { data: themes, error: te } = await db.from('themeConcept').select('id');
  if (te) throw new Error('查询主题失败: ' + te.message);

  const map = new Map<string, number>();
  for (const t of themes ?? []) map.set(t.id, 0);

  // 分页拉取所有股票 theme_id（每页 1000 条）
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: stocks, error: se } = await db
      .from('themeStocks')
      .select('theme_id')
      .range(from, from + PAGE - 1);
    if (se) throw new Error('查询股票失败: ' + se.message);
    for (const s of stocks ?? []) {
      map.set(s.theme_id, (map.get(s.theme_id) ?? 0) + 1);
    }
    if (!stocks || stocks.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

async function fetchApiItems(): Promise<ThemeItem[]> {
  const all: ThemeItem[] = [];
  let start = 1;
  console.log('拉取 API 主题列表...');
  while (true) {
    const data = await fetchList(start, 50);
    const official = data.result.filter((i: ThemeItem) => i.author === null || i.author === '');
    all.push(...official);
    console.log(`  start=${start}  官方 ${official.length} 条  累计 ${all.length}`);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await sleep(500);
  }
  // 过滤永久跳过的主题
  const filtered = all.filter(i => !SKIP_IDS.has(i.industry_id));
  if (filtered.length < all.length) {
    console.log(`  跳过 ${all.length - filtered.length} 个永久排除主题（SKIP_IDS）`);
  }
  console.log(`✅ 共 ${filtered.length} 个官方主题\n`);
  return filtered;
}

// ─── 状态展示 ────────────────────────────────────────────────────────────────

function printStatus(state: SyncState) {
  console.log(`\n创建时间: ${state.createdAt}`);
  console.log(`API总数: ${state.totalApi} | 已跳过(有股票): ${state.totalSkipped} | 待处理: ${state.totalToProcess}`);
  console.log('─'.repeat(65));
  console.log('批次  状态       进度      成功  待重试  失败');
  console.log('─'.repeat(65));

  let tSuccess = 0, tSkipped = 0, tFailed = 0;
  for (const b of state.batches) {
    const s = calcSummary(b.results, b.itemIds.length);
    const icon = { success: '✅', partial: '⚠️ ', failed: '❌', pending: '⏳', running: '🔄' }[b.status];
    const done = b.results.length;
    const progress = b.status === 'pending' ? '-' : `${done}/${b.itemIds.length}`;
    console.log(`  ${String(b.batchId).padStart(2)}  ${icon} ${b.status.padEnd(8)}  ${String(progress).padStart(7)}   ${String(s.success + s.successNoImg).padStart(4)}    ${String(s.skippedEmpty).padStart(4)}  ${String(s.failed).padStart(4)}`);
    tSuccess += s.success + s.successNoImg; tSkipped += s.skippedEmpty; tFailed += s.failed;
  }

  console.log('─'.repeat(65));
  console.log(`合计：成功 ${tSuccess} | 待重试 ${tSkipped} | 失败 ${tFailed}`);

  const needRetry = state.batches.filter(b => b.status === 'partial' || b.status === 'failed');
  if (needRetry.length) {
    console.log(`\n⚠️  需重跑: --retry ${needRetry.map(b => b.batchId).join(',')}`);
  } else if (state.batches.every(b => b.status === 'success')) {
    console.log('\n🎉 全部完成！');
  }
}

// ─── 工具 ─────────────────────────────────────────────────────────────────────

function calcSummary(results: ItemRecord[], total: number) {
  return {
    total,
    success:      results.filter(r => r.status === 'success').length,
    successNoImg: results.filter(r => r.status === 'success_no_img').length,
    skippedEmpty: results.filter(r => r.status === 'skipped_empty').length,
    failed:       results.filter(r => r.status === 'failed').length,
  };
}

function sanitizeCat(v: string, title: string): string {
  if (!v) return '';
  if (v.trim() === title.trim() || v.length > 20) return '';
  return v.trim();
}

function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(e => { console.error('致命错误:', e); process.exit(1); });
