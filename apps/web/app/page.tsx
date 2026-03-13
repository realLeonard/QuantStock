'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store';
import LoginPage from '@/components/layout/LoginPage';
import AdminLayout from '@/components/layout/AdminLayout';
import Dashboard from '@/components/dashboard/Dashboard';
import ThemesView from '@/components/themes/ThemesView';

export default function Home() {
  const { isLoggedIn, currentNav } = useAppStore();

  // 页面刷新时从 sessionStorage 恢复登录状态
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const logged = sessionStorage.getItem('admin_logged_in') === '1';
      if (logged) {
        useAppStore.getState().setLoggedIn(true);
        useAppStore.getState().loadThemes();
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
    </AdminLayout>
  );
}
