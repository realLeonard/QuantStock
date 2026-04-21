'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import LoginPage from '@/components/layout/LoginPage';
import AdminLayout from '@/components/layout/AdminLayout';
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
import type { SessionUser } from '@quantstock/types';

export default function Home() {
  const { isLoggedIn, currentNav } = useAppStore();

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

  return (
    <AdminLayout>
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
    </AdminLayout>
  );
}
