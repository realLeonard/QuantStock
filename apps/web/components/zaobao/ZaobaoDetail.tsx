'use client';

import React from 'react';
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
    let afterTitle = false;
    const result: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 检测 Markdown 表格：当前行是表格行，下一行是分隔行（|---|）
      if (
        /^\|/.test(line) &&
        i + 1 < lines.length &&
        /^\|[\s\-:]+\|/.test(lines[i + 1])
      ) {
        // 收集连续表格行
        const tableLines: string[] = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          tableLines.push(lines[i]);
          i++;
        }
        // 解析表头、分隔行、数据行
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(cell => cell.trim());

        const headers = parseRow(tableLines[0]);
        const dataRows = tableLines.slice(2); // 跳过分隔行

        result.push(
          <div key={`table-${i}`} className={`${styles.tableWrapper} m-cardify-wrap`}>
            <table className={`${styles.table} m-cardify m-cardify-dark`}>
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri}>
                    {parseRow(row).map((cell, ci) => (
                      <td key={ci} data-label={headers[ci]}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // 分隔标题行
      if (line.startsWith('━━━')) {
        afterTitle = false;
        result.push(<div key={i} className={styles.sectionTitle}>{line}</div>);
        i++;
        continue;
      }
      // 报告标题行
      if (line.startsWith('📰')) {
        afterTitle = true;
        result.push(<div key={i} className={styles.reportTitle}>{line}</div>);
        i++;
        continue;
      }
      // 跳过紧跟在报告标题后的 --- 分隔线
      if (afterTitle && /^---+$/.test(line.trim())) {
        i++;
        continue;
      }
      afterTitle = false;
      // 空行
      if (!line.trim()) {
        result.push(<div key={i} className={styles.emptyLine} />);
        i++;
        continue;
      }
      result.push(<div key={i} className={styles.line}>{line}</div>);
      i++;
    }

    return result;
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
