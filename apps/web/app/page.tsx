'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import LoginPage from '@/components/layout/LoginPage';
import AdminLayout from '@/components/layout/AdminLayout';
import MobileLayout from '@/components/layout/MobileLayout';
import Dashboard from '@/components/dashboard/Dashboard';
import ThemesView from '@/components/themes/ThemesView';
import UsersView from '@/components/users/UsersView';
import RolesView from '@/components/roles/RolesView';
import ZaobaoView from '@/components/zaobao/ZaobaoView';
import BreadthView from '@/components/breadth/BreadthView';
import NewsView from '@/components/news/NewsView';
import AppUsersView from '@/components/app-users/AppUsersView';
import AppFeedbackView from '@/components/app-feedback/AppFeedbackView';
import AppEventsView from '@/components/app-events/AppEventsView';
import AppVersionView from '@/components/app-version/AppVersionView';
import DailyReviewView from '@/components/daily-review/DailyReviewView';
import GoldView from '@/components/gold/GoldView';
import SectorPredictionView from '@/components/sector-prediction/SectorPredictionView';
import StockDictView from '@/components/stock-dict/StockDictView';
import SubscriptionView from '@/components/subscription/SubscriptionView';
import LoginLogsView from '@/components/login-logs/LoginLogsView';
import ExpiredPage from '@/components/subscription/ExpiredPage';
import type { SessionUser } from '@quantstock/types';

type Shell = 'desktop' | 'mobile';

export default function Home() {
  const { isLoggedIn, currentNav, currentUser } = useAppStore();

  // 壳选择：挂载时判定一次（shell_pref 手动偏好优先，否则按设备宽度），不监听 resize
  const [shell, setShell] = useState<Shell>('desktop');
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    setIsMobileDevice(mobile);
    const pref = sessionStorage.getItem('shell_pref');
    if (pref === 'desktop' || pref === 'mobile') {
      setShell(pref);
    } else if (mobile) {
      setShell('mobile');
    }
  }, []);

  function switchShell(next: Shell) {
    sessionStorage.setItem('shell_pref', next);
    setShell(next);
  }

  // 页面刷新时从 sessionStorage 恢复登录状态
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const raw = sessionStorage.getItem('session_user');
      if (raw) {
        try {
          const session = JSON.parse(raw) as SessionUser;
          useAppStore.getState().setLoggedIn(true);
          useAppStore.getState().setCurrentUser(session);
          useAppStore.getState().loadThemes();
          useAppStore.getState().loadReports();
          useAppStore.getState().loadDailyReviews();
        } catch {
          sessionStorage.removeItem('session_user');
        }
      }
    }
  }, []);

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  // member 订阅到期：拦截全部功能页，仅显示续费引导（API 层另有权威校验）
  const expiresAt = currentUser?.subscription_expires_at;
  if (currentUser?.role === 'member' && expiresAt != null && expiresAt < Date.now()) {
    return <ExpiredPage />;
  }

  const view = (
    <>
      {currentNav === 'dashboard' && <Dashboard />}
      {currentNav === 'themes' && <ThemesView />}
      {currentNav === 'users' && <UsersView />}
      {currentNav === 'roles' && <RolesView />}
      {currentNav === 'zaobao' && <ZaobaoView />}
      {currentNav === 'breadth' && <BreadthView />}
      {currentNav === 'news' && <NewsView />}
      {currentNav === 'app-users' && <AppUsersView />}
      {currentNav === 'app-feedback' && <AppFeedbackView />}
      {currentNav === 'app-events' && <AppEventsView />}
      {currentNav === 'app-version' && <AppVersionView />}
      {currentNav === 'daily-review' && <DailyReviewView />}
      {currentNav === 'gold' && <GoldView />}
      {currentNav === 'sector-prediction' && <SectorPredictionView />}
      {(currentNav === 'stock-dict-sector' || currentNav === 'stock-dict-codes') && <StockDictView />}
      {currentNav === 'subscription' && <SubscriptionView />}
      {currentNav === 'login-logs' && <LoginLogsView />}
    </>
  );

  if (shell === 'mobile') {
    return <MobileLayout onSwitchDesktop={() => switchShell('desktop')}>{view}</MobileLayout>;
  }

  return (
    <>
      <AdminLayout>{view}</AdminLayout>
      {/* 手机设备上手动切到桌面壳时的返回入口；PC 上 matchMedia 不命中，永不渲染 */}
      {isMobileDevice && (
        <button
          onClick={() => switchShell('mobile')}
          style={{
            position: 'fixed',
            right: 12,
            bottom: 76,
            zIndex: 999,
            padding: '8px 14px',
            borderRadius: 20,
            border: 'none',
            background: 'rgba(15, 23, 42, 0.78)',
            color: '#fff',
            fontSize: 13,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
          }}
        >
          回到移动版
        </button>
      )}
    </>
  );
}
