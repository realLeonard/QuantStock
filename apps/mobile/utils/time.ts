/**
 * 时间工具函数
 * 所有时间处理统一用北京时间（Asia/Shanghai）展示
 */

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-');
}

/** 格式化日期时间为 MM月DD日 HH:mm */
export function formatDateTime(utcMs: number): string {
  const d = new Date(utcMs);
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 获取北京时间今天的日期字符串 YYYY-MM-DD */
export function getTodayBj(): string {
  return formatDate(Date.now());
}

/** 计算剩余天数（基于 UTC 毫秒，向下取整） */
export function calcDaysLeft(expiredAtMs: number | null): number | null {
  if (expiredAtMs === null) return null;
  const diff = expiredAtMs - Date.now();
  if (diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/** 判断时间戳是否已过期 */
export function isExpired(expiredAtMs: number | null): boolean {
  if (expiredAtMs === null) return false; // null 表示永久
  return Date.now() > expiredAtMs;
}

/** 日期字符串是否是今天（北京时间） */
export function isToday(dateStr: string): boolean {
  return dateStr === getTodayBj();
}

/** 将 report_date 格式化为用户友好展示，如「3月31日 周一」 */
export function formatReportDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+08:00`); // 用北京时间正午解析
  return d.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
