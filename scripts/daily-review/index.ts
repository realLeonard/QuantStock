/**
 * 每日复盘 — AI 总结生成 + WxPusher 推送
 *
 * 执行方式：npx tsx scripts/daily-review/index.ts [--date YYYY-MM-DD]
 *
 * 流程：
 * 1. 从 dailyReview 表读取当日采集数据
 * 2. 调用 Claude Opus 生成完整复盘总结
 * 3. 回写 ai_summary 字段
 * 4. 渲染 Markdown → WxPusher 推送
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// 加载环境变量
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '../../apps/web/.env.local');
dotenv.config({ path: envPath });
dotenv.config();

// ===== 工具函数 =====

function getBeijingDateStr(): string {
  const offset = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offset).toISOString().slice(0, 10);
}

function parseArgs(): { date: string } {
  const args = process.argv.slice(2);
  const dateIdx = args.findIndex(a => a === '--date');
  if (dateIdx !== -1 && args[dateIdx + 1]) {
    return { date: args[dateIdx + 1] };
  }
  return { date: getBeijingDateStr() };
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !key) throw new Error('缺少 Supabase 环境变量');
  return createClient(url, key);
}

// ===== 从 DB 读取当日复盘数据 =====

interface DailyReviewData {
  id: string;
  report_date: string;
  market_overview: Record<string, unknown> | null;
  market_sentiment: Record<string, unknown> | null;
  hot_stocks: Record<string, unknown>[] | null;
  limit_up_ladder: Record<string, unknown>[] | null;
  dragon_tiger: Record<string, unknown>[] | null;
  industry_distribution: Record<string, unknown>[] | null;
  limit_industry_distribution: Record<string, unknown>[] | null;
  sector_fund_flow: Record<string, unknown> | null;
  stock_fund_flow: Record<string, unknown> | null;
  ai_summary: string | null;
  status: string;
}

async function loadReviewData(date: string): Promise<DailyReviewData | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('dailyReview')
    .select('*')
    .eq('report_date', date)
    .single();
  if (error || !data) return null;
  return data as DailyReviewData;
}

// ===== AI 总结生成 =====

const SYSTEM_PROMPT = `你是一位资深 A 股投资分析师，每天收盘后需要为投资者撰写复盘报告。

要求：
1. 基于提供的市场数据（大盘指数、情绪指标、热门股、连板天梯、龙虎榜、行业分布、资金流向等），生成一份结构化的完整复盘分析
2. 分析要有深度，不是简单罗列数据，而是解读数据背后的含义
3. 融资余额趋势要给出解读（增加=杠杆资金看多入场，减少=去杠杆避险）
4. 最后要给出明日关注方向和风险提示

输出格式（使用以下标题结构）：
【大盘】指数表现、量能变化、关键支撑/压力位分析
【资金】北向资金动向、融资余额趋势解读、内外资是否共振
【主线】当日最强主线板块、连板高度、板块持续性分析
【情绪】涨跌停数据解读、炸板率含义、赚钱效应强弱
【龙虎榜】主力资金重点介入/撤离的方向
【资金流向】板块和个股资金流向趋势、10日持续性分析
【关注】明日重点观察方向、风险提示`;

async function generateAiSummary(data: DailyReviewData): Promise<string> {
  const token = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? undefined;
  if (!token) throw new Error('缺少 ANTHROPIC_AUTH_TOKEN 环境变量');

  const client = new Anthropic({
    apiKey: token,
    baseURL,
  });

  // 组装数据摘要给 Claude
  const userContent = JSON.stringify({
    date: data.report_date,
    market_overview: data.market_overview,
    market_sentiment: data.market_sentiment,
    hot_stocks: data.hot_stocks?.slice(0, 10),
    limit_up_ladder: data.limit_up_ladder,
    dragon_tiger: data.dragon_tiger?.slice(0, 15),
    industry_distribution: data.industry_distribution?.slice(0, 15),
    limit_industry_distribution: data.limit_industry_distribution?.slice(0, 15),
    sector_fund_flow: data.sector_fund_flow,
    stock_fund_flow: data.stock_fund_flow,
  }, null, 2);

  console.log('  [ai] 调用 Claude Opus 生成复盘总结...');

  const res = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: `以下是 ${data.report_date} 的 A 股收盘数据，请撰写完整的每日复盘分析：\n\n${userContent}` },
    ],
  });

  const textBlock = res.content.find(b => b.type === 'text');
  return textBlock?.text ?? '';
}

// ===== WxPusher 推送 =====

async function sendWxPush(content: string, summary: string): Promise<void> {
  const token = process.env.WXPUSHER_TOKEN;
  const uidsRaw = process.env.WXPUSHER_UID;
  if (!token || !uidsRaw) {
    console.warn('  [notify] 未配置 WXPUSHER_TOKEN / WXPUSHER_UID，跳过推送');
    return;
  }
  const uids = uidsRaw.split(',').map(u => u.trim()).filter(Boolean);

  // 粗体转斜体（黑色背景下粗体颜色不可见）
  const pushContent = content.replace(/\*\*(.+?)\*\*/g, '_$1_');

  console.log(`  [notify] 推送到 ${uids.length} 位用户...`);
  const res = await axios.post('https://wxpusher.zjiecode.com/api/send/message', {
    appToken: token,
    content: pushContent,
    summary: summary.slice(0, 100),
    contentType: 3,
    uids,
  }, { timeout: 10000 });

  if (res.data.success) {
    const ok = res.data.data?.filter((d: Record<string, unknown>) => d.code === 1000).length ?? 0;
    console.log(`  [notify] 推送成功，${ok}/${uids.length} 位用户收到`);
  } else {
    console.error(`  [notify] 推送失败: ${res.data.msg}`);
  }
}

// ===== 渲染推送 Markdown =====

function renderPushMarkdown(data: DailyReviewData): string {
  const lines: string[] = [];
  lines.push(`# ${data.report_date} 每日复盘\n`);

  // 大盘概览
  const ov = data.market_overview as Record<string, unknown> | null;
  if (ov) {
    lines.push('## 大盘概览\n');
    const indices = (ov.indices ?? []) as Record<string, unknown>[];
    for (const idx of indices) {
      const pct = Number(idx.change_pct ?? 0);
      const arrow = pct > 0 ? '🔴' : pct < 0 ? '🟢' : '⚪';
      lines.push(`${arrow} **${idx.name}** ${idx.close} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)`);
    }
    const nb = ov.north_bound as Record<string, number> | null;
    if (nb?.today != null) lines.push(`\n北向资金: ${nb.today > 0 ? '+' : ''}${nb.today}亿 | 近5日: ${nb.recent_5d ?? '-'}亿`);
    const margin = ov.margin as Record<string, number> | null;
    if (margin?.balance != null) lines.push(`融资余额: ${margin.balance}亿 (${margin.change > 0 ? '+' : ''}${margin.change}亿)`);
    lines.push('');
  }

  // 市场情绪
  const st = data.market_sentiment as Record<string, number> | null;
  if (st) {
    lines.push('## 市场情绪\n');
    lines.push(`涨/跌: ${st.up_count}/${st.down_count} | 涨停 ${st.limit_up} 跌停 ${st.limit_down} | 炸板 ${st.broken_limit} (${st.broken_rate}%)`);
    lines.push(`强势股(>7%): ${st.strong_stocks} | 弱势股(<-7%): ${st.weak_stocks}`);
    lines.push('');
  }

  // 连板天梯
  if (data.limit_up_ladder?.length) {
    lines.push('## 连板天梯\n');
    for (const item of data.limit_up_ladder as Record<string, unknown>[]) {
      lines.push(`${item.continuous_limit}板 **${item.name}** (${item.code}) ${(item.industries as string[])?.join('/')}`);
    }
    lines.push('');
  }

  // 龙虎榜
  if (data.dragon_tiger?.length) {
    lines.push('## 龙虎榜\n');
    for (const item of (data.dragon_tiger as Record<string, unknown>[]).slice(0, 10)) {
      const net = Number(item.net_amount ?? 0);
      lines.push(`**${item.name}** 净额${net > 0 ? '+' : ''}${net.toFixed(0)}万 | ${item.reason}`);
    }
    lines.push('');
  }

  // 板块资金流向
  const sf = data.sector_fund_flow as Record<string, unknown> | null;
  if (sf) {
    const inflow = (sf.inflow ?? []) as Record<string, unknown>[];
    const outflow = (sf.outflow ?? []) as Record<string, unknown>[];
    if (inflow.length || outflow.length) {
      lines.push('## 板块资金流向\n');
      if (inflow.length) {
        lines.push('**流入**: ' + inflow.slice(0, 5).map(i => `${i.sector}(${Number(i.net_amount).toFixed(1)}亿)`).join(' | '));
      }
      if (outflow.length) {
        lines.push('**流出**: ' + outflow.slice(0, 5).map(i => `${i.sector}(${Number(i.net_amount).toFixed(1)}亿)`).join(' | '));
      }
      lines.push('');
    }
  }

  // AI 总结
  if (data.ai_summary) {
    lines.push('## AI 复盘总结\n');
    lines.push(data.ai_summary);
    lines.push('');
  }

  return lines.join('\n');
}

// ===== 主流程 =====

async function main() {
  const { date } = parseArgs();
  console.log(`====== 每日复盘 AI 总结 + 推送 ======`);
  console.log(`  日期: ${date}`);
  console.log();

  // 1. 读取当日数据
  console.log('[1/3] 读取 dailyReview 数据...');
  const data = await loadReviewData(date);
  if (!data) {
    console.error(`  ✗ 未找到 ${date} 的复盘数据，请先运行 Python 采集脚本`);
    process.exit(1);
  }
  console.log(`  ✓ 状态: ${data.status}`);

  // 2. 生成 AI 总结
  if (!data.ai_summary) {
    console.log('[2/3] 生成 AI 复盘总结...');
    try {
      const summary = await generateAiSummary(data);
      data.ai_summary = summary;

      // 回写到数据库
      const sb = getSupabase();
      const { error } = await sb
        .from('dailyReview')
        .update({ ai_summary: summary })
        .eq('id', data.id);
      if (error) {
        console.error(`  [warn] 回写 ai_summary 失败: ${error.message}`);
      } else {
        console.log(`  ✓ AI 总结已生成并保存（${summary.length} 字）`);
      }
    } catch (e) {
      console.error(`  ✗ AI 总结生成失败: ${(e as Error).message}`);
    }
  } else {
    console.log('[2/3] AI 总结已存在，跳过生成');
  }

  // 3. WxPusher 推送
  console.log('[3/3] 推送到微信...');
  try {
    const markdown = renderPushMarkdown(data);
    const pushSummary = `📊 ${date} 投资复盘 | 涨停${(data.market_sentiment as Record<string, number>)?.limit_up ?? '-'}家`;
    await sendWxPush(markdown, pushSummary);
    console.log('  ✓ 推送完成');
  } catch (e) {
    console.error(`  ✗ 推送失败: ${(e as Error).message}`);
  }

  console.log();
  console.log('====== 完成 ======');
}

main().catch(e => {
  console.error('执行失败:', e);
  process.exit(1);
});
