/**
 * limitUpReasons 历史回填脚本
 *
 * 用法：npx tsx backfill-limit-up.ts [--from 2026-02-13] [--to 2026-04-13] [--dry-run]
 *
 * 逐日调用 jiuyan-image-fetch.ts 拉取涨停简图并写入 DB。
 * 幂等：已存在的日期自动跳过。
 * 周末自动跳过（周六日非交易日）。
 *
 * 环境变量：
 *   JIUYAN_SESSION / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL
 *   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY（优先）/ SUPABASE_ANON_KEY
 */

import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// 加载环境变量
const scriptDir = import.meta.dirname ?? process.cwd();
const envPath = resolve(scriptDir, '../../apps/web/.env.local');
config({ path: envPath });

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('[error] 缺少 Supabase 环境变量');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey);

// 解析命令行参数
const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}
const dryRun = args.includes('--dry-run');

// 默认：从最早数据倒推60个交易日 ≈ 85自然日
const defaultFrom = '2026-02-13';
const defaultTo = '2026-04-13';
const fromDate = getArg('--from', defaultFrom);
const toDate = getArg('--to', defaultTo);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_PATTERN.test(fromDate) || !DATE_PATTERN.test(toDate)) {
  console.error('[error] 日期参数格式必须为 YYYY-MM-DD');
  process.exit(1);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + 'T12:00:00+08:00');
  return d.getDay() === 0 || d.getDay() === 6;
}

async function main() {
  console.log(`limitUpReasons 历史回填`);
  console.log(`范围: ${fromDate} ~ ${toDate}`);
  if (dryRun) console.log('(dry-run 模式，不写入)');
  console.log('');

  // 查已有日期
  const { data: existing } = await sb
    .from('limitUpReasons')
    .select('pick_date');
  const existingDates = new Set((existing || []).map(r => r.pick_date));
  console.log(`DB 已有 ${existingDates.size} 天数据`);

  // 生成日期列表
  const dates: string[] = [];
  let cur = fromDate;
  while (cur <= toDate) {
    if (!isWeekend(cur) && !existingDates.has(cur)) {
      dates.push(cur);
    }
    cur = addDays(cur, 1);
  }

  console.log(`需回填: ${dates.length} 天（已跳过周末和已有日期）\n`);

  if (dates.length === 0) {
    console.log('无需回填');
    return;
  }

  const fetchScript = resolve(scriptDir, 'jiuyan-image-fetch.ts');
  let success = 0;
  let fail = 0;
  let skip = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    console.log(`[${i + 1}/${dates.length}] ${date}...`);

    if (dryRun) {
      console.log(`  (dry-run) 跳过`);
      continue;
    }

    try {
      const result = spawnSync('npx', ['--yes', 'tsx', fetchScript, date], {
        cwd: scriptDir,
        timeout: 200_000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      if (result.status !== 0) {
        throw new Error(result.stderr || `子进程退出码 ${result.status}`);
      }

      const data = JSON.parse(result.stdout.trim());
      const themes = data.themes || [];

      if (themes.length === 0) {
        console.log(`  无题材数据（可能非交易日），跳过`);
        skip++;
        continue;
      }

      // 写入 DB
      const record = {
        id: randomUUID(),
        pick_date: date,
        themes,
        raw_image_url: data.raw_image_url || null,
        source: 'jiuyan-image-backfill',
        created_at: Date.now(),
      };

      await sb.from('limitUpReasons').insert(record);
      console.log(`  写入成功: ${data.theme_count} 题材, ${data.stock_count} 股票`);
      success++;

      // 间隔 3 秒，避免限流
      if (i < dates.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  失败: ${msg.slice(0, 150)}`);
      fail++;

      // 连续失败 3 次停止
      if (fail >= 3 && success === 0) {
        console.error('\n连续失败，停止回填。请检查 JIUYAN_SESSION 是否有效。');
        break;
      }

      // 失败后等 5 秒
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`\n回填完成: 成功 ${success}, 失败 ${fail}, 跳过 ${skip}`);
}

main().catch(err => {
  console.error('回填异常:', err);
  process.exit(1);
});
