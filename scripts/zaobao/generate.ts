/**
 * 早报生成脚本
 * 读取 Supabase rawMarketData + newsItems + marketBreadth → 调用 Claude API → 存入 dailyReport 表
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts';

// ===== 环境变量 =====
function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url) throw new Error('缺少环境变量：NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('缺少环境变量：NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!process.env.ANTHROPIC_AUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('缺少环境变量：ANTHROPIC_AUTH_TOKEN');
  }
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

// ===== 从 newsItems 分级查询 20 小时窗口新闻 =====
async function loadNewsItems(date: string, reportType: 'trading' | 'weekly'): Promise<{
  cls_focus: Array<Record<string, unknown>>;
  cls_flash: Array<Record<string, unknown>>;
  cls_notice: Array<Record<string, unknown>>;
  em_flash: Array<Record<string, unknown>>;
  ths_flash: Array<Record<string, unknown>>;
  cctv: Array<Record<string, unknown>>;
}> {
  const sb = getSupabase();

  let windowStart: number;
  let windowEnd: number;

  if (reportType === 'weekly') {
    // 周报窗口：周五 15:00 BJ（A股收盘）→ 周日 18:00 BJ
    const friday = new Date(new Date(`${date}T00:00:00+08:00`).getTime() - 2 * 86400000)
      .toISOString()
      .slice(0, 10);
    windowStart = bjDateTimeToUtcMs(friday, 15, 0);
    windowEnd = bjDateTimeToUtcMs(date, 18, 0);
    console.log(`  [generate] 周报新闻窗口: ${friday} 15:00 BJ → ${date} 18:00 BJ`);
  } else {
    // 日报窗口：昨日 12:00 BJ → 今日 08:00 BJ
    const yesterday = new Date(new Date(`${date}T00:00:00+08:00`).getTime() - 86400000)
      .toISOString()
      .slice(0, 10);
    windowStart = bjDateTimeToUtcMs(yesterday, 12, 0);
    windowEnd = bjDateTimeToUtcMs(date, 8, 0);
  }

  const { data, error } = await sb
    .from('newsItems')
    .select('title, source, published_at')
    .gte('published_at', windowStart)
    .lte('published_at', windowEnd)
    .order('published_at', { ascending: false });

  if (error) {
    console.warn(`  [generate] 读取 newsItems 失败: ${error.message}`);
    return { cls_focus: [], cls_flash: [], cls_notice: [], em_flash: [], ths_flash: [], cctv: [] };
  }

  const rows = data ?? [];

  // 按来源分组，全量传入（由 Claude 判断重要性，不在此截断）
  const cls_focus = rows.filter(r => r.source === 'cls_focus');
  const cls_flash = rows.filter(r => r.source === 'cls_flash');
  const cls_notice = rows.filter(r => r.source === 'cls_notice');
  const em_flash = rows.filter(r => r.source === 'em_flash');
  const ths_flash = rows.filter(r => r.source === 'ths_flash');
  const cctv = rows.filter(r => r.source === 'cctv');

  const total = cls_focus.length + cls_flash.length + cls_notice.length + em_flash.length + ths_flash.length + cctv.length;
  console.log(`  [generate] newsItems 窗口内共 ${total} 条：重点${cls_focus.length} 快讯${cls_flash.length} 公告${cls_notice.length} 东财${em_flash.length} 同花顺${ths_flash.length} 央视${cctv.length}`);

  return { cls_focus, cls_flash, cls_notice, em_flash, ths_flash, cctv };
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

// ===== 判断是否为交易日 =====
function isTradeDay(date: string): boolean {
  const d = new Date(date);
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

// ===== 调用 Claude API 生成报告 =====
async function generateReport(params: {
  date: string;
  reportType: 'trading' | 'weekly';
  aShareData: Record<string, unknown>;
  intlData: Record<string, unknown>;
  macroData: Record<string, unknown>;
  newsItems: Record<string, Array<Record<string, unknown>>>;
  breadthHistory: Array<Record<string, unknown>>;
  previousSummary?: string;
}): Promise<{ content: string; summary: string }> {
  const client = new Anthropic();
  const userPrompt = buildUserPrompt(params);

  console.log('  [Claude] 调用 claude-sonnet-4-6 生成报告...');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: userPrompt }],
    system: SYSTEM_PROMPT,
  });

  const { input_tokens, output_tokens } = message.usage;
  const costUsd = (input_tokens * 3 + output_tokens * 15) / 1_000_000;
  console.log(`  [Claude] token 用量: input=${input_tokens} output=${output_tokens} 合计=${input_tokens + output_tokens} 约$${costUsd.toFixed(4)}`);

  const content = message.content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('\n');

  const summaryMatch = content.match(/━━━ 今日一句话 ━━━\n([\s\S]*?)(?=\n━━━|$)/);
  const summary = summaryMatch ? summaryMatch[1].trim() : content.slice(0, 100);

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
  console.log('  [generate] 读取新闻数据（newsItems）...');
  const newsItems = await loadNewsItems(date, reportType);

  // 读取近7日涨跌趋势
  console.log('  [generate] 读取近7日涨跌家数...');
  const breadthHistory = await loadMarketBreadth();

  // 读取昨日摘要
  const previousSummary = await loadPreviousSummary(date);

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
  });

  // 保存
  console.log('  [generate] 保存报告到数据库...');
  await saveReport({ date, reportType, content, summary });

  console.log(`  [generate] 完成！报告已保存（${content.length} 字）`);
  console.log(`  [generate] 摘要：${summary.slice(0, 80)}...`);
}
