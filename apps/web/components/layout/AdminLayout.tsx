'use client';

import { useAppStore } from '@/store';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';

interface Props {
  children: React.ReactNode;
}

export default function AdminLayout({ children }: Props) {
  const { themes, currentNav, setCurrentNav, setLoggedIn, setCurrentThemeId } = useAppStore();

  function handleNav(nav: 'dashboard' | 'themes') {
    setCurrentThemeId(null);
    setCurrentNav(nav);
    if (nav === 'dashboard') {
      useAppStore.getState().loadThemes();
    }
  }

  function handleLogout() {
    if (!confirm('确认退出登录？')) return;
    sessionStorage.removeItem('admin_logged_in');
    setLoggedIn(false);
  }

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
            <div className="sidebar-brand-text">股海罗盘</div>
            <div className="sidebar-brand-sub">投资主题管理系统</div>
          </div>
        </div>

        <div className="sidebar-section-title">导航</div>
        <nav className="sidebar-nav">
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
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">A</div>
          <div>
            <div className="sidebar-user-name">Admin</div>
            <div className="sidebar-user-role">管理员</div>
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
  const { currentNav, currentThemeId, setCurrentNav, setCurrentThemeId } = useAppStore();

  function scrollToTop() {
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 返回上一步：股票池 → 主题列表 → 仪表盘
  function goBack() {
    if (currentThemeId) {
      setCurrentThemeId(null);
    } else if (currentNav === 'themes') {
      setCurrentNav('dashboard');
    }
  }

  const canGoBack = !!currentThemeId || currentNav === 'themes';

  return (
    <div className="floating-actions">
      <button className="floating-btn" onClick={scrollToTop} title="回到顶部">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5"/>
          <polyline points="5 12 12 5 19 12"/>
        </svg>
      </button>
      {canGoBack && (
        <button className="floating-btn" onClick={goBack} title="返回上一页">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      )}
    </div>
  );
}

function Topbar() {
  const { currentNav, currentThemeId, themes } = useAppStore();

  let breadcrumb = '仪表盘';
  if (currentNav === 'themes') {
    if (currentThemeId) {
      const t = themes.find(t => t.id === currentThemeId);
      breadcrumb = `${t?.name ?? '主题'} · 股票池`;
    } else {
      breadcrumb = '主题管理';
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span>股海罗盘</span>
        <span className="sep">/</span>
        <span className="current">{breadcrumb}</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-avatar">A</div>
        <span className="topbar-username">Admin</span>
      </div>
    </header>
  );
}
