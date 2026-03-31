import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AppUser, PlanInfo } from '../types';
import { fetchAppUser, signOut as apiSignOut } from '../api/user';
import { setAccessToken } from '../api/supabase';
import { hasActivePlan, getPlanInfo } from '../utils/permission';

const SESSION_KEY = 'qs_session';

interface SessionData {
  accessToken: string;
  authId: string;
  phone: string;
}

export const useUserStore = defineStore('user', () => {
  const user = ref<AppUser | null>(null);
  const authId = ref<string | null>(null);
  const loading = ref(false);

  const isLoggedIn = computed(() => !!user.value && !!authId.value);
  const planInfo = computed((): PlanInfo => getPlanInfo(user.value));
  const canViewTodayContent = computed(() => hasActivePlan(user.value));

  /** 从本地 storage 恢复登录态 */
  function restoreSession(): void {
    try {
      const raw = uni.getStorageSync(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw) as SessionData;
      if (session.accessToken && session.authId) {
        setAccessToken(session.accessToken);
        authId.value = session.authId;
        // 后台刷新用户信息
        refreshUserInfo(session.authId).catch(() => {
          // 刷新失败不影响 UI，等下次操作时再处理
        });
      }
    } catch {
      // 解析失败，清空 session
      clearSession();
    }
  }

  /** 登录成功后设置用户状态 */
  function setSession(data: SessionData & { appUser: AppUser }): void {
    setAccessToken(data.accessToken);
    authId.value = data.authId;
    user.value = data.appUser;
    // 持久化 session
    uni.setStorageSync(SESSION_KEY, JSON.stringify({
      accessToken: data.accessToken,
      authId: data.authId,
      phone: data.phone,
    }));
  }

  /** 退出登录 */
  async function logout(): Promise<void> {
    try {
      await apiSignOut();
    } catch {
      // 忽略退出登录的网络错误
    }
    clearSession();
  }

  /** 刷新用户信息（会员状态等） */
  async function refreshPlanStatus(): Promise<void> {
    if (!authId.value) return;
    await refreshUserInfo(authId.value);
  }

  /** 内部：刷新用户信息 */
  async function refreshUserInfo(id: string): Promise<void> {
    loading.value = true;
    try {
      const fresh = await fetchAppUser(id);
      if (fresh) {
        user.value = fresh;
      } else {
        // 用户不存在（已删除？）
        clearSession();
      }
    } finally {
      loading.value = false;
    }
  }

  /** 更新本地用户信息（头像/昵称更新后） */
  function updateLocalUser(patch: Partial<AppUser>): void {
    if (user.value) {
      user.value = { ...user.value, ...patch };
    }
  }

  function clearSession(): void {
    user.value = null;
    authId.value = null;
    setAccessToken(null);
    uni.removeStorageSync(SESSION_KEY);
  }

  return {
    user,
    authId,
    loading,
    isLoggedIn,
    planInfo,
    canViewTodayContent,
    restoreSession,
    setSession,
    logout,
    refreshPlanStatus,
    updateLocalUser,
  };
});
