/**
 * 早报板块回测脚本
 * - 读取 dailyReport.content
 * - Claude 抽取 + 映射到 akshare 板块标准名
 * - 调 Python 查当日板块/沪深300涨跌幅
 * - 写回 dailyReport.recommended_sectors / avoid_sectors / review_result
 *
 * 用法：
 *   npx tsx review-picks.ts --date 2026-04-15        # 回测单日
 *   npx tsx review-picks.ts --backfill 5             # 回测最近 5 天（不含今天）
 *   npx tsx review-picks.ts --date 2026-04-15 --force # 即使已回测也重跑
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../apps/web/.env.local') });
dotenv.config();

// ===== 类型定义 =====
export interface SectorPick {
  text: string;       // 早报原始词（如 CPO、AI硬件）
  matched: string;    // Claude 映射的 akshare 标准板块名（如 光模块、算力）
}

export interface ReviewResult {
  target_date: string;
  hs300_pct: number | null;
  watch: Array<{
    text: string;
    matched: string | null;
    type?: 'concept' | 'industry';
    change_pct?: number;
    close?: number;
    unmapped?: boolean;
    hit?: boolean;
    error?: string;
  }>;
  avoid: Array<{
    text: string;
    matched: string | null;
    type?: 'concept' | 'industry';
    change_pct?: number;
    close?: number;
    unmapped?: boolean;
    hit?: boolean;
    error?: string;
  }>;
  hit_count: number;
  total_mapped: number;
  hit_rate: string;   // "4/5" 形式
}

// ===== 环境 =====
function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !key) throw new Error('缺少 Supabase 环境变量');
  return createClient(url, key);
}

// ===== 工具 =====
function formatDateAkshare(dateStr: string): string {
  // YYYY-MM-DD → YYYYMMDD
  return dateStr.replace(/-/g, '');
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getTodayBJ(): string {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

// ===== Step 1: Claude 抽取 + 映射板块名 =====
const EXTRACT_SYSTEM = `你是板块名映射助手。给定一份 A 股早报文本，从「今日操作指引」的"重点关注"和"规避"两类板块/主题中，抽取出需要回测的板块名，并映射为东方财富 akshare 接口里的**标准板块名**（概念板块或行业板块）。

映射规则：
- 优先映射为 akshare 的概念板块名（如 "CPO" → "CPO概念"，"PCB" → "PCB概念" 或 "印制电路板"）
- 没有明确的概念板块则映射为行业板块名（如 "石油石化" → "石油行业"）
- 不确定就写最接近的标准名，不要编造
- 对"AI硬件"这类过于宽泛的词，拆成具体子板块（如 "光模块"、"服务器"、"存储芯片"）
- 如果早报某一行同时提到多个板块（如 "PCB-算力硬件"），拆成独立多条
- 返回的 matched 字段要尽量精确，供 akshare hist_em 接口使用

**严格按 JSON 格式返回，不要任何其他文字：**
{
  "watch": [{"text":"原文板块词","matched":"akshare标准名"}, ...],
  "avoid": [{"text":"原文板块词","matched":"akshare标准名"}, ...]
}`;

async function extractSectors(reportContent: string): Promise<{ watch: SectorPick[]; avoid: SectorPick[] }> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1500,
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: `早报原文：\n\n${reportContent}` }],
  });

  const text = msg.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('\n');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude 未返回 JSON：${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    watch: parsed.watch ?? [],
    avoid: parsed.avoid ?? [],
  };
}

// ===== Step 2: 调 Python 查板块涨跌 =====
interface PythonResult {
  target_date: string;
  hs300_pct: number | null;
  watch: Array<Record<string, unknown>>;
  avoid: Array<Record<string, unknown>>;
}

async function queryBoardReturns(
  targetDate: string,
  watchMatched: string[],
  avoidMatched: string[]
): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    const py = spawn('python3', [resolve(__dirname, 'python', 'board_returns.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const input = JSON.stringify({
      target_date: formatDateAkshare(targetDate),
      watch: watchMatched,
      avoid: avoidMatched,
    });

    let stdout = '';
    let stderr = '';
    py.stdout.on('data', (d) => stdout += d.toString());
    py.stderr.on('data', (d) => stderr += d.toString());
    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python 退出码 ${code}: ${stderr}`));
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`解析 Python 输出失败：${stdout.slice(0, 300)}`));
      }
    });
    py.stdin.write(input);
    py.stdin.end();
  });
}

// ===== 单日回测 =====
export async function reviewOneDay(date: string, force = false, dryRun = false): Promise<ReviewResult | null> {
  const sb = getSupabase();

  // 1. 读昨日早报
  const { data: report } = await sb
    .from('dailyReport')
    .select('content, review_result')
    .eq('report_date', date)
    .maybeSingle();

  if (!report) {
    console.warn(`  [review] ${date} 无早报记录，跳过`);
    return null;
  }

  if (report.review_result && !force) {
    console.log(`  [review] ${date} 已存在回测结果，跳过（--force 可强制重跑）`);
    return report.review_result as ReviewResult;
  }

  // 2. Claude 抽取 + 映射
  console.log(`  [review] ${date} Claude 抽取板块...`);
  const { watch, avoid } = await extractSectors(report.content);
  console.log(`  [review] ${date} 抽取到：watch=${watch.length} avoid=${avoid.length}`);
  console.log(`  [review] watch: ${watch.map(w => `${w.text}→${w.matched}`).join(', ')}`);
  console.log(`  [review] avoid: ${avoid.map(a => `${a.text}→${a.matched}`).join(', ')}`);

  if (dryRun) {
    console.log(`  [review] --dry-run 模式，跳过 akshare 查询和 DB 写入`);
    return null;
  }

  // 3. Python 查涨跌
  console.log(`  [review] ${date} 查询板块涨跌...`);
  const pyResult = await queryBoardReturns(
    date,
    watch.map(w => w.matched).filter(Boolean),
    avoid.map(a => a.matched).filter(Boolean)
  );

  // 4. 合并 text + 查询结果 + 命中判定
  const matchedByName = (list: Array<Record<string, unknown>>, name: string) =>
    list.find(r => r.matched === name);

  const watchFinal = watch.map(w => {
    const r = matchedByName(pyResult.watch, w.matched) ?? { unmapped: true };
    const pct = r.change_pct as number | undefined;
    const hit = pct !== undefined && pct > 0;
    return { text: w.text, matched: w.matched || null, ...r, hit: r.unmapped ? undefined : hit };
  });

  const avoidFinal = avoid.map(a => {
    const r = matchedByName(pyResult.avoid, a.matched) ?? { unmapped: true };
    const pct = r.change_pct as number | undefined;
    const hit = pct !== undefined && pct < 0;
    return { text: a.text, matched: a.matched || null, ...r, hit: r.unmapped ? undefined : hit };
  });

  const allMapped = [...watchFinal, ...avoidFinal].filter(r => !r.unmapped);
  const hitCount = allMapped.filter(r => r.hit).length;
  const totalMapped = allMapped.length;

  const result: ReviewResult = {
    target_date: date,
    hs300_pct: pyResult.hs300_pct,
    watch: watchFinal,
    avoid: avoidFinal,
    hit_count: hitCount,
    total_mapped: totalMapped,
    hit_rate: `${hitCount}/${totalMapped}`,
  };

  // 5. 写回 DB
  await sb.from('dailyReport').update({
    recommended_sectors: watch,
    avoid_sectors: avoid,
    review_result: result,
  }).eq('report_date', date);

  console.log(`  [review] ${date} 完成：命中 ${result.hit_rate}，沪300 ${result.hs300_pct}%`);
  return result;
}

// ===== 批量回测 =====
async function backfill(days: number, force: boolean): Promise<void> {
  const sb = getSupabase();
  const today = getTodayBJ();

  // 读最近 N 个工作日的报告（按 report_date desc，不含今天）
  const { data: reports } = await sb
    .from('dailyReport')
    .select('report_date')
    .lt('report_date', today)
    .eq('report_type', 'trading')
    .order('report_date', { ascending: false })
    .limit(days);

  if (!reports || reports.length === 0) {
    console.warn('[backfill] 无可回测的历史报告');
    return;
  }

  console.log(`[backfill] 将回测 ${reports.length} 天: ${reports.map(r => r.report_date).join(', ')}`);

  for (const r of reports) {
    try {
      await reviewOneDay(r.report_date, force);
    } catch (err) {
      console.error(`[backfill] ${r.report_date} 失败:`, err);
    }
  }
}

// ===== CLI 入口 =====
function parseArgs(): { date?: string; backfill?: number; force: boolean; dryRun: boolean } {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
  };
  const date = getArg('--date');
  const bf = getArg('--backfill');
  return {
    date,
    backfill: bf ? parseInt(bf, 10) : undefined,
    force: args.includes('--force'),
    dryRun: args.includes('--dry-run'),
  };
}

async function main() {
  const { date, backfill: bf, force, dryRun } = parseArgs();

  if (bf !== undefined) {
    await backfill(bf, force);
  } else if (date) {
    await reviewOneDay(date, force, dryRun);
  } else {
    // 默认：回测昨日
    const yesterday = addDays(getTodayBJ(), -1);
    console.log(`[review] 未指定 --date，默认回测昨日 ${yesterday}`);
    await reviewOneDay(yesterday, force, dryRun);
  }
  process.exit(0);
}

// 仅作为脚本直接执行时跑 main
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch(err => {
    console.error('[review] 致命错误:', err);
    process.exit(1);
  });
}
