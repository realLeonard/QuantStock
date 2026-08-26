import type { AppUser } from '@quantstock/types';

// 镜像 apps/mobile/src/utils 的会员校验逻辑，服务端作为最终裁决

/** null 表示永久不过期 */
export function isExpired(expiredAtMs: number | null): boolean {
  if (expiredAtMs === null) return false;
  return Date.now() > expiredAtMs;
}

/** 获取北京时间今天的日期字符串 YYYY-MM-DD */
export function getTodayBj(): string {
  return new Date()
    .toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    .replace(/\//g, '-');
}

export interface TodayAccessResult {
  allowed: boolean;
  reason: 'ok' | 'login_required' | 'upgrade_required';
}

/** 当日内容访问校验：free 或已过期的付费/试用用户不可看当日内容 */
export function checkTodayAccess(user: AppUser | null): TodayAccessResult {
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
