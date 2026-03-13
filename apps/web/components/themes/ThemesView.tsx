'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import ThemeModal from './ThemeModal';
import StocksView from '@/components/stocks/StocksView';
import type { Theme } from '@quantstock/types';

export default function ThemesView() {
  const { themes, currentThemeId, setCurrentThemeId, deleteTheme, currentUser } = useAppStore();
  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'editor';
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  // 如果有 currentThemeId，显示股票池子视图
  if (currentThemeId) {
    return <StocksView />;
  }

  function openCreate() {
    setEditingTheme(null);
    setModalOpen(true);
  }

  function openEdit(theme: Theme) {
    setEditingTheme(theme);
    setModalOpen(true);
  }

  async function handleDelete(theme: Theme) {
    if (!confirm(`确认删除主题「${theme.name}」？\n主题下的股票池数据也将一并删除。`)) return;
    await deleteTheme(theme.id);
  }

  return (
    <>
      <div className="section-header">
        <div>
          <div className="page-title">主题管理</div>
          <div className="page-desc" style={{ marginBottom: 0 }}>管理您的所有投资主题及关联股票池</div>
        </div>
        <div className="search-bar">
          <svg className="search-bar-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="search-bar-input"
            type="text"
            placeholder="搜索主题名称…"
            value={searchKeyword}
            onChange={e => setSearchKeyword(e.target.value)}
          />
          {searchKeyword && (
            <button className="search-bar-clear" onClick={() => setSearchKeyword('')} title="清除">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
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
      ) : (() => {
        const filtered = (searchKeyword.trim()
          ? themes.filter(t => t.name.includes(searchKeyword.trim()))
          : themes
        ).slice().sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
        return filtered.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🔍</span>
            <p>未找到匹配「{searchKeyword.trim()}」的主题</p>
          </div>
        ) : (
        <div className="themes-grid">
          {filtered.map(theme => {
            const stocks = theme.stocks || [];
            const top3 = [...stocks].sort((a, b) => b.stars - a.stars).slice(0, 3);
            const moreCount = stocks.length > 3 ? stocks.length - 3 : 0;

            return (
              <div key={theme.id} className="theme-card">
                <div className="theme-card-header">
                  <div className="theme-name">{theme.name}</div>
                  <span className="theme-count-badge">{stocks.length} 支</span>
                </div>
                {theme.overview ? (
                  <div className="theme-overview">{theme.overview}</div>
                ) : <div style={{ height: 8 }} />}
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
                      {moreCount > 0 && <span className="mini-badge" style={{ color: '#94a3b8' }}>+{moreCount}</span>}
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>暂无股票</span>
                  )}
                </div>
                <div className="theme-card-footer">
                  <div className="theme-meta">📅 {fmtDate(theme.created_at)}</div>
                  <div className="theme-actions">
                    {canEdit && (
                      <button className="btn-icon" onClick={() => openEdit(theme)} title="编辑">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                    {canEdit && (
                      <button className="btn-icon danger" onClick={() => handleDelete(theme)} title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    )}
                    <button
                      className="btn-primary"
                      style={{ padding: '5px 12px', fontSize: '12.5px' }}
                      onClick={() => setCurrentThemeId(theme.id)}
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
          })}
        </div>
        );
      })()}

      {modalOpen && (
        <ThemeModal
          theme={editingTheme}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}
