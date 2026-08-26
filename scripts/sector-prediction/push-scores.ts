/**
 * 板块评分推送 v3 — WxPusher
 *
 * v3 改造：新维度（暗流/蓄势/模式/催化）、新信号(hold/sell)、
 * 止损建议、板块去重标注、时间维度、持仓跟踪
 *
 * 环境变量：
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY（优先）/ SUPABASE_ANON_KEY
 *   WXPUSHER_TOKEN
 *   WXPUSHER_UID（逗号分隔）
 */

import { resolve } from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

// 加载环境变量
const scriptDir = import.meta.dirname ?? process.cwd();
const envPath = resolve(scriptDir, '../../apps/web/.env.local');
config({ path: envPath });

// ---------- Supabase ----------

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[error] 缺少 Supabase 环境变量');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

// ---------- 类型 ----------

interface ScoreRow {
  trade_date: string;
  sector_name: string;
  // v3 新字段
  stealth_fund_score: number;
  momentum_score: number;
  pattern_score: number;
  catalyst_score: number;
  risk_adjustment: number;
  stage_coefficient: number;
  market_emotion_phase: string | null;
  time_horizon: string | null;
  // 旧字段（向后兼容）
  fund_score: number;
  tech_score: number;
  sentiment_score: number;
  policy_score: number;
  rotation_score: number;
  leader_bonus: number;
  // 通用
  total_score: number;
  rank: number;
  signal: string;
  stage: string | null;
  confidence: number;
  risk_reason: string | null;
  leading_stock: string | null;
  market_env: string | null;
  next_day_actual: number | null;
  prediction_hit: boolean | null;
}

// ---------- 工具函数 ----------

function getTodayBJ(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function envIcon(env: string): string {
  const map: Record<string, string> = {
    strong: '🟢强势',
    neutral: '🟡中性',
    weak: '🔴弱势',
    extreme: '⚫极端',
  };
  return map[env] || env;
}

function signalIcon(signal: string): string {
  const map: Record<string, string> = {
    strong_buy: '🔴',
    buy: '🟠',
    hold: '🟡',
    sell: '🔻',
    watch: '👀',
    risk: '⚠️',
  };
  return map[signal] || '⚪';
}

function statusIcon(status: string): string {
  if (status.includes('持有')) return '🟢';
  if (status.includes('止损')) return '🔴';
  return '⚪';
}

// ---------- WxPusher ----------

const WXPUSHER_API = 'https://wxpusher.zjiecode.com/api/send/message';

async function sendWxPush(content: string, summary: string): Promise<void> {
  const token = process.env.WXPUSHER_TOKEN;
  const uidsRaw = process.env.WXPUSHER_UID;

  if (!token || !uidsRaw) {
    console.warn('[notify] 未配置 WXPUSHER_TOKEN / WXPUSHER_UID，跳过推送');
    return;
  }

  const uids = uidsRaw.split(',').map(u => u.trim()).filter(Boolean);

  const payload = {
    appToken: token,
    content,
    summary: summary.slice(0, 100),
    contentType: 3,
    uids,
  };

  console.log(`[notify] 推送至 ${uids.length} 位用户...`);

  const res = await axios.post(WXPUSHER_API, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  if (res.data.success) {
    const successCount = res.data.data?.filter((d: { code: number }) => d.code === 1000).length ?? 0;
    console.log(`[notify] 推送成功，${successCount}/${uids.length} 位用户收到`);
  } else {
    console.error(`[notify] 推送失败: ${res.data.msg}`);
  }
}

// ---------- 主流程 ----------

async function main() {
  const today = getTodayBJ();
  console.log(`板块评分推送 v3 — ${today}`);

  // 查询当日评分
  let tradeDate = today;
  let { data: scores, error } = await sb
    .from('sector_scores')
    .select('*')
    .eq('trade_date', today)
    .order('rank', { ascending: true });

  // 如果今天没数据，取最近交易日
  if (!scores || scores.length === 0) {
    console.log(`今日 (${today}) 无评分数据，查找最近交易日...`);
    const { data: latest } = await sb
      .from('sector_scores')
      .select('trade_date')
      .order('trade_date', { ascending: false })
      .limit(1);

    if (latest && latest.length > 0) {
      tradeDate = latest[0].trade_date;
      console.log(`使用最近交易日: ${tradeDate}`);
      const resp = await sb
        .from('sector_scores')
        .select('*')
        .eq('trade_date', tradeDate)
        .order('rank', { ascending: true });
      scores = resp.data;
      error = resp.error;
    }
  }

  if (error) {
    console.error('[error] 查询 sector_scores 失败:', error.message);
    process.exit(1);
  }
  if (!scores || scores.length === 0) {
    console.error('[error] 无评分数据');
    process.exit(1);
  }

  console.log(`共 ${scores.length} 条评分记录，日期: ${tradeDate}`);

  // 分组
  const strongBuy = scores.filter((s: ScoreRow) => s.signal === 'strong_buy');
  const buy = scores.filter((s: ScoreRow) => s.signal === 'buy');
  const hold = scores.filter((s: ScoreRow) => s.signal === 'hold');
  const sell = scores.filter((s: ScoreRow) => s.signal === 'sell');
  const watch = scores.filter((s: ScoreRow) => s.signal === 'watch').slice(0, 5);

  // 市场环境
  const marketEnv = scores[0]?.market_env || 'neutral';
  const marketCoeff = scores[0]?.stage_coefficient || 1.0;

  // 统计
  const allScores = scores.map((s: ScoreRow) => s.total_score).sort((a: number, b: number) => a - b);
  const median = allScores[Math.floor(allScores.length / 2)];

  // 复盘数据（查前一日预测命中）
  const { data: prevScores } = await sb
    .from('sector_scores')
    .select('signal,prediction_hit,sector_name,next_day_actual,trade_date')
    .lt('trade_date', tradeDate)
    .in('signal', ['strong_buy', 'buy'])
    .not('prediction_hit', 'is', null)
    .order('trade_date', { ascending: false })
    .limit(50);

  const prevDate = prevScores?.[0]?.trade_date;
  const prevDayScores = prevScores?.filter(s => s.trade_date === prevDate) || [];
  const prevHit = prevDayScores.filter(s => s.prediction_hit).length;
  const prevTotal = prevDayScores.length;

  // 持仓跟踪（查过去5个交易日的推荐）
  const startTrack = new Date(new Date(tradeDate).getTime() - 12 * 86400000)
    .toISOString().slice(0, 10);
  const { data: trackData } = await sb
    .from('sector_scores')
    .select('trade_date,sector_name,signal,total_score,stage')
    .gte('trade_date', startTrack)
    .lt('trade_date', tradeDate)
    .in('signal', ['strong_buy', 'buy'])
    .order('trade_date', { ascending: false });

  // 去重：同板块只跟踪最早推荐
  const trackSeen = new Set<string>();
  const trackRecs: typeof trackData = [];
  for (const r of trackData || []) {
    if (!trackSeen.has(r.sector_name)) {
      trackSeen.add(r.sector_name);
      trackRecs.push(r);
    }
  }

  // 查这些板块从推荐日到今天的累计涨幅
  type TrackItem = {
    sector_name: string;
    signal: string;
    rec_date: string;
    days_held: number;
    cum_change: number;
    status: string;
  };
  const trackResults: TrackItem[] = [];

  if (trackRecs.length > 0) {
    const trackNames = trackRecs.map(r => r.sector_name);
    const earliestTrack = trackRecs[trackRecs.length - 1]?.trade_date || startTrack;
    const { data: dailyData } = await sb
      .from('sector_daily')
      .select('sector_name,trade_date,change_pct')
      .gte('trade_date', earliestTrack)
      .lte('trade_date', tradeDate)
      .in('sector_name', trackNames)
      .order('trade_date', { ascending: true });

    // {板块: {日期: change_pct}}
    const dailyMap: Record<string, Record<string, number>> = {};
    for (const d of dailyData || []) {
      if (!dailyMap[d.sector_name]) dailyMap[d.sector_name] = {};
      dailyMap[d.sector_name][d.trade_date] = d.change_pct || 0;
    }

    for (const rec of trackRecs) {
      const map = dailyMap[rec.sector_name] || {};
      const dates = Object.keys(map).sort().filter(d => d > rec.trade_date);
      let cum = 0;
      let daysHeld = 0;
      let hitStopLoss = false;

      for (const d of dates) {
        cum += map[d];
        daysHeld++;
        if (cum <= -3) {
          hitStopLoss = true;
          break;
        }
      }

      let status = '持有中';
      if (hitStopLoss) status = '已止损';
      else if (daysHeld >= 5) status = '已超期';

      trackResults.push({
        sector_name: rec.sector_name,
        signal: rec.signal,
        rec_date: rec.trade_date,
        days_held: daysHeld,
        cum_change: Math.round(cum * 100) / 100,
        status,
      });
    }
  }

  // ============================================================
  // 格式化推送内容
  // ============================================================
  const lines: string[] = [];

  const envInfo = envIcon(marketEnv);
  const topPicks = [...strongBuy, ...buy, ...hold].slice(0, 10);

  lines.push(`> ${tradeDate} 板块预测日报 v3`);
  lines.push('');
  lines.push(`市场: _${envInfo}_ | 推荐 _${topPicks.length}_ 个 | 中位 _${median.toFixed(0)}_ 分`);
  lines.push('');

  // ━━━ 推荐板块 ━━━
  if (topPicks.length > 0) {
    lines.push('━━━ 🔥 推荐板块 ━━━');
    lines.push('');

    // v3 表格
    lines.push('| # | 板块 | 分数 | 阶段 | 暗流 | 蓄势 | 模式 | 催化 | 风险 | 建议 |');
    lines.push('|---|------|------|------|------|------|------|------|------|------|');

    for (let i = 0; i < topPicks.length; i++) {
      const s = topPicks[i] as ScoreRow;
      const stage = s.stage || '-';
      const icon = signalIcon(s.signal);
      const horizon = s.time_horizon || '-';
      const risk = s.risk_adjustment < 0 ? `${s.risk_adjustment.toFixed(0)}` : '0';

      lines.push(
        `| ${icon}${i + 1} | _${s.sector_name}_ | _${s.total_score.toFixed(0)}_ | ${stage} `
        + `| ${s.stealth_fund_score.toFixed(0)} | ${s.momentum_score.toFixed(0)} `
        + `| ${s.pattern_score.toFixed(0)} | ${s.catalyst_score.toFixed(0)} `
        + `| ${risk} | ${horizon} |`
      );
    }
    lines.push('');

    // 止损建议
    lines.push('> 💡 止损: strong\\_buy/buy 建议 -3%，持有上限 5 个交易日');
    lines.push('> hold 跌破 MA5 则离场');
    lines.push('');
  }

  // ━━━ 建议离场 ━━━
  if (sell.length > 0) {
    lines.push('━━━ 🔻 建议离场 ━━━');
    lines.push('');
    for (const s of (sell as ScoreRow[]).slice(0, 5)) {
      lines.push(`▸ ${s.sector_name} 【${s.stage || '-'}】 风险${s.risk_adjustment.toFixed(0)}`);
    }
    lines.push('');
  }

  // ━━━ 关注观察 ━━━
  if (watch.length > 0) {
    lines.push('━━━ 👀 关注观察 ━━━');
    lines.push('');
    for (const s of watch as ScoreRow[]) {
      const dedup = s.risk_reason?.includes('去重') ? ` (${s.risk_reason})` : '';
      lines.push(`▸ ${s.sector_name} ${s.total_score.toFixed(0)}分${s.stage ? ` (${s.stage})` : ''}${dedup}`);
    }
    lines.push('');
  }

  // ━━━ 持仓跟踪 ━━━
  if (trackResults.length > 0) {
    lines.push('━━━ 📈 昨日推荐跟踪 ━━━');
    lines.push('');
    for (const t of trackResults) {
      const icon = statusIcon(t.status);
      const sign = t.cum_change >= 0 ? '+' : '';
      lines.push(
        `${icon} ${t.sector_name} ${t.rec_date}+${t.days_held}天 `
        + `累计${sign}${t.cum_change.toFixed(1)}% ${t.status}`
      );
    }
    lines.push('');
  }

  // ━━━ 市场概况 ━━━
  lines.push('━━━ 📋 市场概况 ━━━');
  lines.push('');
  lines.push(
    `▸ strong\\_buy: ${strongBuy.length} | buy: ${buy.length} | hold: ${hold.length}`
    + ` | sell: ${sell.length}`
  );
  lines.push(
    `▸ 中位: ${median.toFixed(0)} | 最高: ${allScores[allScores.length - 1].toFixed(0)}`
    + ` | 最低: ${allScores[0].toFixed(0)}`
  );

  // 复盘
  if (prevTotal > 0) {
    const hitRate = ((prevHit / prevTotal) * 100).toFixed(1);
    lines.push(`▸ 昨日命中: ${prevHit}/${prevTotal} (${hitRate}%)`);
  }

  const content = lines.join('\n');

  // 推送标题
  const topSector = topPicks[0] ? (topPicks[0] as ScoreRow).sector_name : '';
  const summaryTail = topPicks.length > 0
    ? `TOP1 ${topSector} ${(topPicks[0] as ScoreRow).total_score.toFixed(0)}分`
    : '暂无推荐';
  const summary = `📊 ${tradeDate} 板块预测｜${envInfo} ${summaryTail}`;

  // 打印
  console.log('\n' + content);

  // 推送
  await sendWxPush(content, summary);

  console.log('\n推送完成');
}

main().catch(err => {
  console.error('推送脚本异常:', err);
  process.exit(1);
});
