/**
 * 本地缓存管理
 * - 非当日日报：可缓存（支持离线阅读）
 * - 当日内容：不缓存（防付费绕过）
 */
import { isToday } from './time';

const CACHE_PREFIX = 'qs_';
const REPORT_DETAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 非当日报告缓存 7 天

interface CacheItem<T> {
  data: T;
  expiredAt: number;
}

/** 写入缓存 */
function setCache<T>(key: string, data: T, ttlMs: number): void {
  const item: CacheItem<T> = {
    data,
    expiredAt: Date.now() + ttlMs,
  };
  try {
    uni.setStorageSync(CACHE_PREFIX + key, JSON.stringify(item));
  } catch {
    // 存储失败静默处理
  }
}

/** 读取缓存（过期返回 null） */
function getCache<T>(key: string): T | null {
  try {
    const raw = uni.getStorageSync(CACHE_PREFIX + key);
    if (!raw) return null;
    const item = JSON.parse(raw) as CacheItem<T>;
    if (Date.now() > item.expiredAt) {
      uni.removeStorageSync(CACHE_PREFIX + key);
      return null;
    }
    return item.data;
  } catch {
    return null;
  }
}

/** 缓存日报详情（仅缓存非当日内容） */
export function cacheReportDetail<T>(reportDate: string, data: T): void {
  if (isToday(reportDate)) return; // 当日内容不缓存
  setCache(`report_detail_${reportDate}`, data, REPORT_DETAIL_TTL);
}

/** 读取日报详情缓存 */
export function getCachedReportDetail<T>(reportDate: string): T | null {
  if (isToday(reportDate)) return null; // 当日内容不读缓存
  return getCache<T>(`report_detail_${reportDate}`);
}

/** 清除所有 App 缓存（"设置"页删除缓存功能） */
export function clearAllCache(): void {
  try {
    const keys = uni.getStorageInfoSync().keys;
    keys
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => uni.removeStorageSync(k));
  } catch {
    // 静默失败
  }
}

/** 计算缓存占用大小（近似值，单位 KB） */
export function getCacheSize(): number {
  try {
    const info = uni.getStorageInfoSync();
    return Math.round(info.currentSize);
  } catch {
    return 0;
  }
}
