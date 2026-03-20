// ===== 用户角色 =====
export type UserRole = 'viewer' | 'editor' | 'admin';

// ===== 后台用户 =====
export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: number; // Unix 时间戳（毫秒）
}

// ===== 登录会话（存 sessionStorage）=====
export interface SessionUser {
  username: string;
  role: UserRole;
}

// ===== 股票高亮类型 =====
export type StockHighlight = '' | 'red' | 'orange';

// ===== 股票记录 =====
export interface Stock {
  id: string;
  theme_id: string;
  code: string;
  name: string;
  cat1: string;
  cat2: string;
  cat3: string;
  relation: string;
  stars: number;        // 1-5
  highlight: StockHighlight;
  sort_order: number | null; // 爬虫导入时赋值，保持图片显示顺序；手动创建时为 null
}

// ===== 创建/更新股票的输入类型（不含 id 和 theme_id） =====
export type StockInput = Omit<Stock, 'id' | 'theme_id'>;

// ===== 投资主题（含嵌套股票列表） =====
export interface Theme {
  id: string;
  name: string;
  overview: string;
  created_at: number;          // Unix 时间戳（毫秒）
  updated_at: number;          // 最后更新时间（毫秒），爬虫导入时同步 created_at，手动创建时为当前时间
  sort_order: number | null;   // 前15条主题的排序序号，其余为 null
  title_color: string | null;  // 主题名称颜色（'red' 或 null）
  stocks: Stock[];             // 嵌套股票，来自 themeStocks 表
}

// ===== 创建/更新主题的输入类型 =====
export type ThemeInput = {
  name: string;
  overview: string;
};

// ===== Supabase 原始行（与数据库表结构一致） =====
export interface ThemeRow {
  id: string;
  name: string;
  overview: string;
  created_at: number;
  updated_at: number;
  sort_order: number | null;
  title_color: string | null;
  themeStocks?: StockRow[];
}

export interface StockRow {
  id: string;
  theme_id: string;
  code: string;
  name: string;
  cat1: string;
  cat2: string;
  cat3: string;
  relation: string;
  stars: number;
  highlight: StockHighlight;
  sort_order: number | null;
}

// ===== 每日早报 =====
export type ReportType = 'trading' | 'weekly';

export interface DailyReport {
  id: string;
  report_date: string;      // 'YYYY-MM-DD'
  report_type: ReportType;  // 'trading' | 'weekly'
  content: string;          // 完整报告 Markdown
  summary: string;          // 今日一句话
  created_at: number;       // UTC 毫秒
}

// ===== API 统一响应结构 =====
export interface ApiResponse<T = void> {
  data?: T;
  error?: string;
}

// ===== 仪表盘统计 =====
export interface DashboardStats {
  themeCount: number;
  stockCount: number;
  highlightCount: number;
  avgStars: string;
}
