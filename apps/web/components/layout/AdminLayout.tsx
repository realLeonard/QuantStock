'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import { formatExpireDate } from '@/lib/subscription';
import { maskUsername } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
}

// 角色中文名映射
const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '观察者',
  member: '订阅会员',
};

export default function AdminLayout({ children }: Props) {
  const {
    themes, reports, dailyReviews,
    currentNav, setCurrentNav, logout,
    setCurrentThemeId, setCurrentReportId, currentUser,
    systemMenuOpen, toggleSystemMenu,
    appMenuOpen, toggleAppMenu,
    stockDictMenuOpen, toggleStockDictMenu,
    loginLogSummary, pendingOrderCount,
  } = useAppStore();

  const isAdmin = currentUser?.role === 'admin';
  const highRiskCount = loginLogSummary.filter((s) => s.risk_level === 'high').length;

  // admin 登录后后台拉取风险概览与待确认订单数，用于侧边栏红色提醒徽标
  useEffect(() => {
    if (isAdmin) {
      const s = useAppStore.getState();
      s.loadLoginLogSummary();
      s.loadPendingOrderCount();
    }
  }, [isAdmin]);

  // 把 'YYYY-MM-DD' 格式化为 'M/D'，无值返回空串
  function fmtMMDD(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const m = dateStr.match(/^\d{4}-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${Number(m[1])}/${Number(m[2])}`;
  }
  const latestReportDate = fmtMMDD(reports[0]?.report_date);
  const latestReviewDate = fmtMMDD(dailyReviews[0]?.report_date);

  function handleNav(nav: Parameters<typeof setCurrentNav>[0]) {
    setCurrentThemeId(null);
    setCurrentReportId(null);
    setCurrentNav(nav);
    if (nav === 'dashboard') {
      const s = useAppStore.getState();
      s.loadThemes();
      s.loadRecentInsights();
      s.loadDailyGoldPicks();
      s.loadReports();
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
    if (nav === 'app-users') {
      useAppStore.getState().loadAppUsers();
    }
    if (nav === 'app-feedback') {
      useAppStore.getState().loadUserFeedbacks();
    }
    if (nav === 'app-events') {
      useAppStore.getState().loadUserEvents();
    }
    if (nav === 'app-version') {
      useAppStore.getState().loadAppVersions();
    }
    if (nav === 'daily-review') {
      useAppStore.getState().loadDailyReviews();
    }
    if (nav === 'sector-prediction') {
      const s = useAppStore.getState();
      s.setCurrentSectorDate(null);
      s.loadSectorPredictionDays();
    }
    if (nav === 'gold') {
      const s = useAppStore.getState();
      s.loadRecentInsights();
      s.loadDailyGoldPicks();
      s.loadThemes();
      s.loadReports();
    }
    if (nav === 'stock-dict-sector') {
      useAppStore.getState().loadSectorMasters();
    }
    if (nav === 'stock-dict-codes') {
      useAppStore.getState().loadStockCodes();
    }
    if (nav === 'login-logs') {
      const s = useAppStore.getState();
      s.loadLoginLogs(1);
      s.loadLoginLogSummary();
    }
  }

  function handleLogout() {
    if (!confirm('确认退出登录？')) return;
    logout();
  }

  const avatarLetter = currentUser?.username?.charAt(0).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABEL[currentUser?.role ?? ''] ?? currentUser?.role ?? '';

  return (
    <div className="admin-layout">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="观弈" />
          </div>
          <div>
            <div className="sidebar-brand-text">观弈</div>
            <div className="sidebar-brand-sub">股票智能小助理</div>
          </div>
        </div>

        <div className="sidebar-scroll">
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
          <div
            className={`nav-item${currentNav === 'gold' ? ' active' : ''}`}
            onClick={() => handleNav('gold')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12l4 6-10 13L2 9Z"/>
                <path d="M11 3 8 9l4 13 4-13-3-6"/>
                <path d="M2 9h20"/>
              </svg>
            </span>
            近期掘金
            <span className="nav-badge">{themes.filter(t => t.title_color === 'red').length}</span>
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
            {latestReportDate && <span className="nav-badge">{latestReportDate}</span>}
          </div>
          <div
            className={`nav-item${currentNav === 'daily-review' ? ' active' : ''}`}
            onClick={() => handleNav('daily-review')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            每日复盘
            {latestReviewDate && <span className="nav-badge">{latestReviewDate}</span>}
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
            className={`nav-item${currentNav === 'sector-prediction' ? ' active' : ''}`}
            onClick={() => handleNav('sector-prediction')}
          >
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
            </span>
            板块预测
            <span className="nav-badge">开发中</span>
          </div>

          {/* 订阅订单（admin 管理全部订单，member 查看自己的订阅） */}
          {(isAdmin || currentUser?.role === 'member') && (
            <div
              className={`nav-item${currentNav === 'subscription' ? ' active' : ''}`}
              onClick={() => handleNav('subscription')}
            >
              <span className="nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </span>
              订阅订单
              {isAdmin && pendingOrderCount > 0 && (
                <span
                  className="nav-badge"
                  style={{ background: '#dc2626', color: '#fff' }}
                  title={`${pendingOrderCount} 笔待确认订阅订单`}
                >
                  {pendingOrderCount}
                </span>
              )}
              {currentUser?.role === 'member' && <span className="nav-badge">续费&gt;</span>}
            </div>
          )}

          {/* 股票字典（可折叠，仅 admin/editor 可见） */}
          {(isAdmin || currentUser?.role === 'editor') && (
          <>
          <div className="nav-item nav-group-toggle" onClick={toggleStockDictMenu}>
            <span className="nav-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </span>
            股票字典
            <span className="nav-arrow" style={{ marginLeft: 'auto', transition: 'transform .2s', transform: stockDictMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </span>
          </div>

          {stockDictMenuOpen && (
            <>
              <div
                className={`nav-item nav-sub-item${currentNav === 'stock-dict-sector' ? ' active' : ''}`}
                onClick={() => handleNav('stock-dict-sector')}
              >
                <span className="nav-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                    <polyline points="2 17 12 22 22 17"/>
                    <polyline points="2 12 12 17 22 12"/>
                  </svg>
                </span>
                概念板块
              </div>
              <div
                className={`nav-item nav-sub-item${currentNav === 'stock-dict-codes' ? ' active' : ''}`}
                onClick={() => handleNav('stock-dict-codes')}
              >
                <span className="nav-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                  </svg>
                </span>
                股票代码
              </div>
            </>
          )}
          </>
          )}
        </nav>

        {/* 弹性间距，把下方菜单顶到底部 */}
        <div style={{ flex: 1 }} />

        {/* APP 管理（仅 admin 可见） */}
        {isAdmin && (
          <>
            <div className="sidebar-section-title">APP 管理</div>
            <nav className="sidebar-nav">
              <div className="nav-item nav-group-toggle" onClick={toggleAppMenu}>
                <span className="nav-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                    <line x1="12" y1="18" x2="12.01" y2="18"/>
                  </svg>
                </span>
                APP 管理
                <span className="nav-arrow" style={{ marginLeft: 'auto', transition: 'transform .2s', transform: appMenuOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </span>
              </div>

              {appMenuOpen && (
                <>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'app-users' ? ' active' : ''}`}
                    onClick={() => handleNav('app-users')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </span>
                    APP用户管理
                  </div>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'app-feedback' ? ' active' : ''}`}
                    onClick={() => handleNav('app-feedback')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </span>
                    用户反馈
                  </div>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'app-events' ? ' active' : ''}`}
                    onClick={() => handleNav('app-events')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
                    </span>
                    用户行为
                  </div>
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'app-version' ? ' active' : ''}`}
                    onClick={() => handleNav('app-version')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
                      </svg>
                    </span>
                    管理控制
                  </div>
                </>
              )}
            </nav>
          </>
        )}

        {/* 系统管理（仅 admin 可见，固定在底部） */}
        {isAdmin && (
          <>
            <div className="sidebar-section-title">系统管理</div>
            <nav className="sidebar-nav">
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
                {highRiskCount > 0 && (
                  <span
                    className="nav-badge"
                    style={{ background: '#dc2626', color: '#fff' }}
                    title={`风险概览发现 ${highRiskCount} 个疑似共用账号`}
                  >
                    {highRiskCount}
                  </span>
                )}
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
                  <div
                    className={`nav-item nav-sub-item${currentNav === 'login-logs' ? ' active' : ''}`}
                    onClick={() => handleNav('login-logs')}
                  >
                    <span className="nav-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <circle cx="10" cy="15" r="2.5"/>
                        <path d="M12 17l2 2"/>
                      </svg>
                    </span>
                    登录日志
                  </div>
                </>
              )}
            </nav>
          </>
        )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-avatar">{avatarLetter}</div>
          <div>
            <div className="sidebar-user-name">
              {currentUser?.username ? maskUsername(currentUser.username) : '用户'}
            </div>
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
        <SubscriptionWarningBar />
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

// member 剩余 ≤7 天时的续费提醒黄条
function SubscriptionWarningBar() {
  const currentUser = useAppStore((s) => s.currentUser);
  const expiresAt = currentUser?.subscription_expires_at;
  if (currentUser?.role !== 'member' || expiresAt == null) return null;
  const days = Math.ceil((expiresAt - Date.now()) / (24 * 3600 * 1000));
  if (days > 7 || days <= 0) return null;
  return (
    <div className="subscription-warning-bar">
      ⚠️ 订阅将于 {days} 天后到期，
      <a href="/subscribe">点此续费</a>
    </div>
  );
}

function FloatingActions() {
  const {
    currentNav, currentThemeId, currentReportId, currentSectorDate,
    setCurrentNav, setCurrentThemeId, setCurrentReportId, setCurrentSectorDate,
  } = useAppStore();

  function scrollToTop() {
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    if (currentThemeId) {
      setCurrentThemeId(null);
    } else if (currentReportId) {
      setCurrentReportId(null);
    } else if (currentSectorDate) {
      setCurrentSectorDate(null);
    } else if (currentNav === 'themes') {
      setCurrentNav('dashboard');
    }
  }

  const canGoBack = !!currentThemeId || !!currentReportId || !!currentSectorDate;

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
  'app-users': 'APP用户管理',
  'app-feedback': '用户反馈',
  'app-events': '用户行为',
  'app-version': '管理控制',
  'daily-review': '每日复盘',
  gold: '近期掘金',
  'sector-prediction': '板块预测',
  'stock-dict-sector': '概念板块',
  'stock-dict-codes': '股票代码',
  subscription: '订阅订单',
  'login-logs': '登录日志',
};

function Topbar() {
  const { currentNav, currentThemeId, currentReportId, currentSectorDate, themes, reports, currentUser } = useAppStore();

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
  if (currentNav === 'sector-prediction' && currentSectorDate) {
    breadcrumb = `板块预测 · ${currentSectorDate}`;
  }

  const avatarLetter = currentUser?.username?.charAt(0).toUpperCase() ?? 'U';

  return (
    <header className="topbar">
      <div className="topbar-breadcrumb">
        <span>观弈</span>
        <span className="sep">/</span>
        <span className="current">{breadcrumb}</span>
      </div>
      <div className="topbar-disclaimer">所有内容仅供个人学习研究，不构成任何投资建议和决策，投资请不要相信任何系统和任何人</div>
      <div className="topbar-right">
        <div className="topbar-avatar">{avatarLetter}</div>
        <div className="topbar-user-info">
          <span className="topbar-username">
            {currentUser?.username ? maskUsername(currentUser.username) : '用户'}
          </span>
          {currentUser?.role === 'member' && (
            <span className="topbar-member-badge">
              <span className="topbar-member-crown">👑</span>
              订阅会员
              {currentUser.subscription_expires_at != null && (
                <span className="topbar-member-expire">
                  {formatExpireDate(currentUser.subscription_expires_at)} 到期
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
