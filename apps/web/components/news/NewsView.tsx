'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import styles from './NewsView.module.css';

const PRIORITY_CATS = new Set(['A股', '热门']);

const LEVEL_LABEL: Record<string, string> = { A: '重大', B: '重要', C: '一般' };
const LEVEL_CLASS: Record<string, string> = { A: styles.levelA, B: styles.levelB, C: styles.levelC };

export default function NewsView() {
  const { newsItems, newsDate, loadNewsItems } = useAppStore();
  const [titleFilter, setTitleFilter] = useState('');

  const sorted = useMemo(() => {
    const kw = titleFilter.trim().toLowerCase();
    const filtered = kw
      ? newsItems.filter(n => n.title.toLowerCase().includes(kw) || n.summary.toLowerCase().includes(kw))
      : newsItems;

    return [...filtered].sort((a, b) => {
      const aPriority = a.categories.some(c => PRIORITY_CATS.has(c)) ? 0 : 1;
      const bPriority = b.categories.some(c => PRIORITY_CATS.has(c)) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return b.published_at - a.published_at;
    });
  }, [newsItems, titleFilter]);

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    loadNewsItems(e.target.value);
  }

  return (
    <div>
      <div className="section-header">
        <PageHeader title="今日资讯" desc="财联社新闻资讯，A股/热门优先展示" />
      </div>

      <div className={styles.filterBar}>
        <input
          type="date"
          className={styles.dateInput}
          value={newsDate}
          onChange={handleDateChange}
        />
        <div className="search-bar" style={{ flex: 1, maxWidth: 320 }}>
          <span className="search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="搜索标题或摘要..."
            value={titleFilter}
            onChange={e => setTitleFilter(e.target.value)}
          />
          {titleFilter && (
            <button className="search-clear" onClick={() => setTitleFilter('')}>×</button>
          )}
        </div>
        <span className={styles.count}>{sorted.length} 条</span>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📭</span>
          <p>暂无资讯数据</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colTime}>发布时间</th>
                <th className={styles.colContent}>标题 / 摘要</th>
                <th className={styles.colCats}>分类</th>
                <th className={styles.colLevel}>重要程度</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(item => (
                <tr key={item.id} className={styles.row}>
                  <td className={styles.colTime}>
                    <span className={styles.time}>{formatTime(item.published_at)}</span>
                  </td>
                  <td className={styles.colContent}>
                    <div className={styles.title}>
                      {item.title}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.sourceLink}
                        >
                          查看原文
                        </a>
                      )}
                    </div>
                    {item.summary && (
                      <div className={styles.summary}>{item.summary}</div>
                    )}
                  </td>
                  <td className={styles.colCats}>
                    <div className={styles.cats}>
                      {item.categories.map(c => (
                        <span
                          key={c}
                          className={`${styles.cat} ${PRIORITY_CATS.has(c) ? styles.catPriority : ''}`}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={styles.colLevel}>
                    <span className={`${styles.level} ${LEVEL_CLASS[item.level] ?? styles.levelC}`}>
                      {LEVEL_LABEL[item.level] ?? item.level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
