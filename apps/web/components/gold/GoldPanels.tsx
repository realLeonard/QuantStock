'use client';

/**
 * 「近期掘金」两张复用卡片：
 * - RecentInsightsCard：近期思路和方向（含近期主题标红列表）
 * - DailyGuidanceCard：每日掘金板块个股（解析早报「今日操作指引」表格）
 *
 * 同时被 近期掘金 (GoldView) 和 仪表盘 (Dashboard) 复用
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import GoldDayCard from './GoldDayCard';
import styles from './GoldView.module.css';
import type { DailyReport } from '@quantstock/types';

/** 从早报 content 里切出「今日操作指引」那张 markdown 表格 */
function extractGuidanceTable(
  content: string | null | undefined,
): { headers: string[]; rows: string[][] } | null {
  if (!content) return null;
  const startIdx = content.search(/━+\s*今日操作指引\s*━+/);
  if (startIdx < 0) return null;
  const rest = content.slice(startIdx);
  const nextSep = rest.slice(20).search(/━{2,}/);
  const section = nextSep >= 0 ? rest.slice(0, 20 + nextSep) : rest;

  const tableLines = section
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && l.endsWith('|'));
  if (tableLines.length < 2) return null;

  const splitRow = (line: string) =>
    line.slice(1, -1).split('|').map(c => c.trim());

  const headers = splitRow(tableLines[0]).map(h => h.replace(/\s+/g, ''));
  const rows = tableLines
    .slice(1)
    .filter(l => !/^\|\s*:?-+/.test(l))
    .map(splitRow)
    .filter(cells => cells.some(c => c.length > 0));
  if (rows.length === 0) return null;
  return { headers, rows };
}

/** 挑最近一份早报（优先今日，否则取最新 trading 报告） */
function pickLatestReport(reports: DailyReport[], todayStr: string): DailyReport | null {
  if (!reports || reports.length === 0) return null;
  const today = reports.find(r => r.report_date === todayStr);
  if (today) return today;
  const tradingSorted = reports
    .filter(r => r.report_type === 'trading')
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1));
  return tradingSorted[0] ?? reports[0] ?? null;
}

/** overview 首行剥离前缀 */
function firstOverviewLine(overview: string | null | undefined): string {
  if (!overview) return '';
  const lines = overview.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return lines[0].replace(/^([①-⑳]|[0-9]+[.、)）:：]|[-*•·])\s*/u, '').trim();
}

// ===== 区块一：近期思路和方向 =====
export function RecentInsightsCard({ showMoreLink = false }: { showMoreLink?: boolean } = {}) {
  const {
    recentInsights, themes,
    loadRecentInsights, loadThemes,
    saveRecentInsights,
    setCurrentNav, setCurrentThemeId,
    currentUser,
  } = useAppStore();

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';
  const [editing, setEditing] = useState(false);
  const [thoughtsInput, setThoughtsInput] = useState('');
  const [focusInput, setFocusInput] = useState('');

  // 按需加载：无论从哪个入口进来，确保数据齐全
  useEffect(() => {
    if (!recentInsights) loadRecentInsights();
    if (!themes || themes.length === 0) loadThemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing && recentInsights) {
      setThoughtsInput(recentInsights.thoughts || '');
      setFocusInput(recentInsights.focus_direction || '');
    }
  }, [editing, recentInsights]);

  async function handleSave() {
    await saveRecentInsights(thoughtsInput.trim(), focusInput.trim());
    setEditing(false);
  }

  function goTheme(themeId: string) {
    setCurrentThemeId(themeId);
    setCurrentNav('themes');
  }

  const redThemes = themes.filter(t => t.title_color === 'red');
  const updatedAt = recentInsights?.updated_at
    ? new Date(recentInsights.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '';

  return (
    <div className={`${styles.card} ${styles.cardPrimary}`}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          📝 近期思路和方向
          {updatedAt && (
            <span className={styles.titleDate}>（最后更新 {updatedAt}）</span>
          )}
          {showMoreLink && (
            <span
              className={styles.moreLink}
              onClick={() => setCurrentNav('gold')}
              role="link"
              tabIndex={0}
            >
              更多请查看【近期掘金】→
            </span>
          )}
        </h3>
        <div className={styles.cardActions}>
          {!editing && canEdit && (
            <button className={styles.btn} onClick={() => setEditing(true)}>编辑</button>
          )}
          {editing && (
            <>
              <button className={styles.btn} onClick={() => setEditing(false)}>取消</button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={handleSave}
              >保存</button>
            </>
          )}
        </div>
      </div>

      {!editing ? (
        <div className={styles.twoCol}>
          <div>
            <div className={styles.colLabel}>近期思路</div>
            <div className={styles.colText}>
              {recentInsights?.thoughts
                ? recentInsights.thoughts
                : <span className={styles.emptyText}>暂未录入</span>}
            </div>
          </div>
          <div>
            <div className={styles.colLabel}>聚焦方向</div>
            <div className={styles.colText}>
              {recentInsights?.focus_direction
                ? recentInsights.focus_direction
                : <span className={styles.emptyText}>暂未录入</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.twoCol}>
          <div>
            <div className={styles.colLabel}>近期思路</div>
            <textarea
              className={styles.textarea}
              rows={4}
              maxLength={2000}
              value={thoughtsInput}
              onChange={e => setThoughtsInput(e.target.value)}
              placeholder="请输入近期投研思路..."
            />
          </div>
          <div>
            <div className={styles.colLabel}>聚焦方向</div>
            <textarea
              className={styles.textarea}
              rows={4}
              maxLength={2000}
              value={focusInput}
              onChange={e => setFocusInput(e.target.value)}
              placeholder="请输入聚焦方向..."
            />
          </div>
        </div>
      )}

      <div className={styles.subSection}>
        <div className={styles.subTitle}>🔥 近期主题（标红）</div>
        {redThemes.length === 0 ? (
          <span className={styles.emptyText}>暂无标红主题</span>
        ) : (
          <ul className={styles.themeList}>
            {redThemes.map(t => {
              const firstLine = firstOverviewLine(t.overview);
              return (
                <li
                  key={t.id}
                  className={styles.themeListItem}
                  onClick={() => goTheme(t.id)}
                  title={t.overview}
                >
                  <span className={styles.themeListName}>{t.name}</span>
                  {firstLine && (
                    <span className={styles.themeListDesc}>{firstLine}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ===== 区块二：每日掘金板块个股 =====
export function DailyGuidanceCard() {
  const {
    dailyGoldPicks, reports,
    loadDailyGoldPicks, loadReports,
  } = useAppStore();

  useEffect(() => {
    if (!reports || reports.length === 0) loadReports();
    if (!dailyGoldPicks || dailyGoldPicks.length === 0) loadDailyGoldPicks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const latestReport = useMemo(() => pickLatestReport(reports, todayStr), [reports, todayStr]);
  const guidanceTable = useMemo(
    () => extractGuidanceTable(latestReport?.content),
    [latestReport],
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          💎 每日掘金板块个股
          <span className={styles.titleDate}>
            （引用早报「今日操作指引」{latestReport?.report_date ? ` · ${latestReport.report_date}` : ''}）
          </span>
        </h3>
      </div>

      {guidanceTable ? (
        <div className={styles.guidanceTableWrap}>
          <table className={styles.guidanceTable}>
            <thead>
              <tr>
                {guidanceTable.headers.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guidanceTable.rows.map((row, ri) => {
                const typeCell = row[0] ?? '';
                const rowClass = typeCell.includes('关注')
                  ? styles.rowWatch
                  : typeCell.includes('规避')
                    ? styles.rowAvoid
                    : '';
                return (
                  <tr key={ri} className={rowClass}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{cell || '—'}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.emptyPlaceholder}>
          <div className={styles.emptyIcon}>📦</div>
          <div>
            {reports.length === 0
              ? '早报加载中...'
              : '未在最近一份早报里解析到「今日操作指引」表格'}
          </div>
        </div>
      )}

      {dailyGoldPicks.length > 0 && (
        <div className={styles.dayList} style={{ marginTop: 14 }}>
          {dailyGoldPicks.map(pick => (
            <GoldDayCard key={pick.id} pick={pick} />
          ))}
        </div>
      )}
    </div>
  );
}
