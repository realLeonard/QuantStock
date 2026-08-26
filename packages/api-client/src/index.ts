import type {
  Theme,
  Stock,
  StockInput,
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
  LoginLogSummary,
} from '@quantstock/types';

// 资讯条目（服务端 GET /api/news 返回结构）
export interface NewsItem {
  id: string;
  cls_id: string;
  title: string;
  summary: string | null;
  categories: string | null;
  level: string | null;
  url: string | null;
  published_at: number;
}

export interface ApiClientOptions {
  /** Hono API 基础地址（如 /backend-api，代理到 ${API}/api） */
  baseUrl: string;
  /** 每次请求时读取 JWT（返回 null 表示未登录，不携带 Authorization） */
  getToken: () => string | null;
  /** 401 时先触发该回调（code 为服务端错误码，如 SESSION_KICKED），随后照旧抛错 */
  onAuthError?: (code?: string) => void;
}

/**
 * QuantStock API 客户端：所有数据操作经 Hono API + JWT，
 * 浏览器不再直连 Supabase（anon key 已从前端移除）
 */
export class QuantStockApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private onAuthError?: (code?: string) => void;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.getToken = options.getToken;
    this.onAuthError = options.onAuthError;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const doFetch = () =>
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

    // Vercel 边缘 → 阿里云跨境链路偶发连接失败（502/504），幂等 GET 自动重试一次
    let resp: Response;
    try {
      resp = await doFetch();
      if (method === 'GET' && (resp.status === 502 || resp.status === 504)) {
        await new Promise((r) => setTimeout(r, 800));
        resp = await doFetch();
      }
    } catch (e) {
      if (method !== 'GET') throw e;
      await new Promise((r) => setTimeout(r, 800));
      resp = await doFetch();
    }

    let parsed: { data?: T; error?: string; code?: string } | null = null;
    try {
      parsed = await resp.json();
    } catch {
      // 非 JSON 响应（如网关错误页）
    }

    if (!resp.ok) {
      if (resp.status === 401) {
        this.onAuthError?.(parsed?.code);
      }
      throw new Error(parsed?.error ?? `请求失败（HTTP ${resp.status}）`);
    }
    return parsed?.data as T;
  }

  // ===== 主题 =====

  async loadThemesMeta(): Promise<Theme[]> {
    return this.request('GET', '/themes/meta');
  }

  async loadThemes(): Promise<Theme[]> {
    return this.request('GET', '/themes');
  }

  // id/createdAt 由服务端生成，参数保留仅为兼容旧调用方签名
  async createTheme(_id: string, name: string, overview: string, _createdAt: number): Promise<void> {
    await this.request('POST', '/themes', { name, overview });
  }

  async updateTheme(id: string, name: string, overview: string): Promise<void> {
    await this.request('PUT', `/themes/${encodeURIComponent(id)}`, { name, overview });
  }

  async deleteTheme(themeId: string): Promise<void> {
    await this.request('DELETE', `/themes/${encodeURIComponent(themeId)}`);
  }

  // ===== 股票 =====

  async createStock(themeId: string, _stockId: string, input: StockInput): Promise<void> {
    await this.request('POST', `/themes/${encodeURIComponent(themeId)}/stocks`, {
      code: input.code,
      name: input.name,
      cat1: input.cat1,
      cat2: input.cat2,
      cat3: input.cat3,
      relation: input.relation,
      stars: input.stars,
      highlight: input.highlight,
    });
  }

  async updateStock(stockId: string, input: StockInput): Promise<void> {
    await this.request('PUT', `/stocks/${encodeURIComponent(stockId)}`, {
      code: input.code,
      name: input.name,
      cat1: input.cat1,
      cat2: input.cat2,
      cat3: input.cat3,
      relation: input.relation,
      stars: input.stars,
      highlight: input.highlight,
    });
  }

  async deleteStock(stockId: string): Promise<void> {
    await this.request('DELETE', `/stocks/${encodeURIComponent(stockId)}`);
  }

  // ===== 后台用户（bcrypt 哈希在服务端计算，前端传明文密码走 HTTPS） =====

  async listUsers(): Promise<AdminUser[]> {
    return this.request('GET', '/admin-users');
  }

  async createUser(username: string, password: string, role: UserRole): Promise<void> {
    await this.request('POST', '/admin-users', { username, password, role });
  }

  async updateUserRole(userId: string, role: UserRole): Promise<void> {
    await this.request('PATCH', `/admin-users/${encodeURIComponent(userId)}/role`, { role });
  }

  async resetUserPassword(userId: string, password: string): Promise<void> {
    await this.request('POST', `/admin-users/${encodeURIComponent(userId)}/reset-password`, {
      password,
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request('DELETE', `/admin-users/${encodeURIComponent(userId)}`);
  }

  // ===== 登录日志（仅 admin） =====

  async listLoginLogs(
    page: number,
    pageSize: number,
    username?: string
  ): Promise<{ items: LoginLog[]; total: number }> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (username) params.set('username', username);
    return this.request('GET', `/login-logs?${params.toString()}`);
  }

  async getLoginLogSummary(days = 30): Promise<LoginLogSummary[]> {
    return this.request('GET', `/login-logs/summary?days=${days}`);
  }

  // ===== 每日早报 =====

  async listReports(limit = 30): Promise<DailyReport[]> {
    return this.request('GET', `/reports?limit=${limit}`);
  }

  // ===== 市场涨跌家数 =====

  async getBreadthByMonth(mode: string): Promise<MarketBreadth[]> {
    return this.request('GET', `/breadth?mode=${encodeURIComponent(mode)}`);
  }

  // ===== App 用户 =====

  async listAppUsers(): Promise<AppUser[]> {
    return this.request('GET', '/app-users');
  }

  async updateAppUserPlan(
    userId: string,
    planType: PlanType,
    planExpiredAt: number | null
  ): Promise<void> {
    await this.request('PATCH', `/app-users/${encodeURIComponent(userId)}/plan`, {
      plan_type: planType,
      plan_expired_at: planExpiredAt,
    });
  }

  async listUserFeedbacks(): Promise<UserFeedback[]> {
    return this.request('GET', '/feedbacks');
  }

  async listUserEvents(limit = 200): Promise<UserEvent[]> {
    return this.request('GET', `/events?limit=${limit}`);
  }

  // ===== 每日复盘 / 涨停原因 =====

  async listDailyReviews(limit = 30): Promise<DailyReview[]> {
    return this.request('GET', `/daily-reviews?limit=${limit}`);
  }

  async getLimitUpReasonsByDate(date: string): Promise<LimitUpReasons | null> {
    return this.request('GET', `/limit-up-reasons/${encodeURIComponent(date)}`);
  }

  // ===== App 版本管理 =====

  async listVersions(): Promise<AppVersionControl[]> {
    return this.request('GET', '/versions');
  }

  // id/created_at 由服务端生成，record 中同名字段被忽略
  async createVersion(record: AppVersionControl): Promise<void> {
    await this.request('POST', '/versions', {
      version: record.version,
      is_force_update: record.is_force_update,
      value_desc: record.value_desc,
    });
  }

  async updateVersion(
    id: string,
    patch: Partial<Omit<AppVersionControl, 'id' | 'created_at'>>
  ): Promise<void> {
    await this.request('PATCH', `/versions/${encodeURIComponent(id)}`, patch);
  }

  // ===== 近期掘金 =====

  async fetchRecentInsights(): Promise<RecentInsights> {
    return this.request('GET', '/insights');
  }

  async updateRecentInsights(thoughts: string, focusDirection: string): Promise<void> {
    await this.request('PUT', '/insights', {
      thoughts,
      focus_direction: focusDirection,
    });
  }

  async fetchDailyGoldPicks(): Promise<DailyGoldPick[]> {
    return this.request('GET', '/gold-picks');
  }

  // ===== 板块预测 =====

  async listSectorPredictionDays(limit = 60): Promise<SectorScore[]> {
    return this.request('GET', `/sectors/prediction-days?limit=${limit}`);
  }

  async getSectorScoresByDate(date: string): Promise<SectorScore[]> {
    return this.request('GET', `/sectors/scores/${encodeURIComponent(date)}`);
  }

  async getSectorDailyByDate(date: string): Promise<SectorDaily[]> {
    return this.request('GET', `/sectors/daily/${encodeURIComponent(date)}`);
  }

  async getSectorRotationMap(): Promise<SectorRotationMap[]> {
    return this.request('GET', '/sectors/rotation-map');
  }

  async listSectorMasters(): Promise<SectorMaster[]> {
    return this.request('GET', '/sectors/masters');
  }

  async listStockCodes(): Promise<StockCode[]> {
    return this.request('GET', '/stock-codes');
  }

  // ===== 资讯 =====

  async listNewsItems(date: string): Promise<NewsItem[]> {
    return this.request('GET', `/news?date=${encodeURIComponent(date)}`);
  }
}

export type {
  Theme,
  Stock,
  StockInput,
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
  LoginLogSummary,
};
