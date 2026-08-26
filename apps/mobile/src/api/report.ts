import { backendRequest, ApiError } from './backend';
import type { DailyReport } from '@quantstock/types';

/** 获取日报列表（按日期倒序，分页，轻量字段） */
export async function fetchReportList(page = 1, pageSize = 20): Promise<DailyReport[]> {
  return backendRequest<DailyReport[]>(
    'GET',
    `/mobile/reports?page=${page}&pageSize=${pageSize}`
  );
}

/**
 * 获取指定日期的日报详情（含完整 content）
 * 当日内容非会员时服务端返回 403 UPGRADE_REQUIRED，
 * 调用方可通过 isUpgradeRequired(e) 判断并展示升级引导
 */
export async function fetchReportDetail(reportDate: string): Promise<DailyReport | null> {
  return backendRequest<DailyReport | null>(
    'GET',
    `/mobile/reports/${encodeURIComponent(reportDate)}`
  );
}

/** 获取最新一篇日报（列表页顶部置顶展示） */
export async function fetchLatestReport(): Promise<DailyReport | null> {
  return backendRequest<DailyReport | null>('GET', '/mobile/reports/latest');
}

/** 判断错误是否为「当日内容需要会员」（服务端 403 拦截） */
export function isUpgradeRequired(e: unknown): boolean {
  return e instanceof ApiError && e.code === 'UPGRADE_REQUIRED';
}
