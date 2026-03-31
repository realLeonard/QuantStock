import { reactive } from 'vue';
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

const store = reactive({
  user: null as AppUser | null,
  authId: null as string | null,
  loading: false,

  get isLoggedIn(): boolean {
    return !!store.user && !!store.authId;
  },
  get planInfo(): PlanInfo {
    return getPlanInfo(store.user);
  },
  get canViewTodayContent(): boolean {
    return hasActivePlan(store.user);
  },

  restoreSession() {
    try {
      const raw = uni.getStorageSync(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw) as SessionData;
      if (session.accessToken && session.authId) {
        setAccessToken(session.accessToken);
        store.authId = session.authId;
        store._refreshUserInfo(session.authId).catch(() => {});
      }
    } catch {
      store._clearSession();
    }
  },

  setSession(data: SessionData & { appUser: AppUser }) {
    setAccessToken(data.accessToken);
    store.authId = data.authId;
    store.user = data.appUser;
    uni.setStorageSync(SESSION_KEY, JSON.stringify({
      accessToken: data.accessToken,
      authId: data.authId,
      phone: data.phone,
    }));
  },

  async logout() {
    try { await apiSignOut(); } catch {}
    store._clearSession();
  },

  async refreshPlanStatus() {
    if (!store.authId) return;
    await store._refreshUserInfo(store.authId);
  },

  async _refreshUserInfo(id: string) {
    store.loading = true;
    try {
      const fresh = await fetchAppUser(id);
      if (fresh) {
        store.user = fresh;
      } else {
        store._clearSession();
      }
    } finally {
      store.loading = false;
    }
  },

  updateLocalUser(patch: Partial<AppUser>) {
    if (store.user) {
      store.user = { ...store.user, ...patch };
    }
  },

  _clearSession() {
    store.user = null;
    store.authId = null;
    setAccessToken(null);
    uni.removeStorageSync(SESSION_KEY);
  },
});

export function useUserStore() {
  return store;
}
