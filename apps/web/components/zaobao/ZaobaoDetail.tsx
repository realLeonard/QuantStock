'use client';

import React from 'react';
import { useAppStore } from '@/store';
import styles from './ZaobaoDetail.module.css';
import DetailBackBar from '@/components/ui/DetailBackBar';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function weekdayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : `周${WEEKDAYS[d.getUTCDay()]}`;
}

/** 报告标题行形如「📰 投资早报  2026-09-22  08:00」 */
const REPORT_TITLE_RE = /^📰\s*(\S+)(?:\s+(\d{4}-\d{2}-\d{2}))?(?:\s+(\d{1,2}:\d{2}))?/;

/** 返回栏空间有限，生成时间省去年份和秒，只留「MM-DD HH:mm」 */
function formatGenTime(createdAtMs: number): string {
  return new Date(createdAtMs).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 页头一句话：优先取 30秒速读 的「⚡ 基调」（提示词限 40 字内），
 * 老报告没有该段时降级到 summary 首句（summary 全文有 200+ 字，不能直接上页头）
 */
function extractHeadline(content: string, summary: string): string {
  const tone = content.match(/⚡\s*\**基调\**[：:]\s*([^\n]+)/);
  if (tone) return tone[1].replace(/\*\*/g, '').trim();

  const first = summary.replace(/\*\*/g, '').split(/[。！？]/)[0].trim();
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}

/** 页头：布局对齐每日复盘全览页（大标题 + 金色角标 + 副信息行） */
function ReportHeader({
  titleLine,
  reportDate,
  typeLabel,
  headline,
}: {
  titleLine: string;
  reportDate: string;
  typeLabel: string;
  headline: string;
}) {
  const m = titleLine.match(REPORT_TITLE_RE);
  const name = m?.[1] ?? titleLine.replace(/^📰\s*/, '');
  const date = m?.[2] ?? reportDate;
  const time = m?.[3];

  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        <div className={styles.headerTitle}>
          📰 {name.length > 2 ? name.slice(0, -2) : name}
          {name.length > 2 && <em>{name.slice(-2)}</em>}
        </div>
        <div className={styles.headerBadge}>{typeLabel}</div>
      </div>
      <div className={styles.headerSub}>
        {date} {weekdayOf(date)}
        {time && ` · ${time} 发布`}
        {headline && (
          <>
            {' ｜ '}
            <b>{headline}</b>
          </>
        )}
      </div>
    </div>
  );
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

  const reportDate = report.report_date;
  const typeLabel = report.report_type === 'trading' ? '交易日早报' : '非交易日周报';
  const headline = extractHeadline(report.content, report.summary);

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

      // 分隔标题行：━━━ 只是纯文本装饰，交给 CSS 画色条
      if (line.startsWith('━━━')) {
        afterTitle = false;
        result.push(
          <div key={i} className={styles.secTitle}>{line.replace(/━+/g, '').trim()}</div>
        );
        i++;
        continue;
      }
      // 报告标题行
      if (line.startsWith('📰')) {
        afterTitle = true;
        result.push(
          <ReportHeader
            key={i}
            titleLine={line}
            reportDate={reportDate}
            typeLabel={typeLabel}
            headline={headline}
          />
        );
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
        actions={
          // 报告类型已移到正文页头的金色角标，这里只留生成时间
          <span className={styles.metaTime}>
            <span className={styles.metaTimeLabel}>生成 </span>
            {formatGenTime(report.created_at)}
          </span>
        }
      />

      <div className={styles.content}>
        {renderContent(report.content)}
      </div>
    </div>
  );
}
