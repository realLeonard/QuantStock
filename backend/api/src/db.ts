import { createClient } from '@supabase/supabase-js';
import type {
  Theme,
  StockInput,
  ThemeRow,
  StockRow,
  AdminUser,
  UserRole,
  DailyReport,
  MarketBreadth,
  AppUser,
  PlanType,
  UserFeedback,
  UserEvent,
  AppVersionControl,
  DailyReview,
  RecentInsights,
  DailyGoldPick,
  LimitUpReasons,
  SectorScore,
  SectorDaily,
  SectorRotationMap,
  SectorMaster,
  StockCode,
  LoginLog,
} from '@quantstock/types';

// ===== 共享 Supabase 客户端（service key，绕过 RLS，服务端专用） =====
export const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? ''
);

// 资讯条目（newsItems_cls 表，无共享类型，仅服务端与 Web 资讯页使用）
export interface NewsItemCls {
  id: string;
  cls_id: string;
  title: string;
  summary: string | null;
  categories: string | null;
  level: string | null;
  url: string | null;
  published_at: number;
}

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

// ===== 数据访问层（原 @quantstock/api-client 的 Supabase 实现内聚到服务端） =====
export const db = {
  // ---- 主题/股票 ----

  async loadThemesMeta(): Promise<Theme[]> {
    const { data, error } = await supabase
      .from('themeConcept')
      .select('id, name, overview, created_at, updated_at, sort_order, title_color')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map((row) => mapThemeRow({ ...(row as ThemeRow), themeStocks: [] }));
  },

  async loadThemes(): Promise<Theme[]> {
    const { data, error } = await supabase
      .from('themeConcept')
      .select('*, themeStocks(*)')
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(mapThemeRow);
  },

  async createTheme(id: string, name: string, overview: string, createdAt: number): Promise<void> {
    const { error } = await supabase.from('themeConcept').insert({
      id,
      name,
      overview,
      created_at: createdAt,
      updated_at: Date.now(),
    });
    if (error) throw new Error(error.message);
  },

  async updateTheme(id: string, name: string, overview: string): Promise<void> {
    const { error } = await supabase
      .from('themeConcept')
      .update({ name, overview, updated_at: Date.now() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async deleteTheme(themeId: string): Promise<void> {
    const { error } = await supabase.from('themeConcept').delete().eq('id', themeId);
    if (error) throw new Error(error.message);
  },

  async createStock(themeId: string, stockId: string, input: StockInput): Promise<void> {
    const { error } = await supabase.from('themeStocks').insert({
      id: stockId,
      theme_id: themeId,
      ...input,
    });
    if (error) throw new Error(error.message);
  },

  async updateStock(stockId: string, input: StockInput): Promise<void> {
    const { error } = await supabase
      .from('themeStocks')
      .update({ ...input })
      .eq('id', stockId);
    if (error) throw new Error(error.message);
  },

  async deleteStock(stockId: string): Promise<void> {
    const { error } = await supabase.from('themeStocks').delete().eq('id', stockId);
    if (error) throw new Error(error.message);
  },

  // ---- 后台用户 ----

  async findUserByUsername(username: string): Promise<AdminUser | null> {
    const { data, error } = await supabase
      .from('adminUsers')
      .select('*')
      .eq('username', username)
      .single();
    if (error) return null;
    return data as AdminUser;
  },

  async listUsers(): Promise<AdminUser[]> {
    const { data, error } = await supabase
      .from('adminUsers')
      .select('id, username, role, created_at, subscription_expires_at')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as AdminUser[];
  },

  async createUser(id: string, username: string, passwordHash: string, role: UserRole): Promise<void> {
    const { error } = await supabase.from('adminUsers').insert({
      id,
      username,
      password_hash: passwordHash,
      role,
      created_at: Date.now(),
    });
    if (error) throw new Error(error.message);
  },

  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    const { error } = await supabase.from('adminUsers').update({ role }).eq('id', userId);
    if (error) throw new Error(error.message);
  },

  async resetUserPassword(userId: string, passwordHash: string): Promise<void> {
    // 同时写 token_invalid_before：改密后旧 token 立即吊销
    const { error } = await supabase
      .from('adminUsers')
      .update({ password_hash: passwordHash, token_invalid_before: Date.now() })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  },

  async deleteUser(userId: string): Promise<void> {
    const { error } = await supabase.from('adminUsers').delete().eq('id', userId);
    if (error) throw new Error(error.message);
  },

  // ---- 登录日志 / 单会话 ----

  async createLoginLog(log: LoginLog): Promise<void> {
    const { error } = await supabase.from('loginLogs').insert(log);
    if (error) throw new Error(error.message);
  },

  async updateUserSession(userId: string, sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('adminUsers')
      .update({ current_session_id: sessionId })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  },

  async listLoginLogs(
    page: number,
    pageSize: number,
    username?: string
  ): Promise<{ items: LoginLog[]; total: number }> {
    const from = (page - 1) * pageSize;
    let query = supabase
      .from('loginLogs')
      .select('*', { count: 'exact' })
      .order('login_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (username) {
      query = query.eq('username', username);
    }
    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { items: (data || []) as LoginLog[], total: count ?? 0 };
  },

  async listLoginLogsSince(sinceMs: number): Promise<LoginLog[]> {
    const PAGE_SIZE = 1000;
    const all: LoginLog[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('loginLogs')
        .select('*')
        .gte('login_at', sinceMs)
        .eq('success', true)
        .order('login_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      all.push(...(data as LoginLog[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  },

  // ---- 每日早报 ----

  async listReports(limit = 30): Promise<DailyReport[]> {
    const { data, error } = await supabase
      .from('dailyReport')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as DailyReport[];
  },

  async getReportByDate(date: string): Promise<DailyReport | null> {
    const { data, error } = await supabase
      .from('dailyReport')
      .select('*')
      .eq('report_date', date)
      .maybeSingle();
    if (error) return null;
    return (data as DailyReport) ?? null;
  },

  // 移动端列表：只取轻量字段，分页
  async listReportsLight(page: number, pageSize: number): Promise<DailyReport[]> {
    const from = (page - 1) * pageSize;
    const { data, error } = await supabase
      .from('dailyReport')
      .select('id, report_date, report_type, summary, created_at')
      .order('report_date', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return (data || []) as DailyReport[];
  },

  // ---- 市场涨跌家数 ----

  async getBreadthByMonth(mode: string): Promise<MarketBreadth[]> {
    let query = supabase.from('marketBreadth').select('*');
    if (mode === 'recent30') {
      const from = new Date();
      from.setDate(from.getDate() - 30);
      query = query.gte('trade_date', from.toISOString().slice(0, 10));
    } else {
      query = query.gte('trade_date', `${mode}-01`).lte('trade_date', `${mode}-31`);
    }
    const { data, error } = await query.order('trade_date', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as MarketBreadth[];
  },

  // ---- App 用户（真实表名 appUsers，注意非单数） ----

  async listAppUsers(): Promise<AppUser[]> {
    const { data, error } = await supabase
      .from('appUsers')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as AppUser[];
  },

  async updateAppUserPlan(userId: string, planType: PlanType, planExpiredAt: number | null): Promise<void> {
    const { error } = await supabase
      .from('appUsers')
      .update({ plan_type: planType, plan_expired_at: planExpiredAt })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  },

  async getAppUserByAuthId(authId: string): Promise<AppUser | null> {
    const { data, error } = await supabase
      .from('appUsers')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();
    if (error) return null;
    return (data as AppUser) ?? null;
  },

  // ---- 反馈 / 行为事件（真实表名 userEvents） ----

  async listUserFeedbacks(): Promise<UserFeedback[]> {
    const { data, error } = await supabase
      .from('userFeedback')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as UserFeedback[];
  },

  async listUserEvents(limit = 200): Promise<UserEvent[]> {
    const { data, error } = await supabase
      .from('userEvents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as UserEvent[];
  },

  // ---- 每日复盘 / 涨停原因 ----

  async listDailyReviews(limit = 30): Promise<DailyReview[]> {
    const { data, error } = await supabase
      .from('dailyReview')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data || []) as DailyReview[];
  },

  async getLimitUpReasonsByDate(date: string): Promise<LimitUpReasons | null> {
    const { data, error } = await supabase
      .from('limitUpReasons')
      .select('*')
      .eq('pick_date', date)
      .maybeSingle();
    if (error) return null;
    return (data as LimitUpReasons) ?? null;
  },

  // ---- App 版本管理 ----

  async listVersions(): Promise<AppVersionControl[]> {
    const { data, error } = await supabase
      .from('appVersionControl')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as AppVersionControl[];
  },

  async createVersion(record: AppVersionControl): Promise<void> {
    const { error } = await supabase.from('appVersionControl').insert(record);
    if (error) throw new Error(error.message);
  },

  async updateVersion(
    id: string,
    patch: Partial<Omit<AppVersionControl, 'id' | 'created_at'>>
  ): Promise<void> {
    const { error } = await supabase.from('appVersionControl').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ---- 近期掘金 ----

  async fetchRecentInsights(): Promise<RecentInsights> {
    const { data, error } = await supabase
      .from('recentInsights')
      .select('*')
      .eq('id', 'singleton')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return { id: 'singleton', thoughts: '', focus_direction: '', updated_at: 0 };
    }
    return data as RecentInsights;
  },

  async updateRecentInsights(thoughts: string, focusDirection: string): Promise<void> {
    const { error } = await supabase.from('recentInsights').upsert(
      {
        id: 'singleton',
        thoughts,
        focus_direction: focusDirection,
        updated_at: Date.now(),
      },
      { onConflict: 'id' }
    );
    if (error) throw new Error(error.message);
  },

  async fetchDailyGoldPicks(): Promise<DailyGoldPick[]> {
    const { data, error } = await supabase
      .from('dailyGoldPicks')
      .select('*')
      .order('pick_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as DailyGoldPick[];
  },

  // ---- 板块预测 ----

  async listSectorPredictionDays(limit = 60): Promise<SectorScore[]> {
    const { data, error } = await supabase
      .from('sector_scores')
      .select(
        'trade_date, signal, market_emotion_phase, stage, total_score, confidence, sector_name, leading_stock, rank'
      )
      .order('trade_date', { ascending: false })
      .limit(limit * 300); // 每天约300条，取足量
    if (error) throw new Error(error.message);
    return (data || []) as SectorScore[];
  },

  async getSectorScoresByDate(date: string): Promise<SectorScore[]> {
    const { data, error } = await supabase
      .from('sector_scores')
      .select('*')
      .eq('trade_date', date)
      .order('rank', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as SectorScore[];
  },

  async getSectorDailyByDate(date: string): Promise<SectorDaily[]> {
    const { data, error } = await supabase
      .from('sector_daily')
      .select('*')
      .eq('trade_date', date)
      .order('change_pct', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as SectorDaily[];
  },

  async getSectorRotationMap(): Promise<SectorRotationMap[]> {
    const { data, error } = await supabase
      .from('sector_rotation_map')
      .select('*')
      .order('source_sector', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as SectorRotationMap[];
  },

  async listSectorMasters(): Promise<SectorMaster[]> {
    const { data, error } = await supabase
      .from('sector_master')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as SectorMaster[];
  },

  async listStockCodes(): Promise<StockCode[]> {
    const PAGE_SIZE = 1000;
    const all: StockCode[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('stockCodes')
        .select('*')
        .order('code', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      all.push(...(data as StockCode[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  },

  // ---- 资讯（newsItems_cls） ----

  async listNewsItemsByRange(startMs: number, endMs: number): Promise<NewsItemCls[]> {
    const { data, error } = await supabase
      .from('newsItems_cls')
      .select('id, cls_id, title, summary, categories, level, url, published_at')
      .gte('published_at', startMs)
      .lte('published_at', endMs)
      .order('published_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []) as NewsItemCls[];
  },

  // ---- App 配置 ----

  async getAppConfigValue(key: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('appConfig')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) return null;
    return (data?.value as string) ?? null;
  },
};
