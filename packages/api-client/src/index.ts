import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Theme, Stock, StockInput, ThemeRow, StockRow, AdminUser, UserRole, DailyReport, MarketBreadth, AppUser, PlanType, UserFeedback, UserEvent, AppVersionControl, DailyReview, RecentInsights, DailyGoldPick, LimitUpReasons } from '@quantstock/types';

// ===== Supabase 客户端工厂 =====
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey);
}

// ===== 将 Supabase 原始行转换为应用内 Theme 对象 =====
function mapThemeRow(row: ThemeRow): Theme {
  return {
    ...row,
    sort_order: row.sort_order ?? null,
    title_color: row.title_color ?? null,
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

  // 加载主题元数据（不含股票），用于快速渲染仪表盘
  async loadThemesMeta(): Promise<Theme[]> {
    const { data, error } = await this.sb
      .from('themeConcept')
      .select('id, name, overview, created_at, updated_at, sort_order, title_color')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(row => mapThemeRow({ ...row, themeStocks: [] }));
  }

  // 加载全量数据（含嵌套股票）
  // 排序：sort_order 正序优先（nulls last，前15条在前），其余按 updated_at 倒序
  async loadThemes(): Promise<Theme[]> {
    const { data, error } = await this.sb
      .from('themeConcept')
      .select('*, themeStocks(*)')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });
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

  // ===== 每日早报 =====

  // 获取早报列表（按日期倒序）
  async listReports(limit = 30): Promise<DailyReport[]> {
    const { data, error } = await this.sb
      .from('dailyReport')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as DailyReport[];
  }

  // 获取指定日期的早报
  async getReportByDate(date: string): Promise<DailyReport | null> {
    const { data, error } = await this.sb
      .from('dailyReport')
      .select('*')
      .eq('report_date', date)
      .single();
    if (error) return null;
    return data as DailyReport;
  }

  // 获取单条早报详情
  async getReport(id: string): Promise<DailyReport | null> {
    const { data, error } = await this.sb
      .from('dailyReport')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data as DailyReport;
  }

  // 新增或更新早报（upsert，按 report_date 去重）
  async upsertReport(report: DailyReport): Promise<void> {
    const { error } = await this.sb
      .from('dailyReport')
      .upsert(report, { onConflict: 'report_date' });
    if (error) throw new Error(error.message);
  }

  // ===== 市场涨跌家数 =====

  // 查询最近 N 天数据（mode='recent30'）或指定月份（mode='YYYY-MM'）
  async getBreadthByMonth(mode: string): Promise<MarketBreadth[]> {
    let query = this.sb.from('marketBreadth').select('*');

    if (mode === 'recent30') {
      // 最近 30 个自然日
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const fromStr = from.toISOString().slice(0, 10);
      query = query.gte('trade_date', fromStr);
    } else {
      // 指定月份，如 '2026-03'
      const start = `${mode}-01`;
      const end = `${mode}-31`;
      query = query.gte('trade_date', start).lte('trade_date', end);
    }

    const { data, error } = await query.order('trade_date', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as MarketBreadth[];
  }

  // ===== APP 用户管理 =====

  // 获取全量 App 用户列表
  async listAppUsers(): Promise<AppUser[]> {
    const { data, error } = await this.sb
      .from('appUser')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as AppUser[];
  }

  // 更新 App 用户套餐
  async updateAppUserPlan(userId: string, planType: PlanType, planExpiredAt: number | null): Promise<void> {
    const { error } = await this.sb
      .from('appUser')
      .update({ plan_type: planType, plan_expired_at: planExpiredAt })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  }

  // ===== 用户反馈 =====

  // 获取用户反馈列表
  async listUserFeedbacks(): Promise<UserFeedback[]> {
    const { data, error } = await this.sb
      .from('userFeedback')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as UserFeedback[];
  }

  // ===== 用户行为事件 =====

  // 获取用户行为事件列表
  async listUserEvents(limit = 200): Promise<UserEvent[]> {
    const { data, error } = await this.sb
      .from('userEvent')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as UserEvent[];
  }

  // ===== 每日复盘 =====

  // 获取复盘列表（按日期倒序）
  async listDailyReviews(limit = 30): Promise<DailyReview[]> {
    const { data, error } = await this.sb
      .from('dailyReview')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as DailyReview[];
  }

  // 获取单条复盘详情
  async getDailyReview(id: string): Promise<DailyReview | null> {
    const { data, error } = await this.sb
      .from('dailyReview')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data as DailyReview;
  }

  // 按日期获取韭研公社涨停原因「今日异动」
  async getLimitUpReasonsByDate(date: string): Promise<LimitUpReasons | null> {
    const { data, error } = await this.sb
      .from('limitUpReasons')
      .select('*')
      .eq('pick_date', date)
      .maybeSingle();
    if (error) return null;
    return (data as LimitUpReasons) ?? null;
  }

  // ===== App 版本管理 =====

  // 获取版本列表
  async listVersions(): Promise<AppVersionControl[]> {
    const { data, error } = await this.sb
      .from('appVersionControl')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as AppVersionControl[];
  }

  // 新增版本
  async createVersion(record: AppVersionControl): Promise<void> {
    const { error } = await this.sb.from('appVersionControl').insert(record);
    if (error) throw new Error(error.message);
  }

  // 更新版本
  async updateVersion(id: string, patch: Partial<Omit<AppVersionControl, 'id' | 'created_at'>>): Promise<void> {
    const { error } = await this.sb
      .from('appVersionControl')
      .update(patch)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ===== 近期掘金：近期思路和方向（单条，id='singleton'）=====

  async fetchRecentInsights(): Promise<RecentInsights> {
    const { data, error } = await this.sb
      .from('recentInsights')
      .select('*')
      .eq('id', 'singleton')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return { id: 'singleton', thoughts: '', focus_direction: '', updated_at: 0 };
    }
    return data as RecentInsights;
  }

  async updateRecentInsights(thoughts: string, focusDirection: string): Promise<void> {
    const { error } = await this.sb
      .from('recentInsights')
      .upsert({
        id: 'singleton',
        thoughts,
        focus_direction: focusDirection,
        updated_at: Date.now(),
      }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  // ===== 近期掘金：每日掘金板块个股 =====

  async fetchDailyGoldPicks(): Promise<DailyGoldPick[]> {
    const { data, error } = await this.sb
      .from('dailyGoldPicks')
      .select('*')
      .order('pick_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as DailyGoldPick[];
  }

  async fetchDailyGoldPickByDate(date: string): Promise<DailyGoldPick | null> {
    const { data, error } = await this.sb
      .from('dailyGoldPicks')
      .select('*')
      .eq('pick_date', date)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data || null) as DailyGoldPick | null;
  }
}

export type { Theme, Stock, StockInput, AdminUser, UserRole, DailyReport, MarketBreadth, AppUser, PlanType, UserFeedback, UserEvent, AppVersionControl, DailyReview, RecentInsights, DailyGoldPick };
