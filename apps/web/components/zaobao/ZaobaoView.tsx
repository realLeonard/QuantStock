'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import styles from './ZaobaoView.module.css';
import ZaobaoDetail from './ZaobaoDetail';
import PageHeader from '@/components/ui/PageHeader';
import type { DailyReport } from '@quantstock/types';

// 报告类型中文标签
const TYPE_LABEL: Record<string, string> = {
  trading: '交易日早报',
  weekly: '非交易日周报',
};

// 提取卡片摘要：优先从市场基调提取一句话，否则降级到第一段有意义文本
function cleanMarkdown(text: string): string {
  const plain = text.replace(/\*\*/g, '');
  // 优先匹配①【市场基调】后面的内容
  const baseMatch = plain.match(/①\s*【市场基调】([^②\n]+)/);
  if (baseMatch) return baseMatch[1].trim();

  const lines = plain.split('\n');
  for (const line of lines) {
    const cleaned = line
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/#+\s*/g, '')
      .replace(/^[━─\-\s>]+/, '')
      .replace(/[━─]/g, '')
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]+\s*/g, '')
      .replace(/【.*?】/g, '')
      .replace(/^📰\s*/, '')
      .trim();
    if (
      cleaned.length > 15 &&
      !/^[-|*#>]/.test(cleaned) &&
      !/^投资早报\s+\d{4}/.test(cleaned) &&
      !/^今日核心/.test(cleaned)
    ) {
      return cleaned;
    }
  }
  return text.replace(/[*#━─📰\n]/g, ' ').trim().slice(0, 80);
}

export default function ZaobaoView() {
  const { reports, currentReportId, loadReports, setCurrentReportId } = useAppStore();

  useEffect(() => {
    loadReports();
  }, []);

  // 若有选中报告，展示详情
  if (currentReportId) {
    return <ZaobaoDetail />;
  }

  return (
    <div>
      <PageHeader title="每日早报" desc="AI 生成的每日 A 股投资早报，覆盖七大维度市场分析。" />

      {reports.length === 0 ? (
        <div className={styles.empty}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <p>暂无早报数据</p>
          <span>早报将于每日 08:00 自动生成</span>
        </div>
      ) : (
        <div className={styles.list}>
          {reports.map((report: DailyReport) => (
            <div
              key={report.id}
              className={styles.card}
              onClick={() => setCurrentReportId(report.id)}
            >
              <div className={styles.cardHeader}>
                <div className={styles.date}>{report.report_date}</div>
                <span className={`${styles.typeBadge} ${report.report_type === 'weekly' ? styles.weekly : styles.trading}`}>
                  {TYPE_LABEL[report.report_type] ?? report.report_type}
                </span>
              </div>
              <div className={styles.summary}>{cleanMarkdown(report.summary)}</div>
              <div className={styles.cardFooter}>
                <span className={styles.readMore}>阅读全文 →</span>
                <span className={styles.time}>
                  {new Date(report.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
