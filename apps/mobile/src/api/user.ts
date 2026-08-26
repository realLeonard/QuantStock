import { authRequest, setAccessToken } from './supabase';
import { backendRequest, ApiError } from './backend';
import type { AppUser } from '../types';

/** Supabase Auth 手机登录响应 */
interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  user: {
    id: string;
    phone: string;
  };
}

/** 发送短信验证码 */
export async function sendOtp(phone: string): Promise<void> {
  await authRequest('otp', { phone, channel: 'sms' });
}

/** 验证短信验证码并登录/注册 */
export async function verifyOtp(phone: string, token: string): Promise<AuthResponse> {
  const res = await authRequest<AuthResponse>('verify', {
    phone,
    token,
    type: 'sms',
  });
  setAccessToken(res.access_token);
  return res;
}

/** 退出登录 */
export async function signOut(): Promise<void> {
  await authRequest('logout');
  setAccessToken(null);
}

/** 获取或创建 appUsers 记录（服务端从 JWT 取 auth_id/phone，参数仅保留兼容签名） */
export async function getOrCreateAppUser(_authId: string, _phone: string): Promise<AppUser> {
  return backendRequest<AppUser>('POST', '/mobile/user/sync');
}

/** 获取用户信息（用于 App 启动时刷新） */
export async function fetchAppUser(_authId: string): Promise<AppUser | null> {
  try {
    return await backendRequest<AppUser>('GET', '/mobile/user/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** 更新用户信息（昵称、头像） */
export async function updateAppUser(
  _authId: string,
  data: Partial<Pick<AppUser, 'nickname' | 'avatar_url'>>
): Promise<void> {
  await backendRequest('PATCH', '/mobile/user/profile', data);
}

/** 记录用户行为事件 */
export async function trackEvent(
  eventType: string,
  options?: {
    userId?: string;
    targetId?: string;
    durationMs?: number;
    platform?: string;
  }
): Promise<void> {
  // 静默失败，不影响主流程
  try {
    await backendRequest('POST', '/mobile/events', {
      event_type: eventType,
      target_id: options?.targetId ?? null,
      duration_ms: options?.durationMs ?? null,
      platform: options?.platform ?? getPlatform(),
    });
  } catch {
    // 事件上报失败不影响用户体验
  }
}

/** 提交用户反馈 */
export async function submitFeedback(
  content: string,
  options?: { userId?: string; contact?: string }
): Promise<void> {
  await backendRequest('POST', '/mobile/feedback', {
    content,
    contact: options?.contact ?? undefined,
    platform: getPlatform(),
  });
}

/** 获取 App 配置（版本控制、公告等） */
export async function fetchAppConfig(key: string): Promise<string | null> {
  const res = await backendRequest<{ key: string; value: string } | null>(
    'GET',
    `/mobile/config/${encodeURIComponent(key)}`
  );
  return res?.value ?? null;
}

/** 获取当前平台标识 */
function getPlatform(): string {
  // #ifdef MP-WEIXIN
  return 'miniprogram';
  // #endif
  // #ifdef APP-PLUS
  const sys = uni.getSystemInfoSync();
  return sys.platform === 'ios' ? 'ios' : 'android';
  // #endif
  // #ifdef H5
  return 'h5';
  // #endif
}
