import { QuantStockApiClient } from '@quantstock/api-client';

// 单例：所有数据操作经 Hono API + JWT（浏览器不再直连 Supabase）
export const apiClient = new QuantStockApiClient({
  baseUrl: '/backend-api',
  getToken: () =>
    typeof window === 'undefined' ? null : sessionStorage.getItem('admin_token'),
});
