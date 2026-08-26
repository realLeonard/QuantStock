/**
 * 从 DB 当前状态重建 sync-plan.json：
 * - 已有股票的主题标为 success
 * - 在 DB 但无股票的主题标为 skipped_empty（待重试）
 * - 不在 DB 的主题标为 pending（未处理）
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);
const PLAN_FILE = new URL('./sync-plan.json', import.meta.url).pathname;

async function main() {
  const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf-8'));

  console.log('从 DB 查询主题和股票数量...');
  const { data: themes } = await db.from('themeConcept').select('id, name');
  const { data: stocks } = await db.from('themeStocks').select('theme_id');

  const themeMap = new Map((themes ?? []).map((t: any) => [t.id, t.name]));
  const stockCount = new Map<string, number>();
  for (const s of stocks ?? []) {
    stockCount.set(s.theme_id, (stockCount.get(s.theme_id) ?? 0) + 1);
  }

  console.log(`DB 主题数: ${themeMap.size}，有股票的主题数: ${stockCount.size}`);

  let success = 0, skipped = 0, pending = 0;

  for (const batch of plan.batches) {
    const newResults: any[] = [];
    let batchSuccess = 0, batchSkipped = 0, batchPending = 0;

    for (const themeId of batch.themeIds) {
      if (!themeMap.has(themeId)) {
        // 不在 DB，标为 pending（runBatch 会处理没有结果记录的 themeId）
        batchPending++;
        pending++;
        continue;
      }
      const cnt = stockCount.get(themeId) ?? 0;
      if (cnt > 0) {
        // 有股票，标为 success
        newResults.push({
          id: themeId,
          name: themeMap.get(themeId),
          status: 'success',
          stockCount: cnt,
          processedAt: new Date().toISOString(),
        });
        batchSuccess++;
        success++;
      } else {
        // 在 DB 但无股票，标为 skipped_empty（需重试）
        newResults.push({
          id: themeId,
          name: themeMap.get(themeId),
          status: 'skipped_empty',
          stockCount: 0,
          reason: 'DB 中有记录但股票为空，需重新解析',
          processedAt: new Date().toISOString(),
        });
        batchSkipped++;
        skipped++;
      }
    }

    batch.results = newResults;
    const total = batch.themeIds.length;
    if (batchSuccess === total) batch.status = 'success';
    else if (batchPending > 0 || batchSkipped > 0) batch.status = 'partial';
    else batch.status = 'failed';
    batch.summary = {
      total: newResults.length,
      success: batchSuccess,
      successNoImg: 0,
      skippedEmpty: batchSkipped,
      failed: 0,
    };
  }

  writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
  console.log(`\n✅ 计划重建完成：成功 ${success} | 待重试 ${skipped} | 未处理 ${pending}`);

  const retryBatches = plan.batches
    .filter((b: any) => b.status === 'partial' || b.status === 'failed')
    .map((b: any) => b.batchId);
  if (retryBatches.length > 0) {
    console.log(`\n需重跑批次: --retry ${retryBatches.join(',')}`);
  } else {
    console.log('所有批次已完成 🎉');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
