'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import GoldDayCard from './GoldDayCard';
import styles from './GoldView.module.css';

// 从 overview（可能多行/带编号/带符号）里提取第一条有效描述
function firstOverviewLine(overview: string | null | undefined): string {
  if (!overview) return '';
  const lines = overview
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  // 去掉常见前缀：1. / 1、/ • / - / * / ① 等
  return lines[0].replace(/^([①-⑳]|[0-9]+[.、)）:：]|[-*•·])\s*/u, '').trim();
}

export default function GoldView() {
  const {
    recentInsights, dailyGoldPicks, themes,
    saveRecentInsights,
    setCurrentNav, setCurrentThemeId,
    currentUser,
  } = useAppStore();

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';
  const [editing, setEditing] = useState(false);
  const [thoughtsInput, setThoughtsInput] = useState('');
  const [focusInput, setFocusInput] = useState('');

  // 进入编辑态时填充当前值
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

  function handleCancel() {
    setEditing(false);
  }

  function goTheme(themeId: string) {
    setCurrentThemeId(themeId);
    setCurrentNav('themes');
  }

  const redThemes = themes.filter(t => t.title_color === 'red');
  const todayStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const updatedAt = recentInsights?.updated_at
    ? new Date(recentInsights.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '';

  return (
    <div>
      <PageHeader
        title="近期掘金"
        desc="近期投研思路、聚焦方向与每日掘金板块个股"
      />

      <div className={styles.wrap}>
        {/* 区块一：近期思路和方向（视觉重心） */}
        <div className={`${styles.card} ${styles.cardPrimary}`}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>📝 近期思路和方向</h3>
            <div className={styles.cardActions}>
              {!editing && canEdit && (
                <button className={styles.btn} onClick={() => setEditing(true)}>
                  编辑
                </button>
              )}
              {editing && (
                <>
                  <button className={styles.btn} onClick={handleCancel}>取消</button>
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleSave}
                  >
                    保存
                  </button>
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

          {updatedAt && !editing && (
            <div className={styles.updatedAt}>最后更新：{updatedAt}</div>
          )}

          {/* 子区：近期主题 */}
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

        {/* 区块二：每日掘金板块个股 */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>
              💎 每日掘金板块个股
              <span className={styles.titleDate}>（{todayStr}）</span>
            </h3>
            <div className={styles.cardActions}>
              <button className={styles.btn} disabled title="自动提取规则待确定">
                提取
              </button>
            </div>
          </div>

          {dailyGoldPicks.length === 0 ? (
            <div className={styles.emptyPlaceholder}>
              <div className={styles.emptyIcon}>📦</div>
              <div>暂无数据，等待自动提取规则确定后填充</div>
            </div>
          ) : (
            <div className={styles.dayList}>
              {dailyGoldPicks.map(pick => (
                <GoldDayCard key={pick.id} pick={pick} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
