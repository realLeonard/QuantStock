'use client';

import { useAppStore } from '@/store';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';

interface Props {
  children: React.ReactNode;
}

// 角色中文名映射
const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '观察者',
};

export default function AdminLayout({ children }: Props) {
  const {
    themes, currentNav, setCurrentNav, logout,
    setCurrentThemeId, setCurrentReportId, currentUser, systemMenuOpen, toggleSystemMenu,
  } = useAppStore();

  function handleNav(nav: 'dashboard' | 'themes' | 'users' | 'roles' | 'zaobao' | 'breadth' | 'news') {
    setCurrentThemeId(null);
    setCurrentReportId(null);
    setCurrentNav(nav);
    if (nav === 'dashboard') {
      useAppStore.getState().loadThemes();
    }
    if (nav === 'users') {
      useAppStore.getState().loadUsers();
    }
    if (nav === 'zaobao') {
      useAppStore.getState().loadReports();
    }
    if (nav === 'breadth') {
      useAppStore.getState().loadBreadth('recent30');
    }
    if (nav === 'news') {
      useAppStore.getState().loadNewsItems();
    }
  }

  function handleLogout() {
    if (!confirm('确认退出登录？')) return;
    logout();
  }

  const isAdmin = currentUser?.role === 'admin';
  const avatarLetter = currentUser?.username?.charAt(0).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABEL[currentUser?.role ?? ''] ?? currentUser?.role ?? '';

  return (
    <div className="admin-layout">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <div>
            <div className="sidebar-brand-text">股海远洋</div>
            <div className="sidebar-brand-sub">股票投资智能小助理</div>
          </div>
        </div>

        <div className="sidebar-section-title">导航</div>
        <nav className="sidebar-nav" style={{ flex: 'none' }}>
          <div
            className={`nav-item${currentNav === 'dashboard' ? ' active' : ''}`}
            onClick={() => handleNav('dashboard')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
            </span>
            仪表盘
          </div>
          <div
            className={`nav-item${currentNav === 'themes' ? ' active' : ''}`}
            onClick={() => handleNav('themes')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
              </svg>
            </span>
            主题管理
            <span className="nav-badge">{themes.length}</span>
          </div>
          <div
            className={`nav-item${currentNav === 'zaobao' ? ' active' : ''}`}
            onClick={() => handleNav('zaobao')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </span>
            每日早报
          </div>
          <div
            className={`nav-item${currentNav === 'breadth' ? ' active' : ''}`}
            onClick={() => handleNav('breadth')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </span>
            涨跌家数
          </div>
          <div
            className={`nav-item${currentNav === 'news' ? ' active' : ''}`}
            onClick={() => handleNav('news')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
                <path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
              </svg>
            </span>
            今日资讯
          </div>
        </nav>

        {/* 弹性间距，把系统管理顶到底部 */}
        <div style={{ flex: 1 }} />

        {/* 系统管理（仅 admin 可见，固定在底部） */}
        {isAdmin && (
          <>
            <div className="sidebar-section-title">系统管理</div>
            <nav className="sidebar-nav" style={{ flex: 'none' }}>
              {/* 可折叠父菜单 */}
              <div className="nav-item nav-group-toggle" onClick={toggleSystemMenu}>
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </span>
                用户与角色
                <span className="nav-arrow" style={{ marginLeft: 'auto', transition: 'transform .2s', transform: systemMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </span>
              </div>

              {systemMenuOpen && (
                <>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'users' ? ' active' : ''}`}
                    onClick={() => handleNav('users')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    用户管理
                  </div>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'roles' ? ' active' : ''}`}
                    onClick={() => handleNav('roles')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                    </span>
                    角色管理
                  </div>
                </>
              )}
            </nav>
          </>
        )}

        <div className="sidebar-footer">
          <div className="sidebar-avatar">{avatarLetter}</div>
          <div>
            <div className="sidebar-user-name">{currentUser?.username ?? '用户'}</div>
            <div className="sidebar-user-role">
              <span className={`role-badge role-badge-${currentUser?.role ?? 'viewer'}`}>
                {roleLabel}
              </span>
            </div>
          </div>
          <button className="sidebar-logout-btn" onClick={handleLogout}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            退出
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="main-wrap">
        <Topbar />
        <main className="main-content">
          {children}
        </main>
      </div>

      <Toast />
      <LoadingOverlay />
      <FloatingActions />
    </div>
  );
}

function FloatingActions() {
  const {
    currentNav, currentThemeId, currentReportId,
    setCurrentNav, setCurrentThemeId, setCurrentReportId,
  } = useAppStore();

  function scrollToTop() {
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    if (currentThemeId) {
      setCurrentThemeId(null);
    } else if (currentReportId) {
      setCurrentReportId(null);
    } else if (currentNav === 'themes') {
      setCurrentNav('dashboard');
    }
  }

  const canGoBack = !!currentThemeId || !!currentReportId;

  return (
    <div className="floating-actions">
      <button className="floating-btn" onClick={scrollToTop} title="回到顶部">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5"/>
          <polyline points="5 12 12 5 19 12"/>
        </svg>
      </button>
      {canGoBack && (
        <button className="floating-btn" onClick={goBack} title="返回">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      )}
    </div>
  );
}

const NAV_LABEL: Record<string, string> = {
  dashboard: '仪表盘',
  themes: '主题管理',
  users: '用户管理',
  roles: '角色管理',
  zaobao: '每日早报',
  breadth: '涨跌家数',
  news: '今日资讯',
};

function Topbar() {
  const { currentNav, currentThemeId, currentReportId, themes, reports, currentUser } = useAppStore();

  let breadcrumb = NAV_LABEL[currentNav] ?? currentNav;
  if (currentNav === 'themes' && currentThemeId) {
    const t = themes.find(t => t.id === currentThemeId);
    breadcrumb = `${t?.name ?? '主题'} · 股票池`;
  }
  if (currentNav === 'zaobao' && currentReportId) {
    const r = reports.find(r => r.id === currentReportId);
    const typeLabel = r?.report_type === 'weekly' ? '周报' : '交易日';
    breadcrumb = `每日早报 · ${r?.report_date ?? '详情'}（${typeLabel}）`;
  }

  const avatarLetter = currentUser?.username?.charAt(0).toUpperCase() ?? 'U';

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span>股海远洋</span>
        <span className="sep">/</span>
        <span className="current">{breadcrumb}</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-avatar">{avatarLetter}</div>
        <span className="topbar-username">{currentUser?.username ?? '用户'}</span>
      </div>
    </header>
  );
}
