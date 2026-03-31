import { supabaseRequest, authRequest, setAccessToken } from './supabase';
import type { AppUser, AppUserInput } from '../types';

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

/** 获取或创建 appUsers 记录 */
export async function getOrCreateAppUser(authId: string, phone: string): Promise<AppUser> {
  // 先尝试查询
  const list = await supabaseRequest<AppUser[]>('GET', 'appUsers', undefined, {
    select: '*',
    auth_id: `eq.${authId}`,
    limit: '1',
  });

  if (list.length > 0) {
    // 已存在，更新最后登录时间
    await supabaseRequest('PATCH', `appUsers?auth_id=eq.${authId}`, {
      last_login_at: Date.now(),
    });
    return { ...list[0], last_login_at: Date.now() };
  }

  // 新用户：创建并激活 3 天试用
  const now = Date.now();
  const trialExpiredAt = now + 3 * 24 * 60 * 60 * 1000; // +3天

  const newUser: AppUserInput = {
    auth_id: authId,
    phone,
    plan_type: 'trial',
    plan_expired_at: trialExpiredAt,
    last_login_at: now,
    created_at: now,
  };

  const created = await supabaseRequest<AppUser[]>('POST', 'appUsers', newUser);
  return created[0];
}

/** 获取用户信息（用于 App 启动时刷新） */
export async function fetchAppUser(authId: string): Promise<AppUser | null> {
  const list = await supabaseRequest<AppUser[]>('GET', 'appUsers', undefined, {
    select: '*',
    auth_id: `eq.${authId}`,
    limit: '1',
  });
  return list[0] ?? null;
}

/** 更新用户信息（昵称、头像） */
export async function updateAppUser(
  authId: string,
  data: Partial<Pick<AppUser, 'nickname' | 'avatar_url'>>
): Promise<void> {
  await supabaseRequest('PATCH', `appUsers?auth_id=eq.${authId}`, data);
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
    await supabaseRequest('POST', 'userEvents', {
      user_id: options?.userId ?? null,
      event_type: eventType,
      target_id: options?.targetId ?? null,
      duration_ms: options?.durationMs ?? null,
      platform: options?.platform ?? getPlatform(),
      created_at: Date.now(),
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
  await supabaseRequest('POST', 'userFeedback', {
    user_id: options?.userId ?? null,
    content,
    contact: options?.contact ?? null,
    platform: getPlatform(),
    created_at: Date.now(),
  });
}

/** 获取 App 配置（版本控制、公告等） */
export async function fetchAppConfig(key: string): Promise<string | null> {
  const list = await supabaseRequest<Array<{ key: string; value: string }>>('GET', 'appConfig', undefined, {
    select: 'key,value',
    key: `eq.${key}`,
    limit: '1',
  });
  return list[0]?.value ?? null;
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
