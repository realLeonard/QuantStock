'use client';

import { useState, useMemo, useRef } from 'react';
import { useAppStore } from '@/store';
import type { NewsItem } from '@/store';
import type { NewsArticleBlock } from '@quantstock/types';
import { apiClient } from '@/lib/supabase';
import PageHeader from '@/components/ui/PageHeader';
import styles from './NewsView.module.css';

const LEVEL_LABEL: Record<string, string> = { A: '重大', B: '重要' };
const LEVEL_CLASS: Record<string, string> = { A: styles.levelA, B: styles.levelB };
const CLS_DETAIL_RE = /^https:\/\/www\.cls\.cn\/detail\/(\d{1,12})$/;

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDateTitle(date: string): { day: string; weekday: string } {
  const d = new Date(`${date}T12:00:00+08:00`);
  const [, m, dd] = date.split('-').map(Number);
  const weekday = d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' });
  return { day: `${m}月${dd}日`, weekday };
}

type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; blocks: NewsArticleBlock[] };

function ArticleBody({ state, url, onRetry }: {
  state: ArticleState;
  url: string;
  onRetry: () => void;
}) {
  if (state.status === 'loading') {
    return <div className={styles.articleHint}>正在加载原文…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className={styles.articleHint}>
        {state.message}
        <button type="button" className={styles.retryBtn} onClick={onRetry}>重试</button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.fallbackLink}>
          去财联社查看
        </a>
      </div>
    );
  }
  if (state.status !== 'done') return null;
  return (
    <div className={styles.article}>
      {state.blocks.map((b, i) =>
        b.type === 'text' ? (
          <p key={i}>{b.text}</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={b.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
        )
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const levelLabel = LEVEL_LABEL[item.level];
  const articleId = item.url.match(CLS_DETAIL_RE)?.[1];
  const [expanded, setExpanded] = useState(false);
  const [article, setArticle] = useState<ArticleState>({ status: 'idle' });

  async function loadArticle(id: string) {
    setArticle({ status: 'loading' });
    try {
      setArticle({ status: 'done', blocks: await apiClient.getClsArticle(id) });
    } catch (e) {
      setArticle({ status: 'error', message: e instanceof Error ? e.message : '原文加载失败' });
    }
  }

  function toggleArticle() {
    if (!articleId) return;
    const next = !expanded;
    setExpanded(next);
    if (next && (article.status === 'idle' || article.status === 'error')) {
      loadArticle(articleId);
    }
  }

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.tags}>
          <span className={styles.source}>财联社</span>
          {item.categories.map(c => (
            <span key={c} className={styles.catTag}>✦ {c}</span>
          ))}
          {levelLabel && (
            <span className={`${styles.levelTag} ${LEVEL_CLASS[item.level]}`}>
              <span className={styles.levelDot} />
              {levelLabel}
            </span>
          )}
        </div>
        {articleId && (
          <button
            type="button"
            className={styles.sourceLink}
            onClick={toggleArticle}
            aria-expanded={expanded}
          >
            {expanded ? '收起原文' : '阅读原文'}
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              className={expanded ? styles.chevronUp : undefined}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>
      <h3 className={styles.title}>{item.title}</h3>
      {item.summary && item.summary !== item.title && (
        <p className={styles.summary}>{item.summary}</p>
      )}
      {expanded && (
        <ArticleBody
          state={article}
          url={item.url}
          onRetry={() => articleId && loadArticle(articleId)}
        />
      )}
    </article>
  );
}

export default function NewsView() {
  const { newsItems, newsDate, loadNewsItems } = useAppStore();
  const [keyword, setKeyword] = useState('');
  const dateInputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const filtered = kw
      ? newsItems.filter(n =>
          n.title.toLowerCase().includes(kw) || n.summary.toLowerCase().includes(kw)
        )
      : newsItems;
    return [...filtered].sort((a, b) => b.published_at - a.published_at);
  }, [newsItems, keyword]);

  // 首次加载返回前 newsDate 为空，先按北京时间今天展示
  const displayDate = newsDate || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const { day, weekday } = formatDateTitle(displayDate);

  function openDatePicker() {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  }

  return (
    <div>
      <PageHeader title="今日资讯" desc="财联社精选最重要的财经资讯" />

      <div className={styles.dateBar}>
        <div className={styles.dateTitleWrap}>
          <button type="button" className={styles.dateTitle} onClick={openDatePicker} title="选择日期">
            {day}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <input
            ref={dateInputRef}
            type="date"
            className={styles.hiddenDate}
            value={displayDate}
            onChange={e => e.target.value && loadNewsItems(e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
          />
          <span className={styles.dateMeta}>{weekday} · {sorted.length} 条</span>
        </div>

        <div className={styles.search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="搜索资讯"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          {keyword && (
            <button type="button" onClick={() => setKeyword('')} title="清除">×</button>
          )}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📭</span>
          <p>{keyword ? '没有匹配的资讯' : '暂无资讯数据'}</p>
        </div>
      ) : (
        <ol className={styles.timeline}>
          {sorted.map(item => (
            <li key={item.id} className={styles.entry}>
              <div className={styles.timeCol}>
                <time className={styles.clock}>{formatClock(item.published_at)}</time>
                <span className={styles.dot} />
              </div>
              <NewsCard item={item} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
