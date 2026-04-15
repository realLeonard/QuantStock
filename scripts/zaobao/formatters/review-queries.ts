/**
 * 早报跑时从 dailyReview 实时聚合：
 * 1. 历史基线对比（近 5 条）— 涨停数/炸板率/晋级率/成交额 的 5 日均值
 * 2. 板块资金延续性（近 3 条）— TOP 板块的 3 日净流入序列
 *
 * 不建新字段，按需查询。
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface DailyReviewLite {
  report_date: string;
  market_overview?: { volume?: { today?: number | null } } | null;
  market_sentiment?: {
    limit_up?: number;
    limit_down?: number;
    broken_limit?: number;
    broken_rate?: number;
  } | null;
  limit_analysis?: {
    promotion?: { rate?: number };
    seal_stats?: { total_seal_fund?: number };
  } | null;
  sector_fund_flow?: {
    inflow?: Array<{ sector?: string; net_amount?: number }>;
  } | null;
}

// ===== 历史基线 =====

/**
 * 查询指定日期（含）之前的近 5 条 dailyReview，计算 5 日均值基线
 * 返回 Markdown 字符串，供 prompt 拼接
 */
export async function loadHistoryBaseline(
  sb: SupabaseClient,
  beforeDate: string
): Promise<string> {
  const { data, error } = await sb
    .from('dailyReview')
    .select(
      'report_date, market_overview, market_sentiment, limit_analysis'
    )
    .lte('report_date', beforeDate)
    .eq('status', 'success')
    .order('report_date', { ascending: false })
    .limit(5);

  if (error) {
    console.warn(`  [generate] 查询历史基线失败: ${error.message}`);
    return '（历史基线查询失败）';
  }

  const rows = (data ?? []) as DailyReviewLite[];
  if (rows.length === 0) return '（无历史基线数据）';

  const pickLatest = rows[0];
  const mean = (nums: Array<number | null | undefined>): number | null => {
    const arr = nums.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    if (arr.length === 0) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  };

  const fmtCompare = (today: number | null | undefined, avg: number | null, unit = ''): string => {
    if (today == null || avg == null || avg === 0) return '-';
    const delta = today - avg;
    const pct = (delta / avg) * 100;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    return `${today.toFixed(unit === '%' ? 1 : 0)}${unit}（5日均值 ${avg.toFixed(unit === '%' ? 1 : 0)}${unit}，${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%）`;
  };

  const limitUps = rows.map(r => r.market_sentiment?.limit_up).filter((v): v is number => typeof v === 'number');
  const limitDowns = rows.map(r => r.market_sentiment?.limit_down).filter((v): v is number => typeof v === 'number');
  const brokenRates = rows.map(r => r.market_sentiment?.broken_rate).filter((v): v is number => typeof v === 'number');
  const promotions = rows.map(r => r.limit_analysis?.promotion?.rate).filter((v): v is number => typeof v === 'number');
  const sealFunds = rows.map(r => r.limit_analysis?.seal_stats?.total_seal_fund).filter((v): v is number => typeof v === 'number');
  const volumes = rows.map(r => r.market_overview?.volume?.today).filter((v): v is number => typeof v === 'number');

  const lines: string[] = [
    `**样本范围**：${rows[rows.length - 1].report_date} ~ ${rows[0].report_date}（${rows.length} 个交易日）`,
    `- 涨停数：${fmtCompare(pickLatest.market_sentiment?.limit_up, mean(limitUps))}`,
    `- 跌停数：${fmtCompare(pickLatest.market_sentiment?.limit_down, mean(limitDowns))}`,
    `- 炸板率：${fmtCompare(pickLatest.market_sentiment?.broken_rate, mean(brokenRates), '%')}`,
    `- 晋级率：${fmtCompare(pickLatest.limit_analysis?.promotion?.rate, mean(promotions), '%')}`,
    `- 封单总额：${fmtCompare(pickLatest.limit_analysis?.seal_stats?.total_seal_fund, mean(sealFunds))}`,
    `- 两市成交：${fmtCompare(pickLatest.market_overview?.volume?.today, mean(volumes))}亿`,
  ];

  return lines.join('\n');
}

// ===== 板块延续性 =====

/**
 * 查询近 3 条 dailyReview，对最新一日流入 TOP 板块追溯 3 日主力净流入序列
 */
export async function loadSectorContinuity(
  sb: SupabaseClient,
  beforeDate: string,
  topN = 5
): Promise<string> {
  const { data, error } = await sb
    .from('dailyReview')
    .select('report_date, sector_fund_flow')
    .lte('report_date', beforeDate)
    .eq('status', 'success')
    .order('report_date', { ascending: false })
    .limit(3);

  if (error) {
    console.warn(`  [generate] 查询板块延续性失败: ${error.message}`);
    return '（板块延续性查询失败）';
  }

  const rows = (data ?? []) as DailyReviewLite[];
  if (rows.length === 0) return '（无板块延续性数据）';

  // rows[0] = 最新, rows[2] = 3日前
  const latestInflow = rows[0].sector_fund_flow?.inflow ?? [];
  if (latestInflow.length === 0) return '（最新日无板块资金数据）';

  const lines: string[] = [`**对比日期**：${rows.map(r => r.report_date).reverse().join(' → ')}`];

  for (const top of latestInflow.slice(0, topN)) {
    const sectorName = top.sector;
    if (!sectorName) continue;

    // 倒序 rows（旧→新）查找同名板块净流入
    const series: Array<{ date: string; amount: number | null }> = [];
    for (const r of [...rows].reverse()) {
      const inflow = r.sector_fund_flow?.inflow ?? [];
      const match = inflow.find(x => x.sector === sectorName);
      series.push({ date: r.report_date, amount: match?.net_amount ?? null });
    }

    const seq = series.map(s => (s.amount != null ? `${s.amount >= 0 ? '+' : ''}${s.amount.toFixed(1)}` : 'N/A')).join(' / ');
    const nums = series.map(s => s.amount).filter((v): v is number => typeof v === 'number');
    let trend = '';
    if (nums.length === 3) {
      if (nums[0] < nums[1] && nums[1] < nums[2]) trend = '→ 连续放大';
      else if (nums[0] > nums[1] && nums[1] > nums[2]) trend = '→ 持续衰减';
      else if (nums[2] < 0 && nums[1] < 0) trend = '→ 转为流出';
      else if (nums.every(n => n > 0)) trend = '→ 持续净流入';
    }

    lines.push(`- ${sectorName}：${seq} 亿 ${trend}`);
  }

  return lines.join('\n');
}
