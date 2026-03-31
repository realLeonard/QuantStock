import type { AppUser, PlanType, PermissionResult, PlanInfo } from '../types';
import { isExpired, calcDaysLeft } from './time';

/**
 * 权限矩阵：
 * - 日报列表：所有人可见
 * - 日报摘要（非当日）：所有人可见
 * - 日报摘要（当日）：试用期内 + 付费会员可见
 * - 日报全文（非当日）：所有人可见
 * - 日报全文（当日）：试用期内 + 付费会员可见
 * - 掘金（非当日）：所有人可见
 * - 掘金（当日）：试用期内 + 付费会员可见
 */

/** 判断当前用户是否具有有效付费权限（试用期内 or 有效会员） */
export function hasActivePlan(user: AppUser | null): boolean {
  if (!user) return false;
  if (user.plan_type === 'free') return false;
  if (user.plan_type === 'trial' || user.plan_type === 'monthly' ||
      user.plan_type === 'quarterly' || user.plan_type === 'yearly') {
    return !isExpired(user.plan_expired_at);
  }
  return false;
}

/** 检查用户是否可以查看当日内容 */
export function checkTodayAccess(user: AppUser | null): PermissionResult {
  if (!user) {
    return { allowed: false, reason: 'login_required' };
  }
  if (user.plan_type === 'free') {
    return { allowed: false, reason: 'upgrade_required' };
  }
  if (isExpired(user.plan_expired_at)) {
    return { allowed: false, reason: 'upgrade_required' };
  }
  return { allowed: true, reason: 'ok' };
}

/** 获取会员计划展示信息 */
export function getPlanInfo(user: AppUser | null): PlanInfo {
  if (!user) {
    return {
      type: 'free',
      label: '免费用户',
      isActive: false,
      daysLeft: null,
      expiredAt: null,
    };
  }

  const labelMap: Record<PlanType, string> = {
    free: '免费用户',
    trial: '试用会员',
    monthly: '月度会员',
    quarterly: '季度会员',
    yearly: '年度会员',
  };

  const expired = isExpired(user.plan_expired_at);
  const daysLeft = calcDaysLeft(user.plan_expired_at);

  return {
    type: user.plan_type,
    label: labelMap[user.plan_type],
    isActive: user.plan_type !== 'free' && !expired,
    daysLeft,
    expiredAt: user.plan_expired_at,
  };
}

/** 获取引导文案 */
export function getUpgradeHint(reason: PermissionResult['reason']): string {
  switch (reason) {
    case 'login_required':
      return '注册即享 3 天免费试用，立即注册';
    case 'upgrade_required':
      return '升级会员，解锁当日最新内容';
    case 'trial_expired':
      return '试用已结束，升级会员继续查看';
    default:
      return '';
  }
}
