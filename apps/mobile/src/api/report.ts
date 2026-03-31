import { supabaseRequest } from './supabase';
import type { DailyReport } from '@quantstock/types';

/** 获取日报列表（按日期倒序，分页） */
export async function fetchReportList(page = 1, pageSize = 20): Promise<DailyReport[]> {
  const offset = (page - 1) * pageSize;
  return supabaseRequest<DailyReport[]>('GET', 'dailyReports', undefined, {
    select: 'id,report_date,report_type,summary,created_at',
    order: 'report_date.desc',
    offset: String(offset),
    limit: String(pageSize),
  });
}

/** 获取指定日期的日报详情（含完整 content） */
export async function fetchReportDetail(reportDate: string): Promise<DailyReport | null> {
  const list = await supabaseRequest<DailyReport[]>('GET', 'dailyReports', undefined, {
    select: '*',
    report_date: `eq.${reportDate}`,
    limit: '1',
  });
  return list[0] ?? null;
}

/** 获取最新一篇日报（列表页顶部置顶展示） */
export async function fetchLatestReport(): Promise<DailyReport | null> {
  const list = await supabaseRequest<DailyReport[]>('GET', 'dailyReports', undefined, {
    select: 'id,report_date,report_type,summary,created_at',
    order: 'report_date.desc',
    limit: '1',
  });
  return list[0] ?? null;
}
