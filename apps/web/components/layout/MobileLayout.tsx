'use client';

import { useEffect, useState } from 'react';
import { useAppStore, type NavItem } from '@/store';
import Toast from '@/components/ui/Toast';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import { navigateTo, goBackFromDetail } from '@/lib/nav-loader';
import { remainingDays, formatExpireDate } from '@/lib/subscription';
import { maskUsername } from '@/lib/utils';
import styles from './MobileLayout.module.css';

interface Props {
  children: React.ReactNode;
  onSwitchDesktop: () => void;
}

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '观察者',
  member: '订阅会员',
};

/** 底部 Tab 直达页 */
const TAB_NAVS = ['gold', 'zaobao', 'daily-review', 'news', 'themes'] as const;

/** 「我的」菜单可进入的页面（进入后「我的」Tab 保持高亮） */
const MINE_NAVS: NavItem[] = ['subscription', 'users'];

/** 移动壳可达页面全集，挂载时 currentNav 不在其中则兜底跳掘金 */
const MOBILE_NAVS: NavItem[] = [...TAB_NAVS, ...MINE_NAVS];

const PAGE_TITLE: Record<string, string> = {
  gold: '近期掘金',
  zaobao: '每日早报',
  'daily-review': '每日复盘',
  news: '今日资讯',
  subscription: '订阅订单',
  themes: '主题库',
  users: '用户管理',
};

export default function MobileLayout({ children, onSwitchDesktop }: Props) {
  const {
    currentNav, currentThemeId, currentReportId, currentSectorDate,
    currentUser, pendingOrderCount, logout, themes,
  } = useAppStore();

  const isAdmin = currentUser?.role === 'admin';
  // 「我的」本地菜单态：打开时主区域渲染 MinePage 而非业务视图
  const [mineOpen, setMineOpen] = useState(false);

  // 挂载兜底：桌面默认页（如 dashboard）不在移动可达集合时跳掘金
  useEffect(() => {
    const nav = useAppStore.getState().currentNav;
    if (!MOBILE_NAVS.includes(nav)) {
      navigateTo('gold');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // admin 拉取待确认订单数，用于「我的」菜单红点
  useEffect(() => {
    if (isAdmin) {
      useAppStore.getState().loadPendingOrderCount();
    }
  }, [isAdmin]);

  const canGoBack = !!currentThemeId || !!currentReportId || !!currentSectorDate;

  let title = mineOpen ? '我的' : (PAGE_TITLE[currentNav] ?? '观弈');
  if (!mineOpen && currentNav === 'themes' && currentThemeId) {
    const t = themes.find((t) => t.id === currentThemeId);
    title = t?.name ?? '主题详情';
  }

  function handleTab(nav: NavItem) {
    setMineOpen(false);
    navigateTo(nav);
  }

  function handleMineMenu(nav: NavItem) {
    setMineOpen(false);
    navigateTo(nav);
  }

  function handleLogout() {
    if (!confirm('确认退出登录？')) return;
    logout();
  }

  const mineActive = mineOpen || MINE_NAVS.includes(currentNav);

  return (
    <div className={`m-shell ${styles.shell}`}>
      {/* 顶部标题栏 */}
      <header className={styles.topbar}>
        {!mineOpen && canGoBack ? (
          <button className={styles.backBtn} onClick={goBackFromDetail}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
          </button>
        ) : (
          <span className={styles.backPlaceholder} />
        )}
        <span className={styles.topbarCenter}>
          <span className={styles.topbarTitle}>{title}</span>
          <span className={styles.disclaimer}>仅供个人学习研究，不构成任何投资建议和决策</span>
        </span>
        <span className={styles.backPlaceholder} />
      </header>

      <SubscriptionWarningBar />

      {/* 主区域 */}
      <main className={styles.main}>
        {mineOpen ? (
          <MinePage
            isAdmin={isAdmin}
            onMenu={handleMineMenu}
            onLogout={handleLogout}
            onSwitchDesktop={onSwitchDesktop}
          />
        ) : (
          children
        )}
      </main>

      {/* 底部 TabBar */}
      <nav className={styles.tabbar}>
        <TabItem
          label="掘金"
          active={!mineOpen && currentNav === 'gold'}
          onClick={() => handleTab('gold')}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12l4 6-10 13L2 9Z"/>
              <path d="M11 3 8 9l4 13 4-13-3-6"/>
              <path d="M2 9h20"/>
            </svg>
          }
        />
        <TabItem
          label="早报"
          active={!mineOpen && currentNav === 'zaobao'}
          onClick={() => handleTab('zaobao')}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          }
        />
        <TabItem
          label="复盘"
          active={!mineOpen && currentNav === 'daily-review'}
          onClick={() => handleTab('daily-review')}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          }
        />
        <TabItem
          label="资讯"
          active={!mineOpen && currentNav === 'news'}
          onClick={() => handleTab('news')}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
              <path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>
            </svg>
          }
        />
        <TabItem
          label="主题"
          active={!mineOpen && currentNav === 'themes'}
          onClick={() => handleTab('themes')}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"/>
              <polyline points="2 17 12 22 22 17"/>
              <polyline points="2 12 12 17 22 12"/>
            </svg>
          }
        />
        <TabItem
          label="我的"
          active={mineActive}
          onClick={() => setMineOpen(true)}
          dot={isAdmin && pendingOrderCount > 0}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          }
        />
      </nav>

      <Toast />
      <LoadingOverlay />
    </div>
  );
}

interface TabItemProps {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  dot?: boolean;
}

function TabItem({ label, active, onClick, icon, dot }: TabItemProps) {
  return (
    <button className={`${styles.tab}${active ? ` ${styles.tabActive}` : ''}`} onClick={onClick}>
      <span className={styles.tabIcon}>
        {icon}
        {dot && <span className={styles.tabDot} />}
      </span>
      <span className={styles.tabLabel}>{label}</span>
    </button>
  );
}

// member 剩余 ≤7 天时的续费提醒黄条（与 PC 壳同逻辑，内联实现避免改 AdminLayout 导出）
function SubscriptionWarningBar() {
  const currentUser = useAppStore((s) => s.currentUser);
  const expiresAt = currentUser?.subscription_expires_at;
  if (currentUser?.role !== 'member' || expiresAt == null) return null;
  const days = Math.ceil((expiresAt - Date.now()) / (24 * 3600 * 1000));
  if (days > 7 || days <= 0) return null;
  return (
    <div className={styles.warningBar}>
      ⚠️ 订阅将于 {days} 天后到期，
      <a href="/subscribe">点此续费</a>
    </div>
  );
}

interface MinePageProps {
  isAdmin: boolean;
  onMenu: (nav: NavItem) => void;
  onLogout: () => void;
  onSwitchDesktop: () => void;
}

function MinePage({ isAdmin, onMenu, onLogout, onSwitchDesktop }: MinePageProps) {
  const { currentUser, pendingOrderCount } = useAppStore();

  const avatarLetter = currentUser?.username?.charAt(0).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABEL[currentUser?.role ?? ''] ?? currentUser?.role ?? '';
  const isMember = currentUser?.role === 'member';
  const expiresAt = currentUser?.subscription_expires_at;
  const days = isMember ? remainingDays(expiresAt) : null;

  return (
    <div className={styles.mine}>
      {/* 用户信息卡 */}
      <div className={styles.mineCard}>
        <div className={styles.mineAvatar}>{avatarLetter}</div>
        <div className={styles.mineUserInfo}>
          <div className={styles.mineUsername}>
            {currentUser?.username ? maskUsername(currentUser.username) : '用户'}
          </div>
          <div className={styles.mineRoleRow}>
            <span className={`role-badge role-badge-${currentUser?.role ?? 'viewer'}`}>
              {roleLabel}
            </span>
          </div>
          {isMember && expiresAt != null && (
            <div className={styles.mineSubscription}>
              <span className={styles.mineCrown}>👑</span>
              会员 · 订阅至 {formatExpireDate(expiresAt)}
              {days != null && days > 0 && <span className={styles.mineDays}>剩余 {days} 天</span>}
            </div>
          )}
        </div>
      </div>

      {/* 菜单 */}
      <div className={styles.mineMenu}>
        <MineMenuItem
          label="订阅订单"
          hint="续费和修改登录密码"
          badge={isAdmin && pendingOrderCount > 0 ? pendingOrderCount : undefined}
          onClick={() => onMenu('subscription')}
        />
        {isAdmin && <MineMenuItem label="用户管理" onClick={() => onMenu('users')} />}
        <MineMenuItem label="切换到桌面版" onClick={onSwitchDesktop} />
      </div>

      <div className={styles.mineMenu}>
        <button className={`${styles.mineMenuItem} ${styles.mineLogout}`} onClick={onLogout}>
          退出登录
        </button>
      </div>
    </div>
  );
}

interface MineMenuItemProps {
  label: string;
  onClick: () => void;
  badge?: number;
  hint?: string;
}

function MineMenuItem({ label, onClick, badge, hint }: MineMenuItemProps) {
  return (
    <button className={styles.mineMenuItem} onClick={onClick}>
      <span>{label}</span>
      <span className={styles.mineMenuRight}>
        {hint && <span className={styles.mineMenuHint}>{hint}</span>}
        {badge != null && <span className={styles.mineBadge}>{badge}</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </span>
    </button>
  );
}
