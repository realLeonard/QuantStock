'use client';

import { create } from 'zustand';
import type { Theme } from '@quantstock/types';
import { apiClient } from '@/lib/supabase';

interface AppState {
  // 数据
  themes: Theme[];
  // 当前聚焦的主题 ID（股票池视图使用）
  currentThemeId: string | null;
  // UI 状态
  isLoading: boolean;
  toastMsg: string;
  // 登录状态
  isLoggedIn: boolean;
  // 当前导航
  currentNav: 'dashboard' | 'themes';

  // Actions
  setLoading: (v: boolean) => void;
  showToast: (msg: string) => void;
  setLoggedIn: (v: boolean) => void;
  setCurrentNav: (nav: 'dashboard' | 'themes') => void;
  setCurrentThemeId: (id: string | null) => void;

  // 数据 Actions（async）
  loadThemes: () => Promise<void>;
  createTheme: (name: string, overview: string) => Promise<void>;
  updateTheme: (id: string, name: string, overview: string) => Promise<void>;
  deleteTheme: (id: string) => Promise<void>;
  createStock: (themeId: string, input: Omit<import('@quantstock/types').Stock, 'id' | 'theme_id'>) => Promise<void>;
  updateStock: (stockId: string, input: Omit<import('@quantstock/types').Stock, 'id' | 'theme_id'>) => Promise<void>;
  deleteStock: (stockId: string) => Promise<void>;
}

import { uid } from '@/lib/utils';

export const useAppStore = create<AppState>((set, get) => ({
  themes: [],
  currentThemeId: null,
  isLoading: false,
  toastMsg: '',
  isLoggedIn: false,
  currentNav: 'dashboard',

  setLoading: (v) => set({ isLoading: v }),

  showToast: (msg) => {
    set({ toastMsg: msg });
    // 2.2 秒后清除
    setTimeout(() => set({ toastMsg: '' }), 2200);
  },

  setLoggedIn: (v) => set({ isLoggedIn: v }),

  setCurrentNav: (nav) => set({ currentNav: nav }),

  setCurrentThemeId: (id) => set({ currentThemeId: id }),

  // ===== 加载全量主题 =====
  loadThemes: async () => {
    set({ isLoading: true });
    try {
      const themes = await apiClient.loadThemes();
      set({ themes });
    } catch (e) {
      get().showToast('❌ 加载数据失败：' + (e as Error).message);
    } finally {
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
}));
