'use client';

import { useAppStore } from '@/store';
import styles from './ZaobaoDetail.module.css';

export default function ZaobaoDetail() {
  const { reports, currentReportId, setCurrentReportId } = useAppStore();
  const report = reports.find(r => r.id === currentReportId);

  if (!report) {
    return (
      <div className={styles.notFound}>
        <p>未找到早报数据</p>
        <button className="btn-secondary" onClick={() => setCurrentReportId(null)}>返回列表</button>
      </div>
    );
  }

  // 简单渲染 Markdown（将分隔线和 emoji 保留，换行转 <br>）
  function renderContent(text: string) {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      // 分隔标题行
      if (line.startsWith('━━━')) {
        return <div key={i} className={styles.sectionTitle}>{line}</div>;
      }
      // 报告标题行
      if (line.startsWith('📰')) {
        return <div key={i} className={styles.reportTitle}>{line}</div>;
      }
      // 空行
      if (!line.trim()) {
        return <div key={i} className={styles.emptyLine} />;
      }
      return <div key={i} className={styles.line}>{line}</div>;
    });
  }

  return (
    <div>
      <div className="page-title">
        <button
          className={styles.backBtn}
          onClick={() => setCurrentReportId(null)}
          title="返回列表"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
        {report.report_date} 投资早报
      </div>

      <div className={styles.meta}>
        <span className={styles.metaTag}>
          {report.report_type === 'trading' ? '交易日早报' : '非交易日周报'}
        </span>
        <span className={styles.metaTime}>
          生成于 {new Date(report.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
        </span>
      </div>

      <div className={styles.content}>
        {renderContent(report.content)}
      </div>
    </div>
  );
}
