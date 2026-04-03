import { authRequest, setAccessToken } from './supabase';
import { backendRequest } from './backend';
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

/** 发送短信验证码（保留直连 Supabase Auth，有内置限流） */
export async function sendOtp(phone: string): Promise<void> {
  await authRequest('otp', { phone, channel: 'sms' });
}

/** 验证短信验证码并登录/注册（保留直连 Supabase Auth） */
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

/** 首次登录后同步/创建用户，激活试用 */
export async function getOrCreateAppUser(): Promise<AppUser> {
  return backendRequest<AppUser>('POST', '/mobile/user/sync');
}

/** 获取用户信息（用于 App 启动时刷新） */
export async function fetchAppUser(): Promise<AppUser | null> {
  try {
    return await backendRequest<AppUser>('GET', '/mobile/user/me');
  } catch {
    return null;
  }
}

/** 更新用户信息（昵称、头像） */
export async function updateAppUser(
  data: Partial<Pick<AppUser, 'nickname' | 'avatar_url'>>
): Promise<void> {
  await backendRequest('PATCH', '/mobile/user/profile', data);
}

/** 记录用户行为事件 */
export async function trackEvent(
  eventType: string,
  options?: {
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
  options?: { contact?: string }
): Promise<void> {
  await backendRequest('POST', '/mobile/feedback', {
    content,
    contact: options?.contact ?? null,
    platform: getPlatform(),
  });
}

/** 获取 App 最新版本控制信息 */
export async function fetchAppVersion(): Promise<unknown> {
  return backendRequest('GET', '/mobile/version');
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
