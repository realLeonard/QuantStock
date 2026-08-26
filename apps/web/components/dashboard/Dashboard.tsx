'use client';

import { useAppStore } from '@/store';
import { fmtDate, maskUsername } from '@/lib/utils';
import ThemeModal from '@/components/themes/ThemeModal';
import PageHeader from '@/components/ui/PageHeader';
import { RecentInsightsCard } from '@/components/gold/GoldPanels';
import goldStyles from '@/components/gold/GoldView.module.css';
import { useState } from 'react';
import type { Theme } from '@quantstock/types';

export default function Dashboard() {
  const { themes, setCurrentThemeId, setCurrentNav, currentUser } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);

  function openEdit(theme: Theme) {
    setEditingTheme(theme);
    setModalOpen(true);
  }

  function handleManage(themeId: string) {
    setCurrentThemeId(themeId);
    setCurrentNav('themes');
  }

  return (
    <>
      <PageHeader
        title="仪表盘"
        desc={`欢迎回来，${currentUser?.username ? maskUsername(currentUser.username) : '用户'}！`}
      />

      {/* 近期思路和方向（复用自近期掘金，标题附「更多」跳转） */}
      <div className={goldStyles.wrap} style={{ marginBottom: 20 }}>
        <RecentInsightsCard showMoreLink />
      </div>

      {/* 主题列表 */}
      <div className="section-header">
        <div className="section-title">投资主题</div>
      </div>

      {themes.length === 0 ? (
        <div className="empty-state">
          <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📭</span>
          <p>暂无主题，点击「新增主题」开始</p>
        </div>
      ) : (
        <div className="themes-grid">
          {[...themes].sort((a, b) => {
            const aHas = a.sort_order != null;
            const bHas = b.sort_order != null;
            if (aHas && bHas) return a.sort_order! - b.sort_order!;
            if (aHas) return -1;
            if (bHas) return 1;
            return (b.updated_at ?? 0) - (a.updated_at ?? 0);
          }).slice(0, 15).map(theme => (
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
        <div
          className="theme-name"
          style={theme.title_color === 'red' ? { color: '#ef4444' } : undefined}
        >{theme.name}</div>
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
