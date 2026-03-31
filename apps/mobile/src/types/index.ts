// 从共享包导入复用类型
export type { DailyReport } from '@quantstock/types';

// ===== App 端用户类型 =====
export type PlanType = 'free' | 'trial' | 'monthly' | 'quarterly' | 'yearly';

export interface AppUser {
  id: string;
  auth_id: string;
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  wechat_openid: string | null;
  plan_type: PlanType;
  plan_expired_at: number | null; // UTC 毫秒，null 表示永久或免费
  last_login_at: number | null;
  created_at: number;
}

/** 新建用户时的输入类型 */
export type AppUserInput = Omit<AppUser, 'id' | 'nickname' | 'avatar_url' | 'wechat_openid'>;

// ===== 会员计划展示信息 =====
export interface PlanInfo {
  type: PlanType;
  label: string;
  isActive: boolean;         // 是否当前有效（trial/月季年 且未过期）
  daysLeft: number | null;   // 剩余天数，null 表示免费或永久
  expiredAt: number | null;  // 到期时间戳
}

// ===== 用户行为事件 =====
export interface UserEvent {
  id: string;
  user_id: string | null;
  event_type: string;
  target_id: string | null;
  duration_ms: number | null;
  platform: string | null;
  created_at: number;
}

// ===== 用户反馈 =====
export interface UserFeedback {
  id: string;
  user_id: string | null;
  content: string;
  contact: string | null;
  platform: string | null;
  created_at: number;
}

// ===== App 全局配置 =====
export interface AppConfig {
  key: string;
  value: string;
  updated_at: number;
}

// ===== 权限检查结果 =====
export interface PermissionResult {
  allowed: boolean;
  reason: 'ok' | 'login_required' | 'upgrade_required' | 'trial_expired';
}
