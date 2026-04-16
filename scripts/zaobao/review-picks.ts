/**
 * 早报板块 + 个股回测脚本
 * - 读取 dailyReport.content
 * - Claude 抽取「今日操作指引」表格每行的 {板块, 个股[]}，映射到同花顺板块标准名
 * - 调 Python 查板块 + 个股 + 沪深300 的当日涨跌幅
 * - 按阈值判定命中：板块 >=0.3%，个股 >=1%
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

// ===== 命中阈值 =====
const SECTOR_HIT_THRESHOLD = 0.3; // 板块涨跌幅绝对值 >=0.3% 才算有效命中
const STOCK_HIT_THRESHOLD = 1.0;  // 个股涨跌幅绝对值 >=1% 才算有效命中

// ===== 类型定义 =====
export interface SectorPick {
  text: string;          // 早报原始板块词
  matched: string;       // Claude 映射的同花顺标准板块名
  stocks: string[];      // 该行的重点个股（原文名）
}

export interface StockResult {
  name: string;
  code?: string | null;
  change_pct?: number;
  close?: number;
  unmapped?: boolean;
  hit?: boolean;
  error?: string;
}

export interface SectorResult {
  text: string;
  matched: string | null;
  type?: 'concept' | 'industry';
  change_pct?: number;
  close?: number;
  unmapped?: boolean;
  hit?: boolean;
  error?: string;
  stocks: StockResult[];
  stock_hit?: number;     // 该板块个股命中数
  stock_total?: number;   // 该板块有效个股数（不含 unmapped）
}

export interface ReviewResult {
  target_date: string;
  hs300_pct: number | null;
  watch: SectorResult[];
  avoid: SectorResult[];
  // 板块命中
  hit_count: number;
  total_mapped: number;
  hit_rate: string;       // "4/5"
  // 个股命中
  stock_hit_count: number;
  stock_total: number;
  stock_hit_rate: string; // "7/20"
  // 命中阈值（写进去便于前端/溯源）
  thresholds: { sector: number; stock: number };
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

// ===== Step 1: Claude 抽取「板块 + 个股」+ 板块名映射 =====
const EXTRACT_SYSTEM = `你是板块名映射助手。给定一份 A 股早报文本，从「今日操作指引」表格里，逐行抽取出【板块】和该行的【重点个股】，并把板块名映射为**同花顺 akshare** 接口（stock_board_concept_index_ths / stock_board_industry_index_ths）里的标准板块名。

板块映射规则：
- 优先映射为同花顺概念板块名；没有对应概念板块再映射为行业板块名
- 同花顺命名习惯与东方财富不同，常见映射参考：
  * CPO / 光模块 / 光通信 / 硅光 → 共封装光学(CPO)
  * PCB / 印制电路板 → PCB概念
  * 算力 / 算力硬件 / 算力租赁 → 算力租赁
  * 东数西算 → 东数西算(算力)
  * 液冷 / 液冷服务器 → 液冷服务器
  * 存储芯片 / 存储 → 存储芯片
  * 创新药 → 创新药
  * AI PC → AI PC
  * AI手机 → AI手机
  * 阿尔茨海默 → 阿尔茨海默概念
  * 军工电子 / 军工 → 军工（概念）或 军工信息化
  * 石油石化 → 石油加工贸易（行业）
  * 油服 / 油气装备 / 油气开采 → 油气开采及服务（行业）
  * 航空 / 机场 → 机场航运（行业）
  * 半导体 → 半导体（行业）或 半导体设备（概念）
  * 白酒 → 白酒（行业）
- 不确定就写最接近的标准名，不要编造（编造会被判为 unmapped）
- 对"AI硬件"这类过于宽泛的词，拆成具体子板块（如 "共封装光学(CPO)"、"存储芯片"、"液冷服务器"），每个子板块作为独立一行，共享原表格里的个股列表
- 如果早报某一行同时提到多个板块（如 "PCB-算力硬件"），拆成独立多条
- matched 字段必须与同花顺板块列表完全一致（含空格/括号/中英文）

个股抽取规则：
- 个股**只从表格"重点个股"列**抽取，不要从段落或其他字段里抓
- 个股保持 A 股中文名原样（如 "中际旭创"），**不要写代码**、不要加括号/空格/"科技"等修饰
- 如果某一行标"——"或留空，stocks 写空数组 []
- 连板股描述如 "华远控股(6板)"、"中恒电气(4板)"，只取股票名（"华远控股"、"中恒电气"），去掉括号里的连板信息
- 如果表格某行拆成多个板块子行，所有子行共享同一份个股列表

**严格按 JSON 格式返回，不要任何其他文字：**
{
  "watch": [{"text":"原文板块词","matched":"同花顺标准板块名","stocks":["个股名1","个股名2"]}, ...],
  "avoid": [{"text":"原文板块词","matched":"同花顺标准板块名","stocks":["个股名1"]}, ...]
}`;

async function extractSectors(reportContent: string): Promise<{ watch: SectorPick[]; avoid: SectorPick[] }> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
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
  const normalize = (arr: Array<Record<string, unknown>>): SectorPick[] =>
    (arr ?? []).map(r => ({
      text: String(r.text ?? ''),
      matched: String(r.matched ?? ''),
      stocks: Array.isArray(r.stocks) ? (r.stocks as unknown[]).map(s => String(s)) : [],
    }));

  return {
    watch: normalize(parsed.watch),
    avoid: normalize(parsed.avoid),
  };
}

// ===== Step 2: 调 Python 查板块 + 个股涨跌 =====
interface PythonSectorItem {
  sector: string;
  matched?: string | null;
  type?: 'concept' | 'industry';
  change_pct?: number;
  close?: number;
  unmapped?: boolean;
  error?: string;
  stocks: Array<{
    name: string;
    code?: string | null;
    change_pct?: number;
    close?: number;
    unmapped?: boolean;
    error?: string;
  }>;
}

interface PythonResult {
  target_date: string;
  hs300_pct: number | null;
  watch: PythonSectorItem[];
  avoid: PythonSectorItem[];
}

// 分页拉取全表（绕过 PostgREST 默认 1000 条上限）
async function fetchAllRows(
  sb: SupabaseClient,
  table: string,
  columns: string,
  filter?: (q: ReturnType<SupabaseClient['from']>) => unknown,
): Promise<Array<Record<string, unknown>>> {
  const PAGE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select(columns);
    if (filter) q = filter(q) as typeof q;
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`读取 ${table} 失败: ${error.message}`);
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

// 构建股票名→代码映射：优先 stockCodes（5000+ 全市场），缺失再 themeStocks 兜底
async function buildStockCodeMap(sb: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // 1. stockCodes（主源）：全表分页拉取
  const codes = await fetchAllRows(sb, 'stockCodes', 'code, name');
  for (const row of codes) {
    const name = (row.name as string | null)?.replace(/\s+/g, '').trim();
    const code = (row.code as string | null)?.trim();
    if (name && code && !map.has(name)) map.set(name, code);
  }

  // 2. themeStocks（兜底）：只取 code 非空的行，填补主源缺失的名字（如连板热股的新上市名）
  try {
    const themeRows = await fetchAllRows(
      sb,
      'themeStocks',
      'code, name',
      (q) => q.not('code', 'is', null).neq('code', ''),
    );
    let added = 0;
    for (const row of themeRows) {
      const name = (row.name as string | null)?.replace(/\s+/g, '').trim();
      const code = (row.code as string | null)?.trim();
      if (name && code && !map.has(name)) {
        map.set(name, code);
        added += 1;
      }
    }
    if (added > 0) console.log(`  [review] themeStocks 兜底补充 ${added} 条`);
  } catch (e) {
    console.warn(`  [review] 读取 themeStocks 失败（跳过兜底）: ${e instanceof Error ? e.message : String(e)}`);
  }

  return map;
}

function lookupStockCode(map: Map<string, string>, rawName: string): string | null {
  const key = rawName.replace(/\s+/g, '').trim();
  return map.get(key) ?? null;
}

async function queryReturns(
  targetDate: string,
  watch: SectorPick[],
  avoid: SectorPick[],
  codeMap: Map<string, string>
): Promise<PythonResult> {
  return new Promise((resolvePromise, reject) => {
    const py = spawn('python3', [resolve(__dirname, 'python', 'board_returns.py')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 注意：不过滤 matched 为空的行（如"高位连板股"无对应同花顺板块），
    // Python 侧板块会标 unmapped，但个股仍然会被正常查询（板块命中与个股命中相互独立）
    const toPayload = (list: SectorPick[]) =>
      list.map(x => ({
        sector: x.matched || '',
        stocks: x.stocks.map(name => ({
          name,
          code: lookupStockCode(codeMap, name),
        })),
      }));

    const input = JSON.stringify({
      target_date: formatDateAkshare(targetDate),
      watch: toPayload(watch),
      avoid: toPayload(avoid),
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
        resolvePromise(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`解析 Python 输出失败：${stdout.slice(0, 300)}`));
      }
    });
    py.stdin.write(input);
    py.stdin.end();
  });
}

// ===== Step 3: 合并 Claude 抽取 + Python 返回，按阈值判命中 =====
function buildSectorResult(
  pick: SectorPick,
  pyItem: PythonSectorItem | undefined,
  side: 'watch' | 'avoid',
): SectorResult {
  // 板块部分
  const baseSector: SectorResult = {
    text: pick.text,
    matched: pick.matched || null,
    stocks: [],
  };

  if (!pyItem) {
    // Claude 没给 matched 或 Python 没返回：板块作 unmapped，个股仍然按 pick.stocks 填但全部 unmapped
    return {
      ...baseSector,
      unmapped: true,
      stocks: pick.stocks.map(n => ({ name: n, unmapped: true, error: '板块未映射' })),
      stock_hit: 0,
      stock_total: 0,
    };
  }

  const sectorUnmapped = pyItem.unmapped === true;
  const pct = pyItem.change_pct;
  let sectorHit: boolean | undefined;
  if (!sectorUnmapped && pct !== undefined) {
    if (side === 'watch') sectorHit = pct >= SECTOR_HIT_THRESHOLD;
    else sectorHit = pct <= -SECTOR_HIT_THRESHOLD;
  }

  // 个股部分：按 pick.stocks 的顺序，从 pyItem.stocks 里取同名结果
  const stockByName = new Map<string, PythonSectorItem['stocks'][number]>();
  for (const s of pyItem.stocks ?? []) stockByName.set(s.name, s);

  const stocksOut: StockResult[] = pick.stocks.map(name => {
    const s = stockByName.get(name);
    if (!s) return { name, unmapped: true, error: 'Python 未返回该股' };
    if (s.unmapped) {
      return { name, code: s.code ?? null, unmapped: true, error: s.error };
    }
    const p = s.change_pct;
    let hit: boolean | undefined;
    if (p !== undefined) {
      if (side === 'watch') hit = p >= STOCK_HIT_THRESHOLD;
      else hit = p <= -STOCK_HIT_THRESHOLD;
    }
    return {
      name,
      code: s.code ?? null,
      change_pct: p,
      close: s.close,
      hit,
    };
  });

  const stockValid = stocksOut.filter(s => !s.unmapped && s.hit !== undefined);
  const stockHitCount = stockValid.filter(s => s.hit).length;

  return {
    ...baseSector,
    type: pyItem.type,
    change_pct: pct,
    close: pyItem.close,
    unmapped: sectorUnmapped,
    hit: sectorHit,
    error: pyItem.error,
    stocks: stocksOut,
    stock_hit: stockHitCount,
    stock_total: stockValid.length,
  };
}

// ===== 单日回测 =====
export async function reviewOneDay(date: string, force = false, dryRun = false): Promise<ReviewResult | null> {
  const sb = getSupabase();

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

  // 2. Claude 抽取
  console.log(`  [review] ${date} Claude 抽取板块 + 个股...`);
  const { watch, avoid } = await extractSectors(report.content);
  console.log(`  [review] ${date} 抽取到：watch=${watch.length} avoid=${avoid.length}`);
  const fmt = (list: SectorPick[]) =>
    list.map(w => `${w.text}→${w.matched}[${w.stocks.join('/')}]`).join(', ');
  console.log(`  [review] watch: ${fmt(watch)}`);
  console.log(`  [review] avoid: ${fmt(avoid)}`);

  if (dryRun) {
    console.log(`  [review] --dry-run 模式，跳过查询和 DB 写入`);
    return null;
  }

  // 3. 构建个股代码映射（stockCodes 主源 + themeStocks 兜底）
  console.log(`  [review] ${date} 构建个股代码映射...`);
  const codeMap = await buildStockCodeMap(sb);
  console.log(`  [review] ${date} 代码映射共 ${codeMap.size} 条`);

  // 4. Python 查涨跌
  console.log(`  [review] ${date} 查询板块 + 个股涨跌...`);
  const pyResult = await queryReturns(date, watch, avoid, codeMap);

  // 4. 合并 + 命中判定（按输入顺序一一对应 Python 返回，支持 matched 为空 / 重复）
  const watchFinal = watch.map((w, i) => buildSectorResult(w, pyResult.watch[i], 'watch'));
  const avoidFinal = avoid.map((a, i) => buildSectorResult(a, pyResult.avoid[i], 'avoid'));

  // 汇总
  const allSectors = [...watchFinal, ...avoidFinal];
  const sectorMapped = allSectors.filter(s => !s.unmapped && s.change_pct !== undefined);
  const sectorHitCount = sectorMapped.filter(s => s.hit).length;

  const stockHitCount = allSectors.reduce((sum, s) => sum + (s.stock_hit ?? 0), 0);
  const stockTotal = allSectors.reduce((sum, s) => sum + (s.stock_total ?? 0), 0);

  const result: ReviewResult = {
    target_date: date,
    hs300_pct: pyResult.hs300_pct,
    watch: watchFinal,
    avoid: avoidFinal,
    hit_count: sectorHitCount,
    total_mapped: sectorMapped.length,
    hit_rate: `${sectorHitCount}/${sectorMapped.length}`,
    stock_hit_count: stockHitCount,
    stock_total: stockTotal,
    stock_hit_rate: `${stockHitCount}/${stockTotal}`,
    thresholds: { sector: SECTOR_HIT_THRESHOLD, stock: STOCK_HIT_THRESHOLD },
  };

  // 5. 写回 DB
  await sb.from('dailyReport').update({
    recommended_sectors: watch,
    avoid_sectors: avoid,
    review_result: result,
  }).eq('report_date', date);

  console.log(
    `  [review] ${date} 完成：板块 ${result.hit_rate}（阈值±${SECTOR_HIT_THRESHOLD}%），` +
    `个股 ${result.stock_hit_rate}（阈值±${STOCK_HIT_THRESHOLD}%），沪300 ${result.hs300_pct}%`
  );
  return result;
}

// ===== 批量回测 =====
async function backfill(days: number, force: boolean): Promise<void> {
  const sb = getSupabase();
  const today = getTodayBJ();

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

// ===== CLI =====
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
    const yesterday = addDays(getTodayBJ(), -1);
    console.log(`[review] 未指定 --date，默认回测昨日 ${yesterday}`);
    await reviewOneDay(yesterday, force, dryRun);
  }
  process.exit(0);
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch(err => {
    console.error('[review] 致命错误:', err);
    process.exit(1);
  });
}
