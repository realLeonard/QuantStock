'use client';

import { useAppStore } from '@/store';
import styles from './ZaobaoDetail.module.css';
import DetailBackBar from '@/components/ui/DetailBackBar';
import DetailNav from '@/components/ui/DetailNav';
import type { DailyReport } from '@quantstock/types';

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

function downloadHtml(report: DailyReport) {
  const lines = report.content.split('\n').map(line => {
    // 章节标题：## ━━━ xxx ━━━ 或直接 ━━━ xxx ━━━
    if (/^#{0,3}\s*━━━/.test(line)) {
      const title = line.replace(/^#+\s*/, '');
      return `<div class="section-title">${escapeHtml(title)}</div>`;
    }
    // 报告标题行
    if (line.startsWith('📰')) {
      const rendered = renderMarkdown(line);
      return `<div class="report-title">${rendered}</div>`;
    }
    // 分隔线
    if (/^---+$/.test(line.trim())) {
      return `<hr>`;
    }
    // 空行
    if (!line.trim()) {
      return `<div class="empty-line"></div>`;
    }
    return `<div class="line">${renderMarkdown(line)}</div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.report_date} 投资早报 · 股海远洋</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #1a1d23; margin: 0; padding: 20px; }
    .container { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
    .meta { color: #888; font-size: 13px; margin-bottom: 20px; }
    .report-title { font-size: 18px; font-weight: 700; padding: 4px 0 14px; border-bottom: 1px solid #eee; margin-bottom: 16px; }
    .section-title { font-size: 13px; font-weight: 600; color: #2563eb; padding: 14px 0 6px; letter-spacing: 0.5px; }
    .line { font-size: 14px; line-height: 1.9; padding: 1px 0; white-space: pre-wrap; word-break: break-word; }
    .empty-line { height: 8px; }
    hr { border: none; border-top: 1px solid #eee; margin: 12px 0; }
    code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 13px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #aaa; text-align: center; }
    @media print { body { background: #fff; } .container { box-shadow: none; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="meta">股海远洋 · 投资早报 · ${report.report_date}</div>
    ${lines}
    <div class="footer">由股海远洋 AI 自动生成 · ${new Date(report.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  const typeLabel = report.report_type === 'trading' ? '交易日早报' : '周报';
  a.download = `${report.report_date}-${typeLabel}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
    let afterTitle = false;
    return lines.map((line, i) => {
      // 分隔标题行
      if (line.startsWith('━━━')) {
        afterTitle = false;
        return <div key={i} className={styles.sectionTitle}>{line}</div>;
      }
      // 报告标题行
      if (line.startsWith('📰')) {
        afterTitle = true;
        return <div key={i} className={styles.reportTitle}>{line}</div>;
      }
      // 跳过紧跟在报告标题后的 --- 分隔线
      if (afterTitle && /^---+$/.test(line.trim())) {
        return null;
      }
      afterTitle = false;
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
        actions={
          <button className="btn-secondary" onClick={() => downloadHtml(report)}>
            下载早报
          </button>
        }
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
