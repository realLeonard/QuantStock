'use client';

/**
 * 「近期掘金」两张复用卡片：
 * - RecentInsightsCard：近期思路和方向（含近期主题标红列表）
 * - DailyGuidanceCard：每日掘金板块个股（解析早报「今日操作指引」表格）
 *
 * 同时被 近期掘金 (GoldView) 和 仪表盘 (Dashboard) 复用
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import GoldDayCard from './GoldDayCard';
import styles from './GoldView.module.css';
import type { DailyReport, ReviewResult, ReviewSector, ReviewStock } from '@quantstock/types';

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

/** overview 首行剥离前缀，跳过纯标签行（如"产业信息："） */
function firstOverviewLine(overview: string | null | undefined): string {
  if (!overview) return '';
  const lines = overview.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  // 跳过"产业信息："等纯分类标签行，取第一行有实际内容的
  const idx = lines.findIndex(l => !/^[\u4e00-\u9fa5]{2,6}[：:]\s*$/.test(l) && l.length > 6);
  const line = lines[idx >= 0 ? idx : 0];
  return line.replace(/^([①-⑳]|[0-9]+[.、)）:：]|[-*•·])\s*/u, '').trim();
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

// ===== 区块三：每日掘金回测结果（板块 + 个股双维度命中） =====
function fmtPct(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}

function pctClass(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return styles.pctZero;
  if (p > 0) return styles.pctPos;
  if (p < 0) return styles.pctNeg;
  return styles.pctZero;
}

function renderStockCell(stocks: ReviewStock[]): React.ReactNode {
  if (!stocks || stocks.length === 0) return <span className={styles.reviewStockUnmapped}>—</span>;
  return (
    <div className={styles.reviewStockInline}>
      {stocks.map((s, i) => {
        const cls = s.unmapped
          ? styles.reviewStockUnmapped
          : s.hit
            ? styles.reviewStockHit
            : styles.reviewStockMiss;
        const label = s.unmapped
          ? `${s.name}（${s.error ?? '无数据'}）`
          : `${s.name} ${fmtPct(s.change_pct)} ${s.hit ? '✅' : '❌'}`;
        return (
          <span key={i}>
            {i > 0 && <span className={styles.reviewStockSep}>/</span>}
            <span className={cls}>{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function renderSectorRow(
  sec: ReviewSector,
  direction: 'watch' | 'avoid',
  keyPrefix: string,
): React.ReactNode {
  const dirLabel = direction === 'watch' ? '🎯 关注' : '⚠️ 规避';
  const rowClass = direction === 'watch' ? styles.rowWatch : styles.rowAvoid;

  const sectorCell = (
    <>
      <div>{sec.text}</div>
      {sec.matched && sec.matched !== sec.text && (
        <span className={styles.reviewMatched}>→ {sec.matched}</span>
      )}
      {!sec.matched && <span className={styles.reviewMatched}>板块未匹配</span>}
    </>
  );

  if (sec.unmapped) {
    return (
      <tr key={keyPrefix} className={rowClass}>
        <td>{dirLabel}</td>
        <td>{sectorCell}</td>
        <td className={styles.pctZero}>—</td>
        <td className={styles.pctZero}>—</td>
        <td className={styles.pctZero}>—</td>
        <td>{renderStockCell(sec.stocks)}</td>
      </tr>
    );
  }

  return (
    <tr key={keyPrefix} className={rowClass}>
      <td>{dirLabel}</td>
      <td>{sectorCell}</td>
      <td className={pctClass(sec.change_pct)}>{fmtPct(sec.change_pct)}</td>
      <td className={pctClass(sec.excess_pct)}>{fmtPct(sec.excess_pct)}</td>
      <td>{sec.hit === undefined ? '—' : sec.hit ? '✅' : '❌'}</td>
      <td>{renderStockCell(sec.stocks)}</td>
    </tr>
  );
}

/** 在 reports 里找最近一份 review_result 非空的 trading 报告 */
function pickLatestReviewReport(reports: DailyReport[]): DailyReport | null {
  if (!reports || reports.length === 0) return null;
  const sorted = reports
    .filter(r => r.report_type === 'trading' && r.review_result)
    .sort((a, b) => (a.report_date < b.report_date ? 1 : -1));
  return sorted[0] ?? null;
}

export function ReviewResultCard() {
  const { reports, loadReports } = useAppStore();

  useEffect(() => {
    if (!reports || reports.length === 0) loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const latest = useMemo(() => pickLatestReviewReport(reports), [reports]);
  const result: ReviewResult | null = latest?.review_result ?? null;

  const allSectors = result ? [...(result.watch ?? []), ...(result.avoid ?? [])] : [];
  const usesExcess = allSectors.some(s => s.hit_basis === 'excess');
  const sectorBasisLabel = usesExcess ? '超额≥0.3%' : '绝对≥0.3%';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          🎯 T-1 板块 / 个股回测
          {result && (
            <span className={styles.titleDate}>
              （{result.target_date}，与早报「今日操作指引」对比当日实际行情）
            </span>
          )}
        </h3>
      </div>

      {!result ? (
        <div className={styles.emptyPlaceholder}>
          <div className={styles.emptyIcon}>📊</div>
          <div>
            {reports.length === 0
              ? '早报加载中...'
              : '最近一份早报尚未完成 T-1 板块/个股回测'}
          </div>
        </div>
      ) : (
        <>
          <div className={styles.reviewSummary}>
            <span className={styles.reviewSummaryItem}>
              <span className={styles.reviewSummaryLabel}>沪深300</span>
              <span className={`${styles.reviewSummaryValue} ${pctClass(result.hs300_pct)}`}>
                {fmtPct(result.hs300_pct)}
              </span>
            </span>
            <span className={styles.reviewSummaryItem}>
              <span className={styles.reviewSummaryLabel}>板块命中</span>
              <span className={styles.reviewSummaryValue}>{result.hit_rate}</span>
              <span className={styles.reviewSummaryNote}>（{sectorBasisLabel}）</span>
            </span>
            <span className={styles.reviewSummaryItem}>
              <span className={styles.reviewSummaryLabel}>个股命中</span>
              <span className={styles.reviewSummaryValue}>
                {result.stock_hit_rate ?? `${result.stock_hit_count ?? 0}/${result.stock_total ?? 0}`}
              </span>
              <span className={styles.reviewSummaryNote}>（绝对≥1%）</span>
            </span>
          </div>

          <div className={styles.reviewTableWrap}>
            <table className={styles.reviewTable}>
              <thead>
                <tr>
                  <th>方向</th>
                  <th>板块</th>
                  <th>板块涨跌</th>
                  <th>超额</th>
                  <th>命中</th>
                  <th>重点个股</th>
                </tr>
              </thead>
              <tbody>
                {(result.watch ?? []).map((s, i) => renderSectorRow(s, 'watch', `w-${i}`))}
                {(result.avoid ?? []).map((s, i) => renderSectorRow(s, 'avoid', `a-${i}`))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
