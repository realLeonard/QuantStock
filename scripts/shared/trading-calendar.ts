/**
 * 中国 A 股交易日历（2026 年）
 *
 * 公共模块，所有 TypeScript 采集/推送脚本共用。
 * 数据来源：上交所 2025-12-22 官方公告。
 *
 * 用法：
 *   import { isTradingDay, isHoliday } from '../shared/trading-calendar';
 *
 *   if (!isTradingDay('2026-04-22')) {
 *     console.log('非交易日，跳过采集');
 *   }
 */

// ── 2026 年 A 股法定节假日（仅工作日部分，周末由 getDay() 判断覆盖） ──
// 来源：上海证券交易所
// https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml
const HOLIDAYS_2026 = new Set<string>([
  // 元旦 1/1(四)~1/3(六)，1/5 开市
  '2026-01-01', '2026-01-02',
  // 春节 2/15(日)~2/23(一)，2/24 开市
  '2026-02-16', '2026-02-17', '2026-02-18',
  '2026-02-19', '2026-02-20', '2026-02-23',
  // 清明 4/4(六)~4/6(一)，4/7 开市
  '2026-04-06',
  // 劳动节 5/1(五)~5/5(二)，5/6 开市
  '2026-05-01', '2026-05-04', '2026-05-05',
  // 端午 6/19(五)~6/21(日)，6/22 开市
  '2026-06-19',
  // 中秋 9/25(五)~9/27(日)，9/28 开市
  '2026-09-25',
  // 国庆 10/1(四)~10/7(三)，10/8 开市
  '2026-10-01', '2026-10-02', '2026-10-05',
  '2026-10-06', '2026-10-07',
]);

/** 解析日期字符串为北京时区 Date（避免 UTC 环境偏差） */
function parseBeijingDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00+08:00`);
}

/** 判断是否为法定节假日（不含周末） */
export function isHoliday(dateStr: string): boolean {
  return HOLIDAYS_2026.has(dateStr);
}

/** 判断是否为周末 */
export function isWeekend(dateStr: string): boolean {
  const day = parseBeijingDate(dateStr).getDay();
  return day === 0 || day === 6;
}

/** 判断是否为 A 股交易日（排除周末 + 法定节假日） */
export function isTradingDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !isHoliday(dateStr);
}

/** 判断今天（北京时间）是否为交易日 */
export function isTradingDayToday(): boolean {
  const now = new Date();
  // 北京时间 = UTC + 8
  const bjDate = new Date(now.getTime() + 8 * 3600_000);
  const today = bjDate.toISOString().slice(0, 10);
  return isTradingDay(today);
}

/** 生成日期范围内的所有交易日列表（含首尾） */
export function getTradingDays(fromDate: string, toDate: string): string[] {
  const result: string[] = [];
  const cur = new Date(`${fromDate}T00:00:00+08:00`);
  const end = new Date(`${toDate}T00:00:00+08:00`);
  while (cur <= end) {
    const ds = cur.toISOString().slice(0, 10);
    if (isTradingDay(ds)) {
      result.push(ds);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

/** 返回给定日期的上一个交易日 */
export function prevTradingDay(dateStr: string): string {
  const cur = new Date(`${dateStr}T00:00:00+08:00`);
  while (true) {
    cur.setDate(cur.getDate() - 1);
    const ds = cur.toISOString().slice(0, 10);
    if (isTradingDay(ds)) return ds;
  }
}

/** 返回给定日期的下一个交易日 */
export function nextTradingDay(dateStr: string): string {
  const cur = new Date(`${dateStr}T00:00:00+08:00`);
  while (true) {
    cur.setDate(cur.getDate() + 1);
    const ds = cur.toISOString().slice(0, 10);
    if (isTradingDay(ds)) return ds;
  }
}
