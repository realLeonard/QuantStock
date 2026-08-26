import { QuantStockApiClient } from '@quantstock/api-client';
import { ERR_SESSION_KICKED } from '@quantstock/types';

// 单例：所有数据操作经 Hono API + JWT（浏览器不再直连 Supabase）
export const apiClient = new QuantStockApiClient({
  baseUrl: '/backend-api',
  getToken: () =>
    typeof window === 'undefined' ? null : sessionStorage.getItem('admin_token'),
  onAuthError: (code) => {
    if (code !== ERR_SESSION_KICKED || typeof window === 'undefined') return;
    alert('账号已在其他设备登录，您已被迫下线');
    // 动态 import 避免与 store 的循环依赖（store 引用本文件的 apiClient）
    import('@/store').then(({ useAppStore }) => {
      useAppStore.getState().logout();
    });
  },
});
