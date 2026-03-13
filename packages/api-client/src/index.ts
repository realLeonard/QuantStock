import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Theme, Stock, StockInput, ThemeRow, StockRow, AdminUser, UserRole } from '@quantstock/types';

// ===== Supabase 客户端工厂 =====
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}

// ===== 将 Supabase 原始行转换为应用内 Theme 对象 =====
function mapThemeRow(row: ThemeRow): Theme {
  return {
    ...row,
    stocks: (row.themeStocks || []).map((s: StockRow) => ({
      id: s.id,
      theme_id: s.theme_id,
      code: s.code,
      name: s.name,
      cat1: s.cat1 || '',
      cat2: s.cat2 || '',
      cat3: s.cat3 || '',
      relation: s.relation || '',
      stars: s.stars,
      highlight: s.highlight || '',
      sort_order: s.sort_order ?? null,
    })),
  };
}

// ===== API 客户端（封装所有 Supabase 操作） =====
export class QuantStockApiClient {
  private sb: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.sb = supabase;
  }

  // 加载全量数据（含嵌套股票）
  async loadThemes(): Promise<Theme[]> {
    const { data, error } = await this.sb
      .from('themeConcept')
      .select('*, themeStocks(*)')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(mapThemeRow);
  }

  // 新增主题
  async createTheme(id: string, name: string, overview: string, createdAt: number): Promise<void> {
    const now = Date.now();
    const { error } = await this.sb.from('themeConcept').insert({
      id,
      name,
      overview,
      created_at: createdAt,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }

  // 更新主题
  async updateTheme(id: string, name: string, overview: string): Promise<void> {
    const { error } = await this.sb
      .from('themeConcept')
      .update({ name, overview, updated_at: Date.now() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // 删除主题（级联删除 themeStocks）
  async deleteTheme(themeId: string): Promise<void> {
    const { error } = await this.sb.from('themeConcept').delete().eq('id', themeId);
    if (error) throw new Error(error.message);
  }

  // 新增股票
  async createStock(themeId: string, stockId: string, input: StockInput): Promise<void> {
    const { error } = await this.sb.from('themeStocks').insert({
      id: stockId,
      theme_id: themeId,
      ...input,
    });
    if (error) throw new Error(error.message);
  }

  // 更新股票
  async updateStock(stockId: string, input: StockInput): Promise<void> {
    const { error } = await this.sb
      .from('themeStocks')
      .update({ ...input })
      .eq('id', stockId);
    if (error) throw new Error(error.message);
  }

  // 删除股票
  async deleteStock(stockId: string): Promise<void> {
    const { error } = await this.sb.from('themeStocks').delete().eq('id', stockId);
    if (error) throw new Error(error.message);
  }

  // ===== 用户管理 =====

  // 验证登录：查找用户名，返回用户记录（含 password_hash，由调用方验证密码）
  async findUserByUsername(username: string): Promise<AdminUser | null> {
    const { data, error } = await this.sb
      .from('adminUsers')
      .select('*')
      .eq('username', username)
      .single();
    if (error) return null;
    return data as AdminUser;
  }

  // 获取全量用户列表
  async listUsers(): Promise<AdminUser[]> {
    const { data, error } = await this.sb
      .from('adminUsers')
      .select('id, username, role, created_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as AdminUser[];
  }

  // 新增用户
  async createUser(id: string, username: string, passwordHash: string, role: UserRole): Promise<void> {
    const { error } = await this.sb.from('adminUsers').insert({
      id,
      username,
      password_hash: passwordHash,
      role,
      created_at: Date.now(),
    });
    if (error) throw new Error(error.message);
  }

  // 更新用户角色
  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    const { error } = await this.sb
      .from('adminUsers')
      .update({ role })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  }

  // 重置密码
  async resetUserPassword(userId: string, passwordHash: string): Promise<void> {
    const { error } = await this.sb
      .from('adminUsers')
      .update({ password_hash: passwordHash })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  }

  // 删除用户
  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.sb.from('adminUsers').delete().eq('id', userId);
    if (error) throw new Error(error.message);
  }
}

export type { Theme, Stock, StockInput, AdminUser, UserRole };
