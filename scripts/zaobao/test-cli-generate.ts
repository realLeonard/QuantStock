/**
 * 早报 CLI 测试脚本
 * 只做：读数据库 → 组装 prompt → 调 Claude CLI 生成 → 输出到 stdout
 * 不做：数据采集、保存 DB、推送通知
 *
 * 用法：npx tsx test-cli-generate.ts [YYYY-MM-DD]
 */

import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { formatReviewForZaobao, type DailyReviewRow, type LimitUpReasonsRow } from './formatters/review-data';
import { loadHistoryBaseline, loadSectorContinuity } from './formatters/review-queries';
import { loadYesterdayReviewBlock, loadRecentHitRate } from './formatters/review-result';
import { isTradingDay } from '../shared/trading-calendar';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../apps/web/.env.local') });
dotenv.config();

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !key) throw new Error('缺少 Supabase 环境变量');
  return createClient(url, key);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function bjDateTimeToUtcMs(date: string, hour: number, minute: number): number {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).getTime();
}

// ===== 数据读取（与 generate.ts 完全一致）=====

async function loadRawData(date: string) {
  const sb = getSupabase();
  const { data, error } = await sb.from('rawMarketData').select('*').eq('data_date', date);
  if (error) throw new Error(`读取 rawMarketData 失败: ${error.message}`);

  const aShareData: Record<string, unknown> = {};
  const intlData: Record<string, unknown> = {};
  const macroData: Record<string, unknown> = {};
  for (const row of data ?? []) {
    if (row.data_type === 'a_share') Object.assign(aShareData, row.payload);
    else if (row.data_type === 'intl_market') Object.assign(intlData, row.payload);
    else if (row.data_type === 'macro') Object.assign(macroData, row.payload);
  }
  return { aShareData, intlData, macroData };
}

async function loadNewsItems(date: string, reportType: 'trading' | 'weekly') {
  const sb = getSupabase();
  const dayOfWeek = new Date(`${date}T12:00:00+08:00`).getDay();

  let windowStart: number;
  let windowEnd: number;

  if (reportType === 'weekly') {
    const friday = addDays(date, -2);
    windowStart = bjDateTimeToUtcMs(friday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 18, 0);
  } else if (dayOfWeek === 1) {
    const friday = addDays(date, -3);
    windowStart = bjDateTimeToUtcMs(friday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 8, 20);
  } else {
    const yesterday = addDays(date, -1);
    windowStart = bjDateTimeToUtcMs(yesterday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 8, 20);
  }

  const { data } = await sb
    .from('newsItems_cls')
    .select('title, summary, categories, level, published_at')
    .gte('published_at', windowStart)
    .lte('published_at', windowEnd)
    .order('published_at', { ascending: false });

  const rows = data ?? [];
  const levelOrder = (l: unknown) => l === 'A' ? 0 : l === 'B' ? 1 : 2;
  const byLevel = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    levelOrder(a.level) - levelOrder(b.level) || Number(b.published_at) - Number(a.published_at);

  return {
    priority: rows.filter(r => r.level === 'A').sort(byLevel),
    flash: rows.filter(r => r.level !== 'A').sort(byLevel),
  };
}

async function loadMarketBreadth() {
  const sb = getSupabase();
  const { data } = await sb
    .from('marketBreadth')
    .select('trade_date, rise, fall, flat, limit_up, limit_down')
    .order('trade_date', { ascending: false })
    .limit(7);
  return (data ?? []).reverse();
}

async function loadReviewData(beforeDate: string) {
  const sb = getSupabase();
  const { data: reviewRow } = await sb
    .from('dailyReview')
    .select('report_date, market_overview, market_sentiment, limit_up_ladder, limit_analysis, sector_fund_flow, stock_fund_flow, ths_hot_concepts, ths_hot_industries, dragon_tiger, hot_money_moves, margin_data')
    .lte('report_date', beforeDate)
    .eq('status', 'success')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!reviewRow) return { review: null, limitUp: null, reviewDate: null };
  const reviewDate = reviewRow.report_date as string;

  const { data: lurRow } = await sb
    .from('limitUpReasons')
    .select('themes')
    .eq('pick_date', reviewDate)
    .maybeSingle();

  return {
    review: reviewRow as DailyReviewRow,
    limitUp: (lurRow as LimitUpReasonsRow) ?? null,
    reviewDate,
  };
}

async function loadPreviousSummary(date: string) {
  const sb = getSupabase();
  const { data } = await sb
    .from('dailyReport')
    .select('summary')
    .lt('report_date', date)
    .order('report_date', { ascending: false })
    .limit(1)
    .single();
  return data?.summary ?? undefined;
}

// ===== 主流程 =====

async function main() {
  const date = process.argv[2] || (() => {
    const now = new Date();
    return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  })();

  const reportType = isTradingDay(date) ? 'trading' : 'weekly';
  console.error(`\n[test-cli] 日期: ${date}，类型: ${reportType}`);

  // Step 1: 读取数据库
  console.error('[1/4] 读取数据库...');

  let dataDate = date;
  if (reportType === 'weekly') {
    const sb = getSupabase();
    const { data } = await sb
      .from('rawMarketData').select('data_date').eq('data_type', 'a_share')
      .lt('data_date', date).order('data_date', { ascending: false }).limit(1).single();
    dataDate = data?.data_date ?? date;
    console.error(`  周报模式，使用 ${dataDate} 的行情数据`);
  }

  const { aShareData, intlData, macroData } = await loadRawData(dataDate);
  const newsItems = await loadNewsItems(date, reportType);
  const breadthHistory = await loadMarketBreadth();
  const previousSummary = await loadPreviousSummary(date);
  const { review, limitUp, reviewDate } = await loadReviewData(addDays(date, -1));
  const reviewMarkdown = review ? formatReviewForZaobao(review, limitUp) : undefined;

  let historyBaseline: string | undefined;
  let sectorContinuity: string | undefined;
  let yesterdayReviewBlock: string | undefined;
  let recentHitRate: string | undefined;

  if (reviewDate) {
    const sb = getSupabase();
    [historyBaseline, sectorContinuity] = await Promise.all([
      loadHistoryBaseline(sb, reviewDate),
      loadSectorContinuity(sb, reviewDate),
    ]);
    [yesterdayReviewBlock, recentHitRate] = await Promise.all([
      loadYesterdayReviewBlock(sb, date).then(v => v ?? undefined),
      loadRecentHitRate(sb, date, 7).then(v => v ?? undefined),
    ]);
  }

  console.error(`  A股数据: ${Object.keys(aShareData).length} 项`);
  console.error(`  新闻: A级 ${newsItems.priority.length} 条, 其他 ${newsItems.flash.length} 条`);
  console.error(`  涨跌家数: ${breadthHistory.length} 天`);
  console.error(`  复盘数据: ${reviewDate ?? '无'}`);

  // Step 2: 组装 prompt
  console.error('[2/4] 组装 prompt...');
  const userPrompt = buildUserPrompt({
    date, reportType, aShareData, intlData, macroData,
    newsItems, breadthHistory, previousSummary,
    reviewMarkdown, historyBaseline, sectorContinuity,
    yesterdayReviewBlock, recentHitRate,
  });

  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;
  const promptPath = `/tmp/zaobao-prompt-${Date.now()}.txt`;
  fs.writeFileSync(promptPath, fullPrompt);
  console.error(`  prompt 长度: ${fullPrompt.length} 字符，已写入 ${promptPath}`);

  // Step 3: 调用 Claude CLI
  console.error('[3/4] 调用 Claude CLI (claude-opus-4-6)...');
  const cliInput = `请用 Read 工具读取文件 ${promptPath}，然后严格按照文件中的指令要求生成投资早报。直接输出早报内容，不要输出 markdown 代码块包裹。`;

  const startMs = Date.now();
  const result = spawnSync('claude', [
    '-p', '--no-session-persistence',
    '--allowedTools', 'Read',
    '--model', 'claude-opus-4-6',
  ], {
    timeout: 900_000,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    input: cliInput,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.error(`  CLI 退出码: ${result.status}, 耗时: ${elapsedSec}s`);

  if (result.stderr) {
    console.error(`  stderr (末尾 500 字): ${result.stderr.slice(-500)}`);
  }

  if (result.status !== 0) {
    throw new Error(`CLI 失败 (退出码 ${result.status}): ${(result.stderr || result.stdout || '').slice(-500)}`);
  }

  // Step 4: 输出结果
  const output = result.stdout.trim();
  console.error(`[4/4] 生成完成，输出 ${output.length} 字符\n`);
  console.log(output);
}

main().catch(err => {
  console.error('[test-cli-generate] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
