/**
 * 板块评分推送 — WxPusher
 *
 * 推送样式参考每日复盘，使用 ━━━ 分隔 + 斜体强调
 *
 * 环境变量：
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY
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
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[error] 缺少 Supabase 环境变量');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

// ---------- 类型 ----------

interface ScoreRow {
  trade_date: string;
  sector_name: string;
  fund_score: number;
  tech_score: number;
  sentiment_score: number;
  policy_score: number;
  rotation_score: number;
  leader_bonus: number;
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

function starsFromConfidence(c: number): string {
  if (c >= 0.8) return '⭐⭐⭐';
  if (c >= 0.6) return '⭐⭐';
  if (c >= 0.4) return '⭐';
  return '';
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
  console.log(`板块评分推送 — ${today}`);

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
  const watch = scores.filter((s: ScoreRow) => s.signal === 'watch').slice(0, 5);
  const risk = scores.filter((s: ScoreRow) => s.signal === 'risk');

  // 市场环境
  const marketEnv = scores[0]?.market_env || 'neutral';

  // 统计
  const allScores = scores.map((s: ScoreRow) => s.total_score).sort((a: number, b: number) => a - b);
  const median = allScores[Math.floor(allScores.length / 2)];

  // 复盘数据（查前一日的预测）
  const { data: prevScores } = await sb
    .from('sector_scores')
    .select('signal,prediction_hit,sector_name,next_day_actual,trade_date')
    .lt('trade_date', tradeDate)
    .in('signal', ['strong_buy', 'buy'])
    .not('prediction_hit', 'is', null)
    .order('trade_date', { ascending: false })
    .limit(50);

  // 只取最近一天
  const prevDate = prevScores?.[0]?.trade_date;
  const prevDayScores = prevScores?.filter(s => s.trade_date === prevDate) || [];
  const prevHit = prevDayScores.filter(s => s.prediction_hit).length;
  const prevTotal = prevDayScores.length;

  // ============================================================
  // 格式化推送内容（参考每日复盘样式）
  // ============================================================
  const lines: string[] = [];

  // 顶部市场概览
  const envInfo = envIcon(marketEnv);
  const topPicks = [...strongBuy, ...buy].slice(0, 10);

  lines.push(`> ${tradeDate} 板块评分日报`);
  lines.push('');
  lines.push(`市场环境: _${envInfo}_ | 推荐 _${topPicks.length}_ 个 | 中位数 _${median.toFixed(0)}_ 分`);
  lines.push('');

  // ━━━ 强势推荐 ━━━
  if (topPicks.length > 0) {
    lines.push('━━━ 🔥 强势推荐 ━━━');
    lines.push('');

    // 表格头
    lines.push('| # | 板块 | 总分 | 阶段 | 资金 | 情绪 | 政策 | 技术 | 龙头 |');
    lines.push('|---|------|------|------|------|------|------|------|------|');

    for (let i = 0; i < topPicks.length; i++) {
      const s = topPicks[i] as ScoreRow;
      const stage = s.stage || '-';
      const leader = s.leading_stock || '-';
      const bonus = s.leader_bonus > 0 ? `+${s.leader_bonus.toFixed(0)}` : '';

      lines.push(
        `| ${i + 1} | _${s.sector_name}_ | _${s.total_score.toFixed(0)}${bonus}_ | ${stage} `
        + `| ${s.fund_score.toFixed(0)} | ${s.sentiment_score.toFixed(0)} `
        + `| ${s.policy_score.toFixed(0)} | ${s.tech_score.toFixed(0)} | ${leader} |`
      );
    }
    lines.push('');
  }

  // ━━━ 关注观察 ━━━
  if (watch.length > 0) {
    lines.push('━━━ 👀 关注观察 ━━━');
    lines.push('');
    for (const s of watch as ScoreRow[]) {
      lines.push(`▸ ${s.sector_name} ${s.total_score.toFixed(0)}分${s.stage ? `(${s.stage})` : ''}`);
    }
    lines.push('');
  }

  // ━━━ 风险板块 ━━━
  if (risk.length > 0) {
    lines.push('━━━ ⚠️ 风险板块 ━━━');
    lines.push('');
    for (const s of (risk as ScoreRow[]).slice(0, 5)) {
      lines.push(`▸ ${s.sector_name} → ${s.risk_reason || s.stage || '分歧'}`);
    }
    lines.push('');
  }

  // ━━━ 市场概况 ━━━
  lines.push('━━━ 📋 市场概况 ━━━');
  lines.push('');
  lines.push(`▸ strong\\_buy: ${strongBuy.length} | buy: ${buy.length} | risk: ${risk.length}`);
  lines.push(`▸ 中位数: ${median.toFixed(0)} | 最高: ${allScores[allScores.length - 1].toFixed(0)} | 最低: ${allScores[0].toFixed(0)}`);

  // 复盘
  if (prevTotal > 0) {
    const hitRate = ((prevHit / prevTotal) * 100).toFixed(1);
    lines.push(`▸ 昨日命中: ${prevHit}/${prevTotal} (${hitRate}%)`);
  }

  const content = lines.join('\n');

  // 推送标题：📊 日期 板块机会｜摘要
  const topSector = topPicks[0] ? (topPicks[0] as ScoreRow).sector_name : '';
  const summaryTail = topPicks.length > 1
    ? `TOP1 ${topSector} ${(topPicks[0] as ScoreRow).total_score.toFixed(0)}分`
    : '暂无推荐';
  const summary = `📊 ${tradeDate} 板块机会｜${envInfo} ${summaryTail}`;

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
