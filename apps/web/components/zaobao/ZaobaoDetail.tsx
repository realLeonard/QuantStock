'use client';

import { useAppStore } from '@/store';
import styles from './ZaobaoDetail.module.css';
import DetailBackBar from '@/components/ui/DetailBackBar';
import DetailNav from '@/components/ui/DetailNav';

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
      <DetailBackBar
        onBack={() => setCurrentReportId(null)}
        title={`${report.report_date} 投资早报`}
      />

      <DetailNav>
        <span className="detail-nav-tag">
          {report.report_type === 'trading' ? '交易日早报' : '非交易日周报'}
        </span>
        <span className="detail-nav-text">
          生成于 {new Date(report.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
        </span>
      </DetailNav>

      <div className={styles.content}>
        {renderContent(report.content)}
      </div>
    </div>
  );
}
