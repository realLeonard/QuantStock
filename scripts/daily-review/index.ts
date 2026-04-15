/**
 * 每日复盘 — AI 总结生成 + WxPusher 推送（v2）
 *
 * 执行方式：npx tsx scripts/daily-review/index.ts [--date YYYY-MM-DD]
 *
 * v2 改造要点：
 *   - 引入韭研涨停原因（limitUpReasons）、游资席位字典（hotMoneySeats）、资讯预筛（filtered_news）
 *   - 昨日承接验证（读取上一交易日 ai_analysis）
 *   - 新的结构化 JSON schema（见 spec 6.2）
 *   - 推送渲染兼容 v1 / v2
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !key) throw new Error('缺少 Supabase 环境变量');
  return createClient(url, key);
}

// ===== 数据结构 =====

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
  filtered_news: Record<string, unknown>[] | null;
  hot_money_moves: Record<string, unknown>[] | null;
  margin_data: Record<string, unknown> | null;
  ai_summary: string | null;
  ai_analysis: Record<string, unknown> | null;
  status: string;
}

interface LimitUpReasons {
  pick_date: string;
  themes: Array<{
    name: string;
    count: number;
    stocks: Array<{
      board: string;
      code: string;
      name: string;
      time: string;
      float_mv: number | null;
      turnover_amt: number | null;
      keyword: string;
    }>;
  }>;
}

interface HotMoneySeat {
  id: string;
  nickname: string;
  seat_name: string;
  aliases: string[];
  tier: number;
}

// ----- AI v2 schema -----
interface AiAnalysisV2 {
  version: 'v2';
  headline: string;
  sentiment: {
    score: number;
    stage: string;
    width_conclusion: string;
    ladder_conclusion: string;
    profit_conclusion: string;
    style_conclusion: string;
    summary: string;
  };
  fund_picture: {
    dashboard_conclusion: string;
    migration: string;
    inst_summary: string;
    hot_money_summary: string;
    margin_summary: string;
  };
  important_news: Array<{
    segment: 'pre_market' | 'intraday' | 'post_market';
    time: string;
    headline: string;
    summary: string;
    driven: string[];
    level: string;
  }>;
  main_themes: Array<{
    name: string;
    strength: string;
    stage: string;
    days: number;
    leader_ladder: string;
    catalyst: string;
    today_performance: string;
    divergence_signals: string[];
    next_day_signals: {
      label: string;
      evidence: string[];
      suggestion: string;
    };
  }>;
  ladder_view: {
    height: string;
    promotion: string;
    broken: string;
    new_promotions: string;
  };
  risk_alerts: Array<{ type: string; content: string }>;
  battle_plan: {
    position_level: string;
    mode: string;
    focus_stocks: string[];
    avoid_list: string[];
    key_observations: string[];
  };
  yesterday_verify: {
    summary: string;
    hit_items: string[];
    miss_items: string[];
  };
}

// ===== 数据加载 =====

async function loadReviewData(sb: SupabaseClient, date: string): Promise<DailyReviewData | null> {
  const { data, error } = await sb
    .from('dailyReview')
    .select('*')
    .eq('report_date', date)
    .single();
  if (error || !data) return null;
  return data as DailyReviewData;
}

async function loadLimitUpReasons(sb: SupabaseClient, date: string): Promise<LimitUpReasons | null> {
  const { data } = await sb
    .from('limitUpReasons')
    .select('pick_date,themes')
    .eq('pick_date', date)
    .maybeSingle();
  if (!data) return null;
  return data as LimitUpReasons;
}

async function loadHotMoneySeats(sb: SupabaseClient): Promise<HotMoneySeat[]> {
  const { data } = await sb
    .from('hotMoneySeats')
    .select('id,nickname,seat_name,aliases,tier')
    .eq('active', true)
    .order('tier', { ascending: true });
  return (data as HotMoneySeat[]) ?? [];
}

async function loadYesterdayReview(
  sb: SupabaseClient,
  date: string,
): Promise<Pick<DailyReviewData, 'report_date' | 'ai_analysis' | 'market_sentiment'> | null> {
  const { data } = await sb
    .from('dailyReview')
    .select('report_date,ai_analysis,market_sentiment')
    .lt('report_date', date)
    .order('report_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Pick<DailyReviewData, 'report_date' | 'ai_analysis' | 'market_sentiment'>) ?? null;
}

async function loadSentimentHistory(
  sb: SupabaseClient,
  date: string,
  days: number = 5,
): Promise<Array<{ date: string; score: number; stage: string }>> {
  const { data } = await sb
    .from('dailyReview')
    .select('report_date, ai_analysis')
    .lt('report_date', date)
    .order('report_date', { ascending: false })
    .limit(days);

  if (!data?.length) return [];

  return data
    .filter(r => r.ai_analysis)
    .map(r => {
      const ai = r.ai_analysis as Record<string, unknown>;
      // 兼容 v1 (sentiment_score / sentiment_stage) + v2 (sentiment.score / sentiment.stage)
      const sent = ai.sentiment as Record<string, unknown> | undefined;
      const score = (sent?.score as number | undefined) ?? (ai.sentiment_score as number) ?? 5;
      const stage = (sent?.stage as string | undefined) ?? (ai.sentiment_stage as string) ?? '';
      return { date: r.report_date as string, score, stage };
    })
    .reverse();
}

// ===== 游资席位匹配 =====

interface HotMoneyMove {
  nickname: string;
  tier: number;
  stock_code: string;
  stock_name: string;
  direction: 'buy' | 'sell';
  amount: number;
}

function matchHotMoneyMoves(
  dragonTiger: Record<string, unknown>[] | null,
  seats: HotMoneySeat[],
): HotMoneyMove[] {
  if (!dragonTiger?.length || !seats.length) return [];

  // 构建席位别名 → seat 映射
  const aliasMap: Array<{ alias: string; seat: HotMoneySeat }> = [];
  for (const s of seats) {
    aliasMap.push({ alias: s.seat_name, seat: s });
    for (const a of s.aliases ?? []) {
      if (a) aliasMap.push({ alias: a, seat: s });
    }
  }

  const out: HotMoneyMove[] = [];
  for (const row of dragonTiger) {
    // dragon_tiger 条目结构参考 collectors/dragon_tiger.py（包含 buy_seats / sell_seats）
    const code = String(row.code ?? row.stock_code ?? '');
    const name = String(row.name ?? row.stock_name ?? '');
    const buySeats = (row.buy_seats as Array<Record<string, unknown>>) ?? [];
    const sellSeats = (row.sell_seats as Array<Record<string, unknown>>) ?? [];

    const scan = (seatRows: Array<Record<string, unknown>>, direction: 'buy' | 'sell') => {
      for (const sr of seatRows) {
        const sname = String(sr.seat_name ?? sr.name ?? '');
        if (!sname) continue;
        for (const { alias, seat } of aliasMap) {
          if (sname.includes(alias)) {
            out.push({
              nickname: seat.nickname,
              tier: seat.tier,
              stock_code: code,
              stock_name: name,
              direction,
              amount: Number(sr.net_amount ?? sr.amount ?? 0),
            });
            break;
          }
        }
      }
    };
    scan(buySeats, 'buy');
    scan(sellSeats, 'sell');
  }
  return out;
}

// ===== AI Prompt v2 =====

const SYSTEM_PROMPT_V2 = `你是一位资深 A 股复盘分析师，每日收盘后为短线交易者撰写结构化复盘报告。

【输出要求】
严格返回 JSON（不要 markdown 代码块，不要任何前后缀文字），结构如下：

{
  "version": "v2",
  "headline": "一句话概括今日市场核心（20 字内，必须含数字证据）",
  "sentiment": {
    "score": 1-10 整数,
    "stage": "升温/分歧/高潮/退潮/冰点/修复（六选一）",
    "width_conclusion": "宽度结论（涨跌家数+强弱股）",
    "ladder_conclusion": "高度结论（连板梯队+最高板）",
    "profit_conclusion": "赚钱效应结论（溢价率+炸板率+封单）",
    "style_conclusion": "风格结论（黄白线+量能）",
    "summary": "情绪综合 2-3 句"
  },
  "fund_picture": {
    "dashboard_conclusion": "大盘资金总览（主力+散户+中单，亿元）",
    "migration": "资金迁徙方向（板块流入/流出）",
    "inst_summary": "龙虎榜机构买卖前五",
    "hot_money_summary": "一线游资动向（nickname+个股+方向，没有则写"今日无一线游资席位出现"）",
    "margin_summary": "两融杠杆资金的趋势判断（1-2 句）。必须基于 T-1 已披露数据（margin_data.trade_date）点明杠杆资金当前所处阶段：顶部警示/加仓信号/企稳/撤离。可引用余额水平、1Y 分位、连续 ±N 日、5 日累计方向，禁止引用单日变化数值（T-1 数据放在今日复盘会误导）"
  },
  "important_news": [
    {
      "segment": "pre_market/intraday/post_market",
      "time": "HH:MM",
      "headline": "新闻标题",
      "summary": "1-2 句影响分析",
      "driven": ["相关股票或板块"],
      "level": "A/B"
    }
  ],
  "main_themes": [
    {
      "name": "主线名称（如 CPO/光模块）",
      "strength": "强/中/弱",
      "stage": "启动/主升D2/主升D3/分歧/退潮",
      "days": 该主线已演绎天数,
      "leader_ladder": "龙头梯队（如 铭普光磁6板 → 中际旭创3板 → xxx2板）",
      "catalyst": "核心催化（新闻/订单/政策）",
      "today_performance": "今日表现（涨停数、资金流、换手）",
      "divergence_signals": ["分歧信号1", "分歧信号2"],
      "next_day_signals": {
        "label": "延续概率高/分歧加剧/退潮概率高/信号不足（四选一）",
        "evidence": ["证据1（必须含数字）", "证据2"],
        "suggestion": "明日操作建议（具体到容错位或策略）"
      }
    }
  ],
  "ladder_view": {
    "height": "最高 X 板是 XX（XXXXXX），封单 X 亿",
    "promotion": "晋级率 X%（昨 X%）",
    "broken": "断板个股列表",
    "new_promotions": "首板 X 家（较昨 X 家）"
  },
  "risk_alerts": [
    { "type": "减仓/规避板块/黑天鹅/政策风险", "content": "具体内容" }
  ],
  "battle_plan": {
    "position_level": "空仓/三成/半仓/七成/满仓（含偏多/偏空修饰）",
    "mode": "打板优先/低吸优先/首板优先/观望",
    "focus_stocks": ["个股1（理由）", "个股2（理由）"],
    "avoid_list": ["回避板块/个股"],
    "key_observations": ["关键观察点1", "关键观察点2"]
  },
  "yesterday_verify": {
    "summary": "昨日预判的承接情况总结（若昨日无数据则写"无昨日数据对比"）",
    "hit_items": ["兑现预判1", "兑现预判2"],
    "miss_items": ["失效预判1"]
  }
}

【核心规则（必须严格遵守）】
1. 客观证据在前，主观结论在后；每个结论都要引用具体数字（涨停数、溢价率、封单、主力净流入等）。
2. 禁止"涨停较多""情绪较好"这种模糊表述，必须"涨停 48 家（昨 35 家）"。
3. main_themes.next_day_signals.label 是关键预判，只能四选一：延续概率高 / 分歧加剧 / 退潮概率高 / 信号不足。
4. battle_plan.focus_stocks 必须精确到个股名，不能停留在"关注半导体方向"这种空话。
5. important_news：从候选 filtered_news 精选 8-15 条对盘面有真实影响的，按时段分组，不是简单抄标题。
   - filtered_news 每条自带三路径命中信息：keyword_hits（关键词命中）、anchored_from（市场锚点反查：股票/行业/概念）、matched_daily_report（是否与今日早报呼应）。
   - 优先选 paths_hit ≥ 2 的（多路径命中表示既有事件性又有盘面映射）；单路径的只在同类稀缺时入选。
   - driven 字段不要只抄 anchored_from，要结合 main_themes 里的主线，写出真正被带动的板块或龙头。
   - summary 必须解释「这条新闻如何映射到盘面」，例如"预期内政策落地、带动昨日 CPO 主线，对应 XX/YY 两只龙头封单放大"。
6. fund_picture.hot_money_summary：若输入 hot_money_moves 非空，需点名 nickname；没有则说"今日无一线游资登榜"。
7. yesterday_verify：若输入包含 yesterday_analysis，需与其 battle_plan/main_themes/next_day_signals 对比，判断兑现与否。
8. headline 20 字内且含数字（如"情绪高潮连板 48 家 CPO 六板"）。
9. main_themes.leader_ladder：从 limit_up_ladder 里同主线的股票串联，格式"XX（原因）N板 → YY（原因）M板"。
   - 每条 limit_up_ladder 已附 reason 字段（涨停原因关键词），缺失时省略括号
   - 先按最高板 → 低板，再筛掉 keyword 跨题材的股票，不要把不同主线的股票混进一条梯队
10. fund_picture.margin_summary：基于 margin_data 撰写，解读两融杠杆资金的中期趋势。
    注意：margin_data 是 T-1 披露数据（看 trade_date 字段），反映的是上一交易日收盘后的杠杆水位，不是当日情绪指标。
    定性判断口径（只用趋势类信号，不引用单日数值）：
    - 1Y 分位 ≥ 70% + 连续净减或 5 日累计为负 → "顶部警示，杠杆撤离"
    - 1Y 分位 ≥ 70% + 连续净增 → "杠杆加仓，主升段特征"
    - 1Y 分位 ≤ 30% + 连续净增 → "底部企稳信号，聪明钱试探"
    - 连续净增 ≥ 3 日 → "趋势资金在场"
    - 5 日累计净减绝对值较大（>200 亿）→ "杠杆快速撤离"
    - 禁止出现"今日融资加仓 X 亿"这种把 T-1 数据当天描述的表述；可以说"截至 {trade_date}，..."
    - 若 margin_data 缺失或所有关键字段为 null，写"两融数据暂未发布"即可`;

// ===== AI 生成 =====

async function generateAiAnalysisV2(
  sb: SupabaseClient,
  data: DailyReviewData,
): Promise<AiAnalysisV2> {
  const token = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
  const baseURL = process.env.ANTHROPIC_BASE_URL ?? undefined;
  if (!token) throw new Error('缺少 ANTHROPIC_AUTH_TOKEN 环境变量');

  const client = new Anthropic({ apiKey: token, baseURL });

  // 加载 v2 新增输入
  console.log('  [ai] 加载 v2 补充数据（韭研涨停原因 / 游资席位 / 昨日复盘 / 情绪历史）...');
  const [limitUpReasons, seats, yesterday, sentimentHistory] = await Promise.all([
    loadLimitUpReasons(sb, data.report_date),
    loadHotMoneySeats(sb),
    loadYesterdayReview(sb, data.report_date),
    loadSentimentHistory(sb, data.report_date, 5),
  ]);

  // 匹配游资动向
  const hotMoneyMoves = matchHotMoneyMoves(data.dragon_tiger, seats);
  console.log(
    `        涨停题材 ${limitUpReasons?.themes?.length ?? 0} 个 / ` +
      `游资匹配 ${hotMoneyMoves.length} 条 / 昨日复盘 ${yesterday ? '✓' : '无'}`,
  );

  // 将涨停原因 keyword 注入到 limit_up_ladder 每条（按 code 映射）
  const reasonMap = new Map<string, string>();
  if (limitUpReasons?.themes) {
    for (const theme of limitUpReasons.themes) {
      for (const st of theme.stocks ?? []) {
        if (st.code && st.keyword && !reasonMap.has(st.code)) {
          reasonMap.set(st.code, st.keyword);
        }
      }
    }
  }
  const enrichedLadder = (data.limit_up_ladder ?? []).map(item => {
    const code = String((item as Record<string, unknown>).code ?? '');
    const reason = reasonMap.get(code);
    return reason ? { ...item, reason } : item;
  });
  const enrichedCount = enrichedLadder.filter(
    x => (x as Record<string, unknown>).reason,
  ).length;
  console.log(
    `        天梯涨停原因注入：${enrichedCount}/${enrichedLadder.length}`,
  );

  // 组装 AI 输入（精简，控制 token）
  const userContent = JSON.stringify(
    {
      date: data.report_date,
      market_overview: data.market_overview,
      market_sentiment: data.market_sentiment,
      limit_up_ladder: enrichedLadder,
      dragon_tiger: data.dragon_tiger?.slice(0, 15),
      sector_fund_flow: data.sector_fund_flow,
      stock_fund_flow: data.stock_fund_flow,
      ths_hot_concepts: data.ths_hot_concepts?.slice(0, 12),
      ths_hot_industries: data.ths_hot_industries?.slice(0, 12),
      limit_industry_distribution: data.limit_industry_distribution?.slice(0, 12),
      limit_analysis: data.limit_analysis,
      limit_up_reasons: limitUpReasons?.themes ?? null,
      hot_money_moves: hotMoneyMoves,
      margin_data: data.margin_data ?? null,
      filtered_news: data.filtered_news ?? [],
      sentiment_history: sentimentHistory,
      yesterday_analysis: yesterday?.ai_analysis ?? null,
      yesterday_sentiment: yesterday?.market_sentiment ?? null,
    },
    null,
    2,
  );

  // 持久化游资匹配结果（便于前端展示 + 下次跳过重算）
  try {
    await sb
      .from('dailyReview')
      .update({ hot_money_moves: hotMoneyMoves })
      .eq('id', data.id);
  } catch {
    /* 非关键路径，忽略 */
  }

  console.log('  [ai] 调用 Claude Opus 生成 v2 结构化复盘...');
  const res = await client.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 8192,
    system: SYSTEM_PROMPT_V2,
    messages: [
      {
        role: 'user',
        content: `以下是 ${data.report_date} 的 A 股收盘数据，请严格按 JSON schema 返回 v2 结构化分析：\n\n${userContent}`,
      },
    ],
  });

  const textBlock = res.content.find(b => b.type === 'text');
  const rawText = (textBlock as { text?: string } | undefined)?.text ?? '';

  // 兼容 Claude 可能包裹 ```json```
  let jsonStr = rawText.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  const analysis = JSON.parse(jsonStr) as AiAnalysisV2;
  analysis.version = 'v2';
  return analysis;
}

// ===== WxPusher 推送 =====

async function sendWxPush(content: string, summary: string): Promise<void> {
  const token = process.env.WXPUSHER_TOKEN;
  const uidsRaw = process.env.WXPUSHER_UID;
  if (!token || !uidsRaw) {
    console.warn('  [notify] 未配置 WXPUSHER_TOKEN / WXPUSHER_UID，跳过推送');
    return;
  }
  const uids = uidsRaw
    .split(',')
    .map(u => u.trim())
    .filter(Boolean);

  const pushContent = content.replace(/^#{1,3} (.+)$/gm, '**$1**');

  console.log(`  [notify] 推送到 ${uids.length} 位用户...`);
  const res = await axios.post(
    'https://wxpusher.zjiecode.com/api/send/message',
    {
      appToken: token,
      content: pushContent,
      summary: summary.slice(0, 100),
      contentType: 3,
      uids,
    },
    { timeout: 10000 },
  );

  if (res.data.success) {
    const ok =
      (res.data.data as Array<Record<string, unknown>> | undefined)?.filter(d => d.code === 1000)
        .length ?? 0;
    console.log(`  [notify] 推送成功，${ok}/${uids.length} 位用户收到`);
  } else {
    console.error(`  [notify] 推送失败: ${res.data.msg}`);
  }
}

// ===== 推送 Markdown 渲染（v2 优先，v1 降级） =====

function renderPushMarkdownV2(data: DailyReviewData, ai: AiAnalysisV2): string {
  const lines: string[] = [];

  // Headline + 情绪条
  lines.push(`> ${ai.headline}\n`);
  const filled = '█'.repeat(Math.max(0, Math.min(10, ai.sentiment.score)));
  const empty = '░'.repeat(10 - Math.max(0, Math.min(10, ai.sentiment.score)));
  lines.push(`情绪: ${filled}${empty} *${ai.sentiment.stage}* ${ai.sentiment.score}/10\n`);

  // 核心指标
  const st = data.market_sentiment as Record<string, number> | null;
  const la = data.limit_analysis as Record<string, unknown> | null;
  const ps = (la?.premium_summary ?? null) as Record<string, number> | null;
  const pm = (la?.promotion ?? null) as Record<string, unknown> | null;
  const ss = (la?.seal_stats ?? null) as Record<string, number> | null;
  const metrics: string[] = [];
  if (st) metrics.push(`涨停 ${st.limit_up} | 跌停 ${st.limit_down} | 炸板率 ${st.broken_rate}%`);
  if (ps?.premium_rate != null) metrics.push(`溢价率 ${ps.premium_rate}%`);
  if (pm?.rate != null) metrics.push(`晋级率 ${pm.rate}%`);
  if (ss?.total_seal_fund != null) metrics.push(`封单 ${ss.total_seal_fund}亿`);
  if (metrics.length) {
    lines.push(metrics.join(' | '));
    lines.push('');
  }

  // 情绪综述
  if (ai.sentiment.summary) {
    lines.push('━━━ 📊 情绪综述 ━━━\n');
    lines.push(ai.sentiment.summary);
    lines.push('');
  }

  // 资金画像
  if (ai.fund_picture) {
    lines.push('━━━ 💰 资金画像 ━━━\n');
    if (ai.fund_picture.dashboard_conclusion) lines.push(`▸ ${ai.fund_picture.dashboard_conclusion}`);
    if (ai.fund_picture.migration) lines.push(`▸ ${ai.fund_picture.migration}`);
    if (ai.fund_picture.margin_summary) lines.push(`▸ 两融: ${ai.fund_picture.margin_summary}`);
    if (ai.fund_picture.hot_money_summary) lines.push(`▸ 游资: ${ai.fund_picture.hot_money_summary}`);
    lines.push('');
  }

  // 主线 v2
  if (ai.main_themes?.length) {
    lines.push('━━━ 🎯 主线分析 ━━━\n');
    const strengthIcon: Record<string, string> = { 强: '🔴', 中: '🟡', 弱: '🔵' };
    for (const t of ai.main_themes) {
      const icon = strengthIcon[t.strength] ?? '⚪';
      lines.push(`${icon} *${t.name}*【${t.strength} · ${t.stage} · D${t.days}】`);
      if (t.leader_ladder) lines.push(`梯队: ${t.leader_ladder}`);
      if (t.today_performance) lines.push(`今日: ${t.today_performance}`);
      if (t.next_day_signals?.label) {
        lines.push(`→ *${t.next_day_signals.label}*: ${t.next_day_signals.suggestion ?? ''}`);
      }
      lines.push('');
    }
  }

  // 明日作战
  if (ai.battle_plan) {
    lines.push('━━━ ⚔️ 明日作战 ━━━\n');
    lines.push(`仓位: *${ai.battle_plan.position_level}* / 模式: *${ai.battle_plan.mode}*`);
    if (ai.battle_plan.focus_stocks?.length) {
      lines.push('关注:');
      for (const s of ai.battle_plan.focus_stocks) lines.push(`• ${s}`);
    }
    if (ai.battle_plan.avoid_list?.length) {
      lines.push('规避:');
      for (const s of ai.battle_plan.avoid_list) lines.push(`• ${s}`);
    }
    lines.push('');
  }

  // 风险
  if (ai.risk_alerts?.length) {
    lines.push('━━━ ⚠️ 风险提示 ━━━\n');
    for (const r of ai.risk_alerts) lines.push(`⚠ *${r.type}*: ${r.content}`);
    lines.push('');
  }

  return lines.join('\n');
}

function renderPushMarkdownV1(data: DailyReviewData): string {
  const lines: string[] = [];
  const ai = data.ai_analysis as Record<string, unknown> | null;
  if (!ai) {
    lines.push(`# ${data.report_date} 每日复盘\n`);
    lines.push(data.ai_summary ?? 'AI 分析尚未生成');
    return lines.join('\n');
  }

  const headline = (ai.headline as string) ?? '';
  const score = (ai.sentiment_score as number) ?? 5;
  const stage = (ai.sentiment_stage as string) ?? '';
  lines.push(`> ${headline}\n`);
  const filled = '█'.repeat(Math.max(0, Math.min(10, score)));
  const empty = '░'.repeat(10 - Math.max(0, Math.min(10, score)));
  lines.push(`情绪: ${filled}${empty} *${stage}* ${score}/10\n`);

  const themes = (ai.main_themes as Array<Record<string, unknown>> | undefined) ?? [];
  if (themes.length) {
    lines.push('━━━ 🎯 主线分析 ━━━\n');
    for (const t of themes) {
      const strength = t.strength as string;
      const icon = ({ 强: '🔴', 中: '🟡', 弱: '🔵' } as Record<string, string>)[strength] ?? '⚪';
      const leaders = Array.isArray(t.leader_stocks) ? (t.leader_stocks as string[]).join('、') : '';
      lines.push(`${icon} *${t.name}*【${strength}】（${leaders}）`);
      if (t.logic) lines.push(`${t.logic}`);
      if (t.continuation) lines.push(`→ ${t.continuation}`);
      lines.push('');
    }
  }
  const outlook = ai.outlook as Record<string, unknown> | undefined;
  if (outlook) {
    lines.push('━━━ 🔮 明日展望 ━━━\n');
    lines.push(`方向: *${outlook.direction}*`);
    const focus = outlook.focus_areas as string[] | undefined;
    if (focus?.length) {
      lines.push('关注:');
      for (const f of focus) lines.push(`• ${f}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderPushMarkdown(data: DailyReviewData): string {
  const ai = data.ai_analysis;
  if (ai && (ai as Record<string, unknown>).version === 'v2') {
    return renderPushMarkdownV2(data, ai as unknown as AiAnalysisV2);
  }
  return renderPushMarkdownV1(data);
}

// ===== 主流程 =====

async function main() {
  const { date } = parseArgs();
  console.log(`====== 每日复盘 AI 总结 + 推送（v2）======`);
  console.log(`  日期: ${date}`);
  console.log();

  const sb = getSupabase();

  console.log('[1/3] 读取 dailyReview 数据...');
  const data = await loadReviewData(sb, date);
  if (!data) {
    console.error(`  ✗ 未找到 ${date} 的复盘数据，请先运行 Python 采集脚本`);
    process.exit(1);
  }
  console.log(`  ✓ 状态: ${data.status}`);

  // 生成 v2 分析（已存在则跳过）
  const existingVersion = (data.ai_analysis as Record<string, unknown> | null)?.version;
  if (!data.ai_analysis || existingVersion !== 'v2') {
    console.log('[2/3] 生成 AI v2 结构化复盘...');
    try {
      const analysis = await generateAiAnalysisV2(sb, data);
      data.ai_analysis = analysis as unknown as Record<string, unknown>;

      // full_text 简版：把 sentiment.summary + main_themes 拼接作为降级文本
      const fallbackText = [
        `【情绪】${analysis.sentiment.summary}`,
        `【资金】${analysis.fund_picture.dashboard_conclusion}`,
        `【主线】${analysis.main_themes
          .map(t => `${t.name}(${t.strength}/${t.stage})`)
          .join('、')}`,
        `【作战】${analysis.battle_plan.mode} / ${analysis.battle_plan.position_level}`,
      ].join('\n');
      data.ai_summary = fallbackText;

      const { error } = await sb
        .from('dailyReview')
        .update({ ai_analysis: analysis, ai_summary: fallbackText })
        .eq('id', data.id);
      if (error) {
        console.error(`  [warn] 回写失败: ${error.message}`);
      } else {
        console.log(`  ✓ v2 分析已生成并保存`);
        console.log(`    headline: ${analysis.headline}`);
        console.log(`    情绪: ${analysis.sentiment.stage}（${analysis.sentiment.score}/10）`);
        console.log(`    主线: ${analysis.main_themes.map(t => t.name).join('、')}`);
        console.log(`    作战: ${analysis.battle_plan.position_level} / ${analysis.battle_plan.mode}`);
      }
    } catch (e) {
      console.error(`  ✗ AI 分析生成失败: ${(e as Error).message}`);
    }
  } else {
    console.log('[2/3] v2 AI 分析已存在，跳过生成');
  }

  // 推送
  console.log('[3/3] 推送到微信...');
  try {
    const markdown = renderPushMarkdown(data);
    const ai = data.ai_analysis as Record<string, unknown> | null;
    let pushSummary = `📊 ${date} 投资复盘`;
    if (ai) {
      if (ai.version === 'v2') {
        const a = ai as unknown as AiAnalysisV2;
        const st = data.market_sentiment as Record<string, number> | null;
        const parts = [a.headline, `情绪${a.sentiment.stage}(${a.sentiment.score}/10)`];
        if (st) parts.push(`涨停${st.limit_up}家 炸板率${st.broken_rate}%`);
        pushSummary = `📊 ${date} 投资复盘｜${parts.join('｜')}`;
      } else {
        const headline = ai.headline as string;
        const stage = ai.sentiment_stage as string;
        const score = ai.sentiment_score as number;
        pushSummary = `📊 ${date} 投资复盘｜${headline}｜情绪${stage}(${score}/10)`;
      }
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
