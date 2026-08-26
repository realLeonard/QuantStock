/**
 * Supabase Auth 请求封装（仅认证链路）
 * 数据操作已全部收口到 Hono API（见 backend.ts），
 * anon key 仅用于 Auth 接口，不再直连 PostgREST
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
