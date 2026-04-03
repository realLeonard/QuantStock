/**
 * Hono API 请求封装
 * 移动端敏感数据操作（写操作）统一走此处，自动携带 Supabase JWT
 * 读操作（日报、公开数据）仍可保留直连 Supabase
 */

import { getAccessToken } from './supabase';

// 从环境变量读取 API 地址，生产环境指向阿里云服务器
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** 通用 Hono API 请求，自动携带 Supabase JWT */
export function backendRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  data?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${API_BASE_URL}/api${path}`;

    uni.request({
      url,
      method: method as UniApp.RequestOptions['method'],
      header: headers,
      data: data ? JSON.stringify(data) : undefined,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data as { data?: T; error?: string };
          resolve(body.data as T);
        } else {
          const err = res.data as Record<string, unknown>;
          reject(new Error((err?.error as string) || `请求失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}
