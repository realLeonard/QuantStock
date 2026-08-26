/**
 * Hono API 请求封装
 * 移动端所有数据操作统一走 Hono API + Supabase JWT，
 * 不再直连 Supabase PostgREST（anon key 仅用于 Auth）
 */

import { getAccessToken } from './supabase';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** 带状态码/业务码的 API 错误（如 403 UPGRADE_REQUIRED） */
export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

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
          reject(
            new ApiError(
              (err?.error as string) || `请求失败: ${res.statusCode}`,
              res.statusCode,
              (err?.code as string) ?? null
            )
          );
        }
      },
      fail: (err) => {
        reject(new ApiError(err.errMsg || '网络请求失败', 0));
      },
    });
  });
}
