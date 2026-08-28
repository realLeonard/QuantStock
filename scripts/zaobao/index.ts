/**
 * 早报系统入口
 * 执行方式：npx tsx scripts/zaobao/index.ts [--date YYYY-MM-DD]
 *
 * 流程：
 * 1. 判断是否为交易日
 * 2. 读取 rawMarketData 原始数据
 * 3. 调用 Claude API 生成报告
 * 4. 保存到 dailyReport 表
 * 5. WxPusher 推送微信
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { generateDailyReport } from './generate';
import { sendWxPush } from './notify';

// 加载环境变量（优先读取 apps/web/.env.local）
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const envPath = resolve(__dirname, '../../apps/web/.env.local');
dotenv.config({ path: envPath });
dotenv.config(); // fallback

// ===== 工具函数 =====

function getBeijingDateStr(): string {
  const now = new Date();
  // 北京时间 = UTC+8
  const offset = 8 * 60 * 60 * 1000;
  const bj = new Date(now.getTime() + offset);
  return bj.toISOString().slice(0, 10);
}

function parseArgs(): { date: string; noPush: boolean } {
  const args = process.argv.slice(2);
  const dateIdx = args.findIndex(a => a === '--date');
  const date = dateIdx !== -1 && args[dateIdx + 1] ? args[dateIdx + 1] : getBeijingDateStr();
  const noPush = args.includes('--no-push');
  return { date, noPush };
}

async function getLatestReport(date: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!url || !key) return null;

  const sb = createClient(url, key);
  const { data } = await sb
    .from('dailyReport')
    .select('content, summary')
    .eq('report_date', date)
    .single();
  return data;
}

// ===== 主流程 =====

async function main() {
  const { date, noPush } = parseArgs();

  console.log('\n========================================');
  console.log(`  观弈 · 每日早报系统`);
  console.log(`  日期: ${date}${noPush ? '（测试模式，跳过推送）' : ''}`);
  console.log('========================================\n');

  try {
    // 生成报告
    await generateDailyReport(date);

    // 读取刚生成的报告内容用于推送
    const report = await getLatestReport(date);
    if (report && !noPush) {
      await sendWxPush(date, report.content, report.summary);
    }

    console.log('\n========================================');
    console.log('  早报生成完成！');
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n[ERROR]', err);
    process.exit(1);
  }
}

main();
