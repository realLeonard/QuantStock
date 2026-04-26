/**
 * 早报生成脚本
 * 读取 Supabase rawMarketData + newsItems + marketBreadth → 调用 Claude API → 存入 dailyReport 表
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';
import { formatReviewForZaobao, type DailyReviewRow, type LimitUpReasonsRow } from './formatters/review-data';
import { loadHistoryBaseline, loadSectorContinuity } from './formatters/review-queries';
import { loadYesterdayReviewBlock, loadRecentHitRate } from './formatters/review-result';
import { reviewOneDay } from './review-picks';
import { sendBarkAlert } from './utils/bark';
import { isTradingDay } from '../shared/trading-calendar';
import { callClaude } from './utils/claude-cli';

// ===== 环境变量 =====
function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url) throw new Error('缺少环境变量：NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('缺少环境变量：NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return { url, key };
}

function getSupabase() {
  const { url, key } = getEnv();
  return createClient(url, key);
}

// ===== 时间工具 =====

/** 返回今日日期字符串（北京时间，格式：YYYY-MM-DD） */
function getTodayBJ(): string {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}

/** 返回 date 日期 HH:MM 北京时间对应的 UTC 毫秒 */
function bjDateTimeToUtcMs(date: string, hour: number, minute: number): number {
  // 北京时间 = UTC+8，所以减8小时得 UTC
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).getTime();
}

/** 对日期字符串做加减天数（纯日历运算，无时区偏差） */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// ===== 查询最近一个有 A 股数据的交易日 =====
async function getLastTradingDate(beforeDate: string): Promise<string> {
  const sb = getSupabase();
  const { data } = await sb
    .from('rawMarketData')
    .select('data_date')
    .eq('data_type', 'a_share')
    .lt('data_date', beforeDate)
    .order('data_date', { ascending: false })
    .limit(1)
    .single();
  return data?.data_date ?? beforeDate;
}

// ===== 读取市场行情数据（rawMarketData 表）=====
async function loadRawData(date: string): Promise<{
  aShareData: Record<string, unknown>;
  intlData: Record<string, unknown>;
  macroData: Record<string, unknown>;
}> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from('rawMarketData')
    .select('*')
    .eq('data_date', date);

  if (error) throw new Error(`读取原始数据失败: ${error.message}`);

  const rows = data ?? [];
  const aShareData: Record<string, unknown> = {};
  const intlData: Record<string, unknown> = {};
  const macroData: Record<string, unknown> = {};

  for (const row of rows) {
    if (row.data_type === 'a_share') {
      Object.assign(aShareData, row.payload);
    } else if (row.data_type === 'intl_market') {
      Object.assign(intlData, row.payload);
    } else if (row.data_type === 'macro') {
      Object.assign(macroData, row.payload);
    }
  }

  return { aShareData, intlData, macroData };
}

// ===== 从 newsItems_cls 查询新闻窗口数据 =====
async function loadNewsItems(date: string, reportType: 'trading' | 'weekly'): Promise<{
  priority: Array<Record<string, unknown>>;
  flash: Array<Record<string, unknown>>;
}> {
  const sb = getSupabase();

  let windowStart: number;
  let windowEnd: number;

  // 用北京时间正午判断星期，避免 UTC 时区偏差导致误判
  const dayOfWeek = new Date(`${date}T12:00:00+08:00`).getDay(); // 0=周日, 1=周一

  if (reportType === 'weekly') {
    // 周报窗口：周五 15:00 BJ（A股收盘）→ 周日 18:00 BJ
    const friday = addDays(date, -2);
    windowStart = bjDateTimeToUtcMs(friday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 18, 0);
    console.log(`  [generate] 周报新闻窗口: ${friday} 15:00 BJ → ${date} 18:00 BJ`);
  } else if (dayOfWeek === 1) {
    // 周一：覆盖整个周末，周五 15:00 BJ → 今日 08:00 BJ
    const friday = addDays(date, -3);
    windowStart = bjDateTimeToUtcMs(friday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 8, 20);
    console.log(`  [generate] 周一新闻窗口: ${friday} 15:00 BJ → ${date} 08:20 BJ`);
  } else {
    // 普通交易日窗口：昨日 15:00 BJ（A股收盘后）→ 今日 08:20 BJ
    const yesterday = addDays(date, -1);
    windowStart = bjDateTimeToUtcMs(yesterday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 8, 20);
    console.log(`  [generate] 普通交易日新闻窗口: ${yesterday} 15:00 BJ → ${date} 08:20 BJ`);
  }

  const { data, error } = await sb
    .from('newsItems_cls')
    .select('title, summary, categories, level, published_at')
    .gte('published_at', windowStart)
    .lte('published_at', windowEnd)
    .order('published_at', { ascending: false });

  if (error) {
    console.warn(`  [generate] 读取 newsItems_cls 失败: ${error.message}`);
    return { priority: [], flash: [] };
  }

  const rows = data ?? [];

  const levelOrder = (l: unknown) => l === 'A' ? 0 : l === 'B' ? 1 : 2;
  const byLevelThenTime = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    levelOrder(a.level) - levelOrder(b.level) || Number(b.published_at) - Number(a.published_at);

  // A 级新闻传标题+摘要，其余只传标题
  const priority = rows.filter(r => r.level === 'A').sort(byLevelThenTime);
  const flash = rows.filter(r => r.level !== 'A').sort(byLevelThenTime);

  console.log(`  [generate] newsItems_cls 窗口内共 ${rows.length} 条：A级(含摘要)${priority.length} 其他(仅标题)${flash.length}`);

  return { priority, flash };
}

// ===== 读取近7日涨跌家数（marketBreadth 表）=====
async function loadMarketBreadth(): Promise<Array<Record<string, unknown>>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('marketBreadth')
    .select('trade_date, rise, fall, flat, limit_up, limit_down')
    .order('trade_date', { ascending: false })
    .limit(7);

  if (error) {
    console.warn(`  [generate] 读取 marketBreadth 失败: ${error.message}`);
    return [];
  }
  return (data ?? []).reverse(); // 改为升序（旧→新）方便展示趋势
}

// ===== 读取昨日复盘数据 + 涨停简图（用于结构化数据块）=====
async function loadReviewData(beforeDate: string): Promise<{
  review: DailyReviewRow | null;
  limitUp: LimitUpReasonsRow | null;
  reviewDate: string | null;
}> {
  const sb = getSupabase();

  // 1. 查 beforeDate（含）之前最近一条 status='success' 的复盘
  const { data: reviewRow, error: reviewErr } = await sb
    .from('dailyReview')
    .select('report_date, market_overview, market_sentiment, limit_up_ladder, limit_analysis, sector_fund_flow, stock_fund_flow, ths_hot_concepts, ths_hot_industries, dragon_tiger, hot_money_moves, margin_data')
    .lte('report_date', beforeDate)
    .eq('status', 'success')
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reviewErr) {
    console.warn(`  [generate] 读取 dailyReview 失败: ${reviewErr.message}`);
    return { review: null, limitUp: null, reviewDate: null };
  }
  if (!reviewRow) {
    console.warn(`  [generate] 未找到 ${beforeDate} 之前的复盘数据`);
    return { review: null, limitUp: null, reviewDate: null };
  }

  const reviewDate = reviewRow.report_date as string;
  console.log(`  [generate] 使用 ${reviewDate} 的复盘数据`);

  // 2. 查同日 limitUpReasons
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

// ===== 读取昨日早报摘要（用于预判验证）=====
async function loadPreviousSummary(date: string): Promise<string | undefined> {
  const sb = getSupabase();
  const { data } = await sb
    .from('dailyReport')
    .select('summary, report_date')
    .lt('report_date', date)
    .order('report_date', { ascending: false })
    .limit(1)
    .single();

  return data?.summary ?? undefined;
}

// ===== 交易日判断（公共模块，含法定节假日） =====
const isTradeDay = isTradingDay;

// ===== 调用 Claude CLI 生成报告 =====
async function generateReport(params: {
  date: string;
  reportType: 'trading' | 'weekly';
  aShareData: Record<string, unknown>;
  intlData: Record<string, unknown>;
  macroData: Record<string, unknown>;
  newsItems: { priority: Array<Record<string, unknown>>; flash: Array<Record<string, unknown>> };
  breadthHistory: Array<Record<string, unknown>>;
  previousSummary?: string;
  reviewMarkdown?: string;
  historyBaseline?: string;
  sectorContinuity?: string;
  yesterdayReviewBlock?: string;
  recentHitRate?: string;
}): Promise<{ content: string; summary: string }> {
  const userPrompt = buildUserPrompt(params);
  const fullPrompt = `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;

  console.log(`  [Claude] 调用 Claude CLI 生成报告，prompt ${fullPrompt.length} 字符...`);
  const content = callClaude(fullPrompt, 'zaobao-generate');

  // 提取①市场基调作为摘要（兼容 **加粗** 标记）
  const summaryMatch = content.match(/①\s*\*{0,2}【市场基调】\*{0,2}([^\n]+)/);
  let summary: string;
  if (summaryMatch) {
    summary = summaryMatch[1].replace(/\*\*/g, '').trim();
    if (summary.length < 50) {
      const afterIdx = content.indexOf(summaryMatch[0]) + summaryMatch[0].length;
      const remaining = content.slice(afterIdx).split('\n');
      for (const line of remaining) {
        const cleaned = line.replace(/\*\*/g, '').replace(/^[②③④⑤⑥⑦⑧⑨⑩]\s*/, '').replace(/【.*?】/g, '').trim();
        if (cleaned.length > 10 && !/^[━─\-*#>|]/.test(cleaned)) {
          summary += '。' + cleaned;
          if (summary.length >= 120) break;
        }
      }
      summary = summary.slice(0, 200);
    }
  } else {
    summary = content.replace(/\*\*/g, '').slice(0, 120);
  }

  return { content, summary };
}

// ===== 保存报告 =====
async function saveReport(params: {
  date: string;
  reportType: 'trading' | 'weekly';
  content: string;
  summary: string;
}): Promise<void> {
  const sb = getSupabase();

  const record = {
    id: randomUUID(),
    report_date: params.date,
    report_type: params.reportType,
    content: params.content,
    summary: params.summary,
    created_at: Date.now(),
  };

  const { error } = await sb
    .from('dailyReport')
    .upsert(record, { onConflict: 'report_date' });

  if (error) throw new Error(`保存报告失败: ${error.message}`);
}

// ===== 主函数 =====
export async function generateDailyReport(date: string): Promise<void> {
  console.log(`\n[generate] 开始生成 ${date} 早报...`);

  getEnv();

  // 提前判断报告类型
  const reportType = isTradeDay(date) ? 'trading' : 'weekly';
  console.log(`  [generate] 报告类型: ${reportType === 'trading' ? '交易日早报' : '周日周报'}`);

  // ===== Step 0: T-1 板块回测（失败不阻塞） =====
  const yesterdayForReview = addDays(date, -1);
  let yesterdayReviewBlock: string | undefined;
  let recentHitRate: string | undefined;
  try {
    console.log(`  [generate] 执行 T-1 板块回测（${yesterdayForReview}）...`);
    await reviewOneDay(yesterdayForReview, false);
    const sb = getSupabase();
    const [block, rate] = await Promise.all([
      loadYesterdayReviewBlock(sb, date),
      loadRecentHitRate(sb, date, 7),
    ]);
    yesterdayReviewBlock = block ?? undefined;
    recentHitRate = rate ?? undefined;
    if (recentHitRate) console.log(`  [generate] ${recentHitRate}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`  [generate] T-1 回测失败（跳过注入，主流程继续）:`, errMsg);
    await sendBarkAlert('早报板块回测失败', `${yesterdayForReview}: ${errMsg.slice(0, 200)}`);
  }

  // 读取原始市场数据（周报取最近一个交易日数据）
  let dataDate = date;
  if (reportType === 'weekly') {
    dataDate = await getLastTradingDate(date);
    console.log(`  [generate] 周报：使用 ${dataDate}（上一交易日）的市场行情数据`);
  }
  console.log('  [generate] 读取市场行情数据...');
  const { aShareData, intlData, macroData } = await loadRawData(dataDate);

  const hasData = Object.keys(aShareData).length > 0 || Object.keys(intlData).length > 0;
  if (!hasData) {
    console.warn(`  [generate] 警告：${dataDate} 无市场数据，可能采集未完成`);
  }

  // 读取新闻（周报使用周五15:00→周日18:00窗口）
  console.log('  [generate] 读取新闻数据（newsItems_cls）...');
  const newsItems = await loadNewsItems(date, reportType);

  // 读取近7日涨跌趋势
  console.log('  [generate] 读取近7日涨跌家数...');
  const breadthHistory = await loadMarketBreadth();

  // 读取昨日摘要
  const previousSummary = await loadPreviousSummary(date);

  // 读取昨日复盘数据 + 涨停简图（昨日客观盘面数据块主要来源）
  console.log('  [generate] 读取昨日复盘数据...');
  const { review, limitUp, reviewDate } = await loadReviewData(addDays(date, -1));

  // 基于复盘数据生成结构化数据块
  const reviewMarkdown = review ? formatReviewForZaobao(review, limitUp) : undefined;

  // 实时聚合：历史基线 + 板块延续性（基于复盘实际日期向前追溯）
  let historyBaseline: string | undefined;
  let sectorContinuity: string | undefined;
  if (reviewDate) {
    const sb = getSupabase();
    console.log('  [generate] 聚合历史基线 + 板块延续性...');
    [historyBaseline, sectorContinuity] = await Promise.all([
      loadHistoryBaseline(sb, reviewDate),
      loadSectorContinuity(sb, reviewDate),
    ]);
  }

  // 生成报告
  const { content, summary } = await generateReport({
    date,
    reportType,
    aShareData,
    intlData,
    macroData,
    newsItems,
    breadthHistory,
    previousSummary,
    reviewMarkdown,
    historyBaseline,
    sectorContinuity,
    yesterdayReviewBlock,
    recentHitRate,
  });

  // 保存
  console.log('  [generate] 保存报告到数据库...');
  await saveReport({ date, reportType, content, summary });

  console.log(`  [generate] 完成！报告已保存（${content.length} 字）`);
  console.log(`  [generate] 摘要：${summary.slice(0, 80)}...`);
}
