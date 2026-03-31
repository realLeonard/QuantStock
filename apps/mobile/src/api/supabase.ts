/**
 * Supabase REST API 请求封装
 * 在 uni-app 中无法直接使用 @supabase/supabase-js（依赖 fetch），
 * 改用 uni.request 封装，兼容小程序/App/H5 多端
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** 用于存储当前登录用户的 JWT */
let _accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function getAccessToken(): string | null {
  return _accessToken;
}

/** 获取请求头 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }
  return headers;
}

/** 通用 Supabase REST 请求 */
export function supabaseRequest<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
  params?: Record<string, string>
): Promise<T> {
  return new Promise((resolve, reject) => {
    let url = `${SUPABASE_URL}/rest/v1/${path}`;

    // 拼接 query 参数
    if (params) {
      const query = Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      url += `?${query}`;
    }

    uni.request({
      url,
      method,
      header: getHeaders(),
      data: data ? JSON.stringify(data) : undefined,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          const err = res.data as Record<string, unknown>;
          reject(new Error((err?.message as string) || `请求失败: ${res.statusCode}`));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}

/** Supabase Auth 请求封装 */
export function authRequest<T = unknown>(
  endpoint: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
    uni.request({
      url,
      method: 'POST',
      header: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: body ? JSON.stringify(body) : undefined,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data as T);
        } else {
          const err = res.data as Record<string, unknown>;
          reject(new Error((err?.msg as string) || (err?.message as string) || '认证失败'));
        }
      },
      fail: (err) => {
        reject(new Error(err.errMsg || '网络请求失败'));
      },
    });
  });
}
