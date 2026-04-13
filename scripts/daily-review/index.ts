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
  ths_hot_stocks: Record<string, unknown>[] | null;
  ths_hot_concepts: Record<string, unknown>[] | null;
  ths_hot_industries: Record<string, unknown>[] | null;
  limit_analysis: Record<string, unknown> | null;
  ai_summary: string | null;
  ai_analysis: Record<string, unknown> | null;
  status: string;
}

interface AiAnalysis {
  headline: string;
  sentiment_stage: string;
  sentiment_score: number;
  main_themes: Array<{
    name: string;
    strength: string;
    logic: string;
    leader_stocks: string[];
    related_data: string;
    continuation: string;
  }>;
  signals: Array<{
    type: string;
    content: string;
  }>;
  outlook: {
    direction: string;
    focus_areas: string[];
    risk_warnings: string[];
  };
  full_text: string;
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

你必须返回严格的 JSON 格式，不要包含任何 JSON 之外的内容（不要包含 markdown 代码块标记）。

JSON 结构如下：
{
  "headline": "一句话概括今日市场（20字以内）",
  "sentiment_stage": "升温 | 高潮 | 退潮 | 冰点 | 修复（选一个最匹配的）",
  "sentiment_score": 1到10的整数（1=极度恐慌，5=中性，10=极度贪婪），
  "main_themes": [
    {
      "name": "主线名称（如 CPO/光模块）",
      "strength": "强 | 中 | 弱",
      "logic": "该主线的核心驱动逻辑（1-2句）",
      "leader_stocks": ["龙头股名称1", "龙头股名称2"],
      "related_data": "关联数据佐证（如连板数、龙虎榜净买入等）",
      "continuation": "持续性判断和明日操作建议"
    }
  ],
  "signals": [
    {
      "type": "机构抢筹 | 游资接力 | 主力撤退 | 新题材 | 风险",
      "content": "具体信号描述"
    }
  ],
  "outlook": {
    "direction": "偏多 | 中性 | 偏空",
    "focus_areas": ["明日关注方向1", "明日关注方向2"],
    "risk_warnings": ["风险提示1", "风险提示2"]
  },
  "full_text": "完整的文字版复盘分析报告（包含【大盘】【资金】【主线】【情绪】【龙虎榜】【资金流向】【关注】各段落，每个段落之间用换行分隔）"
}

分析要求：
1. main_themes 提取 2-3 条当日最强主线，结合同花顺热门概念/行业数据综合判断
2. signals 提取 3-5 条关键异动信号，从龙虎榜、资金流向、热门股中挖掘
3. full_text 要有深度分析，不是简单罗列数据，融资余额趋势要解读（增加=杠杆资金看多入场，减少=去杠杆避险）
4. sentiment_score 要综合涨跌家数、涨停数、炸板率、成交量等多维度判断
5. 所有字段必须填写，不能为空
6. 打板分析数据（limit_analysis）的解读要点：
   - 溢价率（premium_rate）：昨日涨停股今日有溢价的比例，>60% 表示情绪良好，<40% 表示亏钱效应显著
   - 平均溢价（avg_premium）：>3% 说明打板盈利丰厚，<0 说明打板亏损
   - 晋级率（promotion.rate）：昨日涨停→今日继续涨停的比例，>25% 说明连板接力氛围好，<15% 说明高度受限
   - 封单总额（seal_stats.total_seal_fund）：反映做多资金决心，越大越好
   - 一字板数（yizi_count）：反映市场一致性预期的强度
   - 早盘封板数（early_seal_count）：早盘封板多说明资金抢筹意愿强
7. 如果提供了 sentiment_history（近几日情绪分数），需要结合历史趋势判断情绪方向：
   - 连续上升 → 情绪升温
   - 高位回落 → 退潮信号
   - 低位企稳 → 冰点修复
   - 在 full_text 中要提及情绪趋势变化`;

async function generateAiAnalysis(
  data: DailyReviewData
): Promise<{ analysis: AiAnalysis; fullText: string }> {
  const token = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? undefined;
  if (!token) throw new Error('缺少 ANTHROPIC_AUTH_TOKEN 环境变量');

  const client = new Anthropic({
    apiKey: token,
    baseURL,
  });

  // 查询最近 5 天情绪历史
  let sentimentHistory: Array<{ date: string; score: number; stage: string }> = [];
  try {
    const sb = getSupabase();
    const { data: recentRows } = await sb
      .from('dailyReview')
      .select('report_date, ai_analysis')
      .lt('report_date', data.report_date)
      .order('report_date', { ascending: false })
      .limit(5);

    if (recentRows?.length) {
      sentimentHistory = recentRows
        .filter((r: Record<string, unknown>) => r.ai_analysis)
        .map((r: Record<string, unknown>) => {
          const ai = r.ai_analysis as Record<string, unknown>;
          return {
            date: r.report_date as string,
            score: ai.sentiment_score as number,
            stage: ai.sentiment_stage as string,
          };
        })
        .reverse(); // 按日期升序
    }
  } catch (e) {
    console.warn(`  [warn] 查询情绪历史失败: ${(e as Error).message}`);
  }

  // 组装数据摘要给 Claude（含打板分析 + 情绪历史）
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
    ths_hot_concepts: data.ths_hot_concepts?.slice(0, 15),
    ths_hot_industries: data.ths_hot_industries?.slice(0, 15),
    limit_analysis: data.limit_analysis,
    sentiment_history: sentimentHistory.length ? sentimentHistory : undefined,
  }, null, 2);

  console.log('  [ai] 调用 Claude Opus 生成结构化复盘分析...');

  const res = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `以下是 ${data.report_date} 的 A 股收盘数据，请返回结构化 JSON 分析：\n\n${userContent}`,
      },
    ],
  });

  const textBlock = res.content.find(b => b.type === 'text');
  const rawText = textBlock?.text ?? '';

  // 解析 JSON（兼容 Claude 可能包裹 ```json ... ``` 的情况）
  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  const analysis = JSON.parse(jsonStr) as AiAnalysis;

  return { analysis, fullText: analysis.full_text };
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

  // 标题全部降级为加粗（微信端 # ## 渲染字体过大）
  const pushContent = content
    .replace(/^#{1,3} (.+)$/gm, '**$1**');

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
  const ai = data.ai_analysis as AiAnalysis | null;

  // 没有 AI 分析时的降级展示
  if (!ai) {
    lines.push(`# ${data.report_date} 每日复盘\n`);
    if (data.ai_summary) {
      lines.push(data.ai_summary);
    } else {
      lines.push('AI 分析尚未生成');
    }
    return lines.join('\n');
  }

  // 情绪 + headline
  lines.push(`> ${ai.headline}\n`);
  const filled = '█'.repeat(ai.sentiment_score);
  const empty = '░'.repeat(10 - ai.sentiment_score);
  lines.push(`情绪: ${filled}${empty} *${ai.sentiment_stage}* ${ai.sentiment_score}/10\n`);

  // 核心指标一行流
  const metrics: string[] = [];
  const st = data.market_sentiment as Record<string, number> | null;
  const ov = data.market_overview as Record<string, unknown> | null;
  const volume = (ov?.volume ?? null) as Record<string, number> | null;
  const nb = (ov?.north_bound ?? null) as Record<string, number> | null;
  const la = data.limit_analysis as Record<string, unknown> | null;
  const ps = (la?.premium_summary ?? null) as Record<string, number> | null;
  const pm = (la?.promotion ?? null) as Record<string, unknown> | null;
  const ss = (la?.seal_stats ?? null) as Record<string, number> | null;

  if (st) {
    metrics.push(`涨停 ${st.limit_up} | 跌停 ${st.limit_down} | 炸板率 ${st.broken_rate}%`);
  }
  if (volume?.today != null) metrics.push(`成交 ${volume.today}亿`);
  if (nb?.today != null) metrics.push(`北向 ${nb.today > 0 ? '+' : ''}${nb.today}亿`);
  if (ps?.premium_rate != null) metrics.push(`溢价率 ${ps.premium_rate}%`);
  if (pm?.rate != null) metrics.push(`晋级率 ${pm.rate}%`);
  if (ss?.total_seal_fund != null) metrics.push(`封单 ${ss.total_seal_fund}亿`);
  if (metrics.length) {
    lines.push(metrics.join(' | '));
    lines.push('');
  }

  // 主线分析
  if (ai.main_themes?.length) {
    lines.push('━━━ 🎯 主线分析 ━━━\n');
    for (const theme of ai.main_themes) {
      const leaders = theme.leader_stocks?.length
        ? `（${theme.leader_stocks.join('、')}）`
        : '';
      const strengthIcon: Record<string, string> = {
        '强': '🔴', '中': '🟡', '弱': '🔵',
      };
      const icon = strengthIcon[theme.strength] ?? '⚪';
      lines.push(`${icon} *${theme.name}*【${theme.strength}】${leaders}`);
      lines.push(`${theme.logic}`);
      if (theme.continuation) lines.push(`→ ${theme.continuation}`);
      lines.push('');
    }
  }

  // 异动信号
  if (ai.signals?.length) {
    lines.push('━━━ ⚡ 异动信号 ━━━\n');
    for (const sig of ai.signals) {
      const icon: Record<string, string> = {
        '机构抢筹': '🏛', '游资接力': '🔥', '主力撤退': '📉',
        '新题材': '✨', '风险': '⚠',
      };
      lines.push(`${icon[sig.type] ?? '📌'} *${sig.type}*: ${sig.content}`);
    }
    lines.push('');
  }

  // 明日展望
  if (ai.outlook) {
    lines.push('━━━ 🔮 明日展望 ━━━\n');
    lines.push(`方向: *${ai.outlook.direction}*\n`);
    if (ai.outlook.focus_areas?.length) {
      lines.push('关注:');
      for (const area of ai.outlook.focus_areas) {
        lines.push(`• ${area}`);
      }
      lines.push('');
    }
    if (ai.outlook.risk_warnings?.length) {
      lines.push('风险:');
      for (const warn of ai.outlook.risk_warnings) {
        lines.push(`• ${warn}`);
      }
      lines.push('');
    }
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

  // 2. 生成 AI 结构化分析
  if (!data.ai_analysis) {
    console.log('[2/3] 生成 AI 结构化复盘分析...');
    try {
      const { analysis, fullText } = await generateAiAnalysis(data);
      data.ai_analysis = analysis as unknown as Record<string, unknown>;
      data.ai_summary = fullText;

      // 回写到数据库（同时写入 ai_analysis 和 ai_summary）
      const sb = getSupabase();
      const { error } = await sb
        .from('dailyReview')
        .update({
          ai_analysis: analysis,
          ai_summary: fullText,
        })
        .eq('id', data.id);
      if (error) {
        console.error(`  [warn] 回写 ai_analysis 失败: ${error.message}`);
      } else {
        console.log(`  ✓ AI 结构化分析已生成并保存`);
        console.log(`    headline: ${analysis.headline}`);
        console.log(`    情绪: ${analysis.sentiment_stage}（${analysis.sentiment_score}/10）`);
        console.log(`    主线: ${analysis.main_themes.map(t => t.name).join('、')}`);
        console.log(`    full_text: ${fullText.length} 字`);
      }
    } catch (e) {
      console.error(`  ✗ AI 分析生成失败: ${(e as Error).message}`);
    }
  } else {
    console.log('[2/3] AI 分析已存在，跳过生成');
  }

  // 3. WxPusher 推送
  console.log('[3/3] 推送到微信...');
  try {
    const markdown = renderPushMarkdown(data);
    const aiObj = data.ai_analysis as AiAnalysis | null;
    let pushSummary = `📊 ${date} 投资复盘`;
    if (aiObj) {
      const stData = data.market_sentiment as Record<string, number> | null;
      const parts = [aiObj.headline];
      parts.push(`情绪${aiObj.sentiment_stage}(${aiObj.sentiment_score}/10)`);
      if (stData) {
        parts.push(`涨停${stData.limit_up}家 炸板率${stData.broken_rate}%`);
      }
      pushSummary = `📊 ${date} 投资复盘｜${parts.join('｜')}`;
    }
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
