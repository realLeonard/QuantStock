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
    </AdminLayout>
  );
}
