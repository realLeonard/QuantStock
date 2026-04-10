'use client';

import { create } from 'zustand';
import type { Theme, AdminUser, SessionUser, UserRole, DailyReport, MarketBreadth, AppUser, PlanType, UserFeedback, UserEvent, AppVersionControl, DailyReview } from '@quantstock/types';
import { apiClient, supabase } from '@/lib/supabase';

export interface NewsItem {
  id: string;
  cls_id: string | null;
  title: string;
  summary: string;
  categories: string[];
  level: string;
  url: string;
  published_at: number;
}
import { hashPassword } from '@/lib/crypto';
import { uid } from '@/lib/utils';

// Hono API 走 Next.js rewrites 同源代理（避免 Vercel HTTPS → 阿里云 HTTP 的 Mixed Content 拦截）
// 实际转发目标在 apps/web/next.config.ts 里用 NEXT_PUBLIC_API_BASE_URL 配置
const API_BASE = '/backend-api';

type NavItem = 'dashboard' | 'themes' | 'users' | 'roles' | 'zaobao' | 'breadth' | 'news'
             | 'app-users' | 'app-feedback' | 'app-events' | 'app-version' | 'daily-review';

interface AppState {
  // 数据
  themes: Theme[];
  users: Omit<AdminUser, 'password_hash'>[];
  reports: DailyReport[];
  breadthData: MarketBreadth[];
  breadthMonth: string; // 'recent30' 或 'YYYY-MM'
  // 每日复盘
  dailyReviews: DailyReview[];
  currentDailyReviewId: string | null;
  // 当前聚焦的主题 ID（股票池视图使用）
  currentThemeId: string | null;
  // 当前早报 ID（详情页使用）
  currentReportId: string | null;
  // UI 状态
  isLoading: boolean;
  toastMsg: string;
  // 登录状态
  isLoggedIn: boolean;
  currentUser: SessionUser | null;
  // 当前导航
  currentNav: NavItem;
  // 侧边栏系统管理菜单是否展开
  systemMenuOpen: boolean;
  // 侧边栏 APP 管理菜单是否展开
  appMenuOpen: boolean;

  // Actions
  setLoading: (v: boolean) => void;
  showToast: (msg: string) => void;
  setLoggedIn: (v: boolean) => void;
  setCurrentUser: (user: SessionUser | null) => void;
  setCurrentNav: (nav: NavItem) => void;
  setCurrentThemeId: (id: string | null) => void;
  setCurrentReportId: (id: string | null) => void;
  setCurrentDailyReviewId: (id: string | null) => void;
  toggleSystemMenu: () => void;
  toggleAppMenu: () => void;

  // 登录 Action
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;

  // 数据 Actions（async）
  loadThemes: () => Promise<void>;
  createTheme: (name: string, overview: string) => Promise<void>;
  updateTheme: (id: string, name: string, overview: string) => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  createStock: (themeId: string, input: Omit<import('@quantstock/types').Stock, 'id' | 'theme_id'>) => Promise<void>;
  updateStock: (stockId: string, input: Omit<import('@quantstock/types').Stock, 'id' | 'theme_id'>) => Promise<void>;
  deleteStock: (stockId: string) => Promise<void>;

  // 每日复盘 Actions
  loadDailyReviews: () => Promise<void>;

  // 早报 Actions
  loadReports: () => Promise<void>;

  // 涨跌家数 Actions
  loadBreadth: (mode: string) => Promise<void>;

  // 今日资讯 Actions
  newsItems: NewsItem[];
  newsDate: string;
  loadNewsItems: (date?: string) => Promise<void>;

  // APP 管理 Actions
  appUsers: AppUser[];
  userFeedbacks: UserFeedback[];
  userEvents: UserEvent[];
  appVersions: AppVersionControl[];
  loadAppUsers: () => Promise<void>;
  updateAppUserPlan: (userId: string, planType: PlanType, planExpiredAt: number | null) => Promise<void>;
  loadUserFeedbacks: () => Promise<void>;
  loadUserEvents: () => Promise<void>;
  loadAppVersions: () => Promise<void>;
  createAppVersion: (version: string, isForceUpdate: boolean, valueDesc: string) => Promise<void>;
  updateAppVersion: (id: string, patch: Partial<Omit<AppVersionControl, 'id' | 'created_at'>>) => Promise<void>;

  // 用户管理 Actions（仅 admin）
  loadUsers: () => Promise<void>;
  createUser: (username: string, password: string, role: UserRole) => Promise<void>;
  updateUserRole: (userId: string, role: UserRole) => Promise<void>;
  resetUserPassword: (userId: string, newPassword: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  themes: [],
  users: [],
  reports: [],
  breadthData: [],
  breadthMonth: 'recent30',
  newsItems: [],
  newsDate: '',
  appUsers: [],
  userFeedbacks: [],
  userEvents: [],
  appVersions: [],
  dailyReviews: [],
  currentDailyReviewId: null,
  currentThemeId: null,
  currentReportId: null,
  isLoading: false,
  toastMsg: '',
  isLoggedIn: false,
  currentUser: null,
  currentNav: 'dashboard',
  systemMenuOpen: false,
  appMenuOpen: false,

  setLoading: (v) => set({ isLoading: v }),

  showToast: (msg) => {
    set({ toastMsg: msg });
    setTimeout(() => set({ toastMsg: '' }), 2200);
  },

  setLoggedIn: (v) => set({ isLoggedIn: v }),

  setCurrentUser: (user) => set({ currentUser: user }),

  setCurrentNav: (nav) => set({ currentNav: nav }),

  setCurrentThemeId: (id) => set({ currentThemeId: id }),

  setCurrentReportId: (id) => set({ currentReportId: id }),

  setCurrentDailyReviewId: (id) => set({ currentDailyReviewId: id }),

  toggleSystemMenu: () => set((s) => ({ systemMenuOpen: !s.systemMenuOpen })),

  toggleAppMenu: () => set((s) => ({ appMenuOpen: !s.appMenuOpen })),

  // ===== 登录（调 Hono API，password_hash 不再传到前端） =====
  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) return false;
      const json = await res.json() as { data?: { token: string; user: SessionUser } };
      if (!json.data) return false;
      const { token, user } = json.data;
      sessionStorage.setItem('session_user', JSON.stringify(user));
      sessionStorage.setItem('admin_token', token);
      set({ isLoggedIn: true, currentUser: user });
      return true;
    } catch {
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 退出登录 =====
  logout: () => {
    sessionStorage.removeItem('session_user');
    sessionStorage.removeItem('admin_token');
    set({ isLoggedIn: false, currentUser: null, themes: [], users: [], reports: [], currentNav: 'dashboard' });
  },

  // ===== 加载全量主题（两阶段：先拉元数据秒出，再后台拉股票数据）=====
  loadThemes: async () => {
    set({ isLoading: true });
    try {
      // 第一阶段：只拉主题元数据，快速解除 loading
      const metaThemes = await apiClient.loadThemesMeta();
      set({ themes: metaThemes, isLoading: false });
      // 第二阶段：后台静默拉全量股票，完成后更新
      const fullThemes = await apiClient.loadThemes();
      set({ themes: fullThemes });
    } catch (e) {
      get().showToast('❌ 加载数据失败：' + (e as Error).message);
      set({ isLoading: false });
    }
  },

  // ===== 新增主题 =====
  createTheme: async (name, overview) => {
    set({ isLoading: true });
    try {
      const id = uid();
      await apiClient.createTheme(id, name, overview, Date.now());
      await get().loadThemes();
      get().showToast('✅ 主题已创建');
    } catch (e) {
      get().showToast('❌ 保存失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 更新主题 =====
  updateTheme: async (id, name, overview) => {
    set({ isLoading: true });
    try {
      await apiClient.updateTheme(id, name, overview);
      await get().loadThemes();
      get().showToast('✅ 主题已更新');
    } catch (e) {
      get().showToast('❌ 保存失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 删除主题 =====
  deleteTheme: async (id) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteTheme(id);
      await get().loadThemes();
      get().showToast('🗑️ 主题已删除');
    } catch (e) {
      get().showToast('❌ 删除失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 新增股票 =====
  createStock: async (themeId, input) => {
    set({ isLoading: true });
    try {
      await apiClient.createStock(themeId, uid(), input);
      await get().loadThemes();
      get().showToast('✅ 股票已添加');
    } catch (e) {
      get().showToast('❌ 保存失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 更新股票 =====
  updateStock: async (stockId, input) => {
    set({ isLoading: true });
    try {
      await apiClient.updateStock(stockId, input);
      await get().loadThemes();
      get().showToast('✅ 股票已更新');
    } catch (e) {
      get().showToast('❌ 保存失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 删除股票 =====
  deleteStock: async (stockId) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteStock(stockId);
      await get().loadThemes();
      get().showToast('🗑️ 股票已删除');
    } catch (e) {
      get().showToast('❌ 删除失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载每日复盘列表 =====
  loadDailyReviews: async () => {
    set({ isLoading: true });
    try {
      const dailyReviews = await apiClient.listDailyReviews(30);
      set({ dailyReviews });
    } catch (e) {
      get().showToast('❌ 加载每日复盘失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载早报列表 =====
  loadReports: async () => {
    set({ isLoading: true });
    try {
      const reports = await apiClient.listReports(30);
      set({ reports });
    } catch (e) {
      get().showToast('❌ 加载早报失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载今日资讯 =====
  loadNewsItems: async (date?: string) => {
    set({ isLoading: true });
    try {
      const targetDate = date ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const startMs = new Date(`${targetDate}T00:00:00+08:00`).getTime();
      const endMs   = new Date(`${targetDate}T23:59:59+08:00`).getTime();
      const { data, error } = await supabase
        .from('newsItems_cls')
        .select('id, cls_id, title, summary, categories, level, url, published_at')
        .gte('published_at', startMs)
        .lte('published_at', endMs)
        .order('published_at', { ascending: false });
      if (error) throw new Error(error.message);
      set({ newsItems: (data ?? []) as NewsItem[], newsDate: targetDate });
    } catch (e) {
      get().showToast('❌ 加载资讯失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载涨跌家数 =====
  loadBreadth: async (mode) => {
    set({ isLoading: true });
    try {
      const breadthData = await apiClient.getBreadthByMonth(mode);
      set({ breadthData, breadthMonth: mode });
    } catch (e) {
      get().showToast('❌ 加载涨跌家数失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载 App 用户列表 =====
  loadAppUsers: async () => {
    set({ isLoading: true });
    try {
      const appUsers = await apiClient.listAppUsers();
      set({ appUsers });
    } catch (e) {
      get().showToast('❌ 加载 App 用户失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 更新 App 用户套餐 =====
  updateAppUserPlan: async (userId, planType, planExpiredAt) => {
    set({ isLoading: true });
    try {
      await apiClient.updateAppUserPlan(userId, planType, planExpiredAt);
      await get().loadAppUsers();
      get().showToast('✅ 套餐已更新');
    } catch (e) {
      get().showToast('❌ 更新失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载用户反馈 =====
  loadUserFeedbacks: async () => {
    set({ isLoading: true });
    try {
      const userFeedbacks = await apiClient.listUserFeedbacks();
      set({ userFeedbacks });
    } catch (e) {
      get().showToast('❌ 加载用户反馈失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载用户行为事件 =====
  loadUserEvents: async () => {
    set({ isLoading: true });
    try {
      const userEvents = await apiClient.listUserEvents();
      set({ userEvents });
    } catch (e) {
      get().showToast('❌ 加载用户行为失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载版本列表 =====
  loadAppVersions: async () => {
    set({ isLoading: true });
    try {
      const appVersions = await apiClient.listVersions();
      set({ appVersions });
    } catch (e) {
      get().showToast('❌ 加载版本列表失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 新增版本 =====
  createAppVersion: async (version, isForceUpdate, valueDesc) => {
    set({ isLoading: true });
    try {
      await apiClient.createVersion({ id: uid(), version, is_force_update: isForceUpdate, value_desc: valueDesc, created_at: Date.now() });
      await get().loadAppVersions();
      get().showToast('✅ 版本已发布');
    } catch (e) {
      get().showToast('❌ 发布失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 更新版本 =====
  updateAppVersion: async (id, patch) => {
    set({ isLoading: true });
    try {
      await apiClient.updateVersion(id, patch);
      await get().loadAppVersions();
      get().showToast('✅ 版本已更新');
    } catch (e) {
      get().showToast('❌ 更新失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 加载用户列表 =====
  loadUsers: async () => {
    set({ isLoading: true });
    try {
      const users = await apiClient.listUsers();
      set({ users: users as Omit<AdminUser, 'password_hash'>[] });
    } catch (e) {
      get().showToast('❌ 加载用户失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 新增用户 =====
  createUser: async (username, password, role) => {
    set({ isLoading: true });
    try {
      const passwordHash = await hashPassword(password);
      await apiClient.createUser(uid(), username, passwordHash, role);
      await get().loadUsers();
      get().showToast('✅ 用户已创建');
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('duplicate') || msg.includes('unique')) {
        get().showToast('❌ 用户名已存在');
      } else {
        get().showToast('❌ 创建失败：' + msg);
      }
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 修改用户角色 =====
  updateUserRole: async (userId, role) => {
    set({ isLoading: true });
    try {
      await apiClient.updateUserRole(userId, role);
      await get().loadUsers();
      get().showToast('✅ 角色已更新');
    } catch (e) {
      get().showToast('❌ 更新失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 重置密码 =====
  resetUserPassword: async (userId, newPassword) => {
    set({ isLoading: true });
    try {
      const passwordHash = await hashPassword(newPassword);
      await apiClient.resetUserPassword(userId, passwordHash);
      get().showToast('✅ 密码已重置');
    } catch (e) {
      get().showToast('❌ 重置失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 删除用户 =====
  deleteUser: async (userId) => {
    set({ isLoading: true });
    try {
      await apiClient.deleteUser(userId);
      await get().loadUsers();
      get().showToast('🗑️ 用户已删除');
    } catch (e) {
      get().showToast('❌ 删除失败：' + (e as Error).message);
    } finally {
      set({ isLoading: false });
    }
  },
}));
