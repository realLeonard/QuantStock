'use client';

import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import ThemeModal from '@/components/themes/ThemeModal';
import { useState } from 'react';
import type { Theme } from '@quantstock/types';

export default function Dashboard() {
  const { themes, setCurrentThemeId, setCurrentNav, currentUser } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';

  const allStocks = themes.flatMap(t => t.stocks || []);
  const highlightCount = allStocks.filter(s => s.highlight === 'red' || s.highlight === 'orange').length;
  const avgStars = allStocks.length
    ? (allStocks.reduce((s, x) => s + (x.stars || 0), 0) / allStocks.length).toFixed(1)
    : '—';

  function openEdit(theme: Theme) {
    setEditingTheme(theme);
    setModalOpen(true);
  }

  function openCreate() {
    setEditingTheme(null);
    setModalOpen(true);
  }

  function handleManage(themeId: string) {
    setCurrentThemeId(themeId);
    setCurrentNav('themes');
  }

  return (
    <>
      <div className="page-title">仪表盘</div>
      <div className="page-desc">欢迎回来，{currentUser?.username}！以下是您的股票池概览。</div>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          </div>
          <div>
            <div className="stat-label">主题总数</div>
            <div className="stat-value">{themes.length}</div>
            <div className="stat-sub">个投资主题</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <div>
            <div className="stat-label">股票总数</div>
            <div className="stat-value">{allStocks.length}</div>
            <div className="stat-sub">条记录（含重复）</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
            </svg>
          </div>
          <div>
            <div className="stat-label">重点标记</div>
            <div className="stat-value">{highlightCount}</div>
            <div className="stat-sub">红/橙高亮股票</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div>
            <div className="stat-label">平均星级</div>
            <div className="stat-value">{avgStars}</div>
            <div className="stat-sub">综合重要性评分</div>
          </div>
        </div>
      </div>

      {/* 主题列表 */}
      <div className="section-header">
        <div className="section-title">投资主题</div>
        {canEdit && (
          <button className="btn-primary" onClick={openCreate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            新增主题
          </button>
        )}
      </div>

      {themes.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📭</span>
          <p>暂无主题，点击「新增主题」开始</p>
        </div>
      ) : (
        <div className="themes-grid">
          {themes.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              onEdit={() => openEdit(theme)}
              onManage={() => handleManage(theme.id)}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <ThemeModal
          theme={editingTheme}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function ThemeCard({ theme, onEdit, onManage }: {
  theme: Theme;
  onEdit: () => void;
  onManage: () => void;
}) {
  const { deleteTheme, currentUser } = useAppStore();
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';
  const stocks = theme.stocks || [];
  const top3 = [...stocks].sort((a, b) => b.stars - a.stars).slice(0, 3);
  const moreCount = stocks.length > 3 ? stocks.length - 3 : 0;

  async function handleDelete() {
    if (!confirm(`确认删除主题「${theme.name}」？\n主题下的股票池数据也将一并删除。`)) return;
    await deleteTheme(theme.id);
  }

  return (
    <div className="theme-card">
      <div className="theme-card-header">
        <div className="theme-name">{theme.name}</div>
        <span className="theme-count-badge">{stocks.length} 支</span>
      </div>
      {theme.overview ? (
        <div className="theme-overview">{theme.overview}</div>
      ) : (
        <div style={{ height: 8 }} />
      )}
      <div className="theme-stocks-preview">
        {top3.length > 0 ? (
          <>
            {top3.map(s => (
              <span key={s.id} className="mini-badge">
                <span className="stars-mini">{'★'.repeat(s.stars)}</span>
                <span style={{ fontWeight: 600 }}>{s.code}</span>
                <span style={{ color: '#64748b' }}>{s.name}</span>
              </span>
            ))}
            {moreCount > 0 && (
              <span className="mini-badge" style={{ color: '#94a3b8' }}>+{moreCount}</span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>暂无股票</span>
        )}
      </div>
      <div className="theme-card-footer">
        <div className="theme-meta">📅 {fmtDate(theme.created_at)}</div>
        <div className="theme-actions">
          {canEdit && (
            <button className="btn-icon" onClick={onEdit} title="编辑主题">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {canEdit && (
            <button className="btn-icon danger" onClick={handleDelete} title="删除主题">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
          <button
            className="btn-primary"
            style={{ padding: '5px 12px', fontSize: '12.5px' }}
            onClick={onManage}
          >
            管理
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/>
              <polyline points="12 5 19 12 12 19"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
