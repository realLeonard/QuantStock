'use client';

import { create } from 'zustand';
import type { Theme, AdminUser, SessionUser, UserRole, DailyReport, MarketBreadth } from '@quantstock/types';
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
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { uid } from '@/lib/utils';

type NavItem = 'dashboard' | 'themes' | 'users' | 'roles' | 'zaobao' | 'breadth' | 'news';

interface AppState {
  // 数据
  themes: Theme[];
  users: Omit<AdminUser, 'password_hash'>[];
  reports: DailyReport[];
  breadthData: MarketBreadth[];
  breadthMonth: string; // 'recent30' 或 'YYYY-MM'
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

  // Actions
  setLoading: (v: boolean) => void;
  showToast: (msg: string) => void;
  setLoggedIn: (v: boolean) => void;
  setCurrentUser: (user: SessionUser | null) => void;
  setCurrentNav: (nav: NavItem) => void;
  setCurrentThemeId: (id: string | null) => void;
  setCurrentReportId: (id: string | null) => void;
  toggleSystemMenu: () => void;

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

  // 早报 Actions
  loadReports: () => Promise<void>;

  // 涨跌家数 Actions
  loadBreadth: (mode: string) => Promise<void>;

  // 今日资讯 Actions
  newsItems: NewsItem[];
  newsDate: string;
  loadNewsItems: (date?: string) => Promise<void>;

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
  currentThemeId: null,
  currentReportId: null,
  isLoading: false,
  toastMsg: '',
  isLoggedIn: false,
  currentUser: null,
  currentNav: 'dashboard',
  systemMenuOpen: false,

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

  toggleSystemMenu: () => set((s) => ({ systemMenuOpen: !s.systemMenuOpen })),

  // ===== 登录 =====
  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const user = await apiClient.findUserByUsername(username);
      if (!user) return false;
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) return false;
      const session: SessionUser = { username: user.username, role: user.role };
      sessionStorage.setItem('session_user', JSON.stringify(session));
      set({ isLoggedIn: true, currentUser: session });
      return true;
    } finally {
      set({ isLoading: false });
    }
  },

  // ===== 退出登录 =====
  logout: () => {
    sessionStorage.removeItem('session_user');
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
