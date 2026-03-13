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
}

// ===== 创建/更新股票的输入类型（不含 id 和 theme_id） =====
export type StockInput = Omit<Stock, 'id' | 'theme_id'>;

// ===== 投资主题（含嵌套股票列表） =====
export interface Theme {
  id: string;
  name: string;
  overview: string;
  created_at: number;   // Unix 时间戳（毫秒）
  stocks: Stock[];      // 嵌套股票，来自 themeStocks 表
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
