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

// ===== 市场涨跌家数 =====
export interface MarketBreadth {
  id: string;
  trade_date: string;   // 'YYYY-MM-DD'
  rise: number;
  fall: number;
  flat: number;
  limit_up: number;
  limit_down: number;
  created_at: number;
}

// ===== App 端用户（C 端，区别于后台 AdminUser） =====
export type PlanType = 'free' | 'trial' | 'monthly' | 'quarterly' | 'yearly';

export interface AppUser {
  id: string;
  auth_id: string;          // 关联 Supabase Auth UID
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  wechat_openid: string | null;
  plan_type: PlanType;
  plan_expired_at: number | null; // UTC 毫秒，null=永久或免费
  last_login_at: number | null;
  created_at: number;             // UTC 毫秒
}

// ===== 用户行为事件 =====
export interface UserEvent {
  id: string;
  user_id: string | null;
  event_type: string;
  target_id: string | null;
  duration_ms: number | null;
  platform: string | null;
  created_at: number;
}

// ===== 用户反馈 =====
export interface UserFeedback {
  id: string;
  user_id: string | null;
  content: string;
  contact: string | null;
  platform: string | null;
  created_at: number;
}

// ===== App 版本管理 =====
export interface AppVersionControl {
  id: string;
  version: string;
  is_force_update: boolean;
  value_desc: string;
  created_at: number;
}

// ===== App 全局配置 =====
export interface AppConfig {
  key: string;
  value: string;
  updated_at: number;
}

// ===== AI 结构化分析 =====
export interface AiAnalysisMainTheme {
  name: string;                // "CPO/光模块"
  strength: '强' | '中' | '弱';
  logic: string;               // 逻辑解读
  leader_stocks: string[];     // 龙头股
  related_data: string;        // 关联数据
  continuation: string;        // 持续性判断
}

export interface AiAnalysisSignal {
  type: string;                // "机构抢筹" | "游资接力" | "主力撤退" | "新题材" | "风险"
  content: string;
}

export interface AiAnalysisOutlook {
  direction: '偏多' | '中性' | '偏空';
  focus_areas: string[];       // 关注方向
  risk_warnings: string[];     // 风险提示
}

export interface AiAnalysis {
  headline: string;            // 一句话结论
  sentiment_stage: string;     // "升温" | "高潮" | "退潮" | "冰点" | "修复"
  sentiment_score: number;     // 1-10 情绪温度
  main_themes: AiAnalysisMainTheme[];
  signals: AiAnalysisSignal[];
  outlook: AiAnalysisOutlook;
  full_text: string;           // 完整文字版（供推送）
  // v2 兼容字段（v2 分析会带 version='v2'，此时可转为 AiAnalysisV2）
  version?: 'v2';
}

// ===== AI v2 结构化分析（spec 6.2）=====
export interface AiAnalysisV2Sentiment {
  score: number;
  stage: string;               // 升温/分歧/高潮/退潮/冰点/修复
  width_conclusion: string;
  ladder_conclusion: string;
  profit_conclusion: string;
  style_conclusion: string;
  summary: string;
}

export interface AiAnalysisV2FundPicture {
  dashboard_conclusion: string;
  migration: string;
  inst_summary: string;
  hot_money_summary: string;
  margin_summary?: string;          // 两融解读（融资余额 + 杠杆资金动向）
}

// 两融数据（dailyReview.margin_data）
export interface MarginData {
  trade_date: string;                // 'YYYY-MM-DD'（数据发布日，T-1）
  sse_balance: number | null;        // 沪市融资余额（亿）
  szse_balance: number | null;       // 深市融资余额（亿）
  total_balance: number | null;      // 两市合计（亿）
  daily_change: number | null;       // 日变化（亿）
  change_5d: number[];               // 近5日变化（亿）
  consecutive_days: number;          // 连续净增(+)或净减(-)天数
  balance_percentile_1y: number | null;  // 1年历史分位（0-100）
}

export interface AiAnalysisV2ImportantNews {
  segment: 'pre_market' | 'intraday' | 'post_market';
  time: string;                // HH:MM
  headline: string;
  summary: string;
  driven: string[];
  level: string;               // A/B
}

export interface AiAnalysisV2NextDaySignals {
  label: string;               // 延续概率高/分歧加剧/退潮概率高/信号不足
  evidence: string[];
  suggestion: string;
}

export interface AiAnalysisV2MainTheme {
  name: string;
  strength: string;            // 强/中/弱
  stage: string;               // 启动/主升D2/主升D3/分歧/退潮
  days: number;
  leader_ladder: string;
  catalyst: string;
  today_performance: string;
  divergence_signals: string[];
  next_day_signals: AiAnalysisV2NextDaySignals;
}

export interface AiAnalysisV2LadderView {
  height: string;
  promotion: string;
  broken: string;
  new_promotions: string;
}

export interface AiAnalysisV2RiskAlert {
  type: string;
  content: string;
}

export interface AiAnalysisV2BattlePlan {
  position_level: string;
  mode: string;
  focus_stocks: string[];
  avoid_list: string[];
  key_observations: string[];
}

export interface AiAnalysisV2YesterdayVerify {
  summary: string;
  hit_items: string[];
  miss_items: string[];
}

export interface AiAnalysisV2 {
  version: 'v2';
  headline: string;
  sentiment: AiAnalysisV2Sentiment;
  fund_picture: AiAnalysisV2FundPicture;
  important_news: AiAnalysisV2ImportantNews[];
  main_themes: AiAnalysisV2MainTheme[];
  ladder_view: AiAnalysisV2LadderView;
  risk_alerts: AiAnalysisV2RiskAlert[];
  battle_plan: AiAnalysisV2BattlePlan;
  yesterday_verify: AiAnalysisV2YesterdayVerify;
}

// ===== 游资席位匹配动向（v2 新增）=====
export interface HotMoneyMove {
  nickname: string;            // 孙哥 / 章盟主 ...
  tier: number;
  stock_code: string;
  stock_name: string;
  direction: 'buy' | 'sell';
  amount: number;
}

// ===== 资讯预筛项（v2 新增，AI 输入）=====
export interface FilteredNewsItem {
  cls_id: string | null;
  title: string;
  summary: string;
  level: string;
  url: string;
  published_at: number;
  published_bj: string;
  segment: 'pre_market' | 'intraday' | 'post_market';
}

// ===== 每日复盘 =====
export interface DailyReview {
  id: string;
  report_date: string;                        // 'YYYY-MM-DD'
  market_overview: Record<string, unknown> | null;
  market_sentiment: Record<string, unknown> | null;
  hot_stocks: Record<string, unknown>[] | null;
  limit_up_ladder: Record<string, unknown>[] | null;
  dragon_tiger: Record<string, unknown>[] | null;
  industry_distribution: Record<string, unknown>[] | null;
  limit_industry_distribution: Record<string, unknown>[] | null;
  sector_fund_flow: Record<string, unknown> | null;
  stock_fund_flow: Record<string, unknown> | null;
  ths_hot_stocks: Record<string, unknown>[] | null;
  ths_hot_concepts: Record<string, unknown>[] | null;
  ths_hot_industries: Record<string, unknown>[] | null;
  limit_analysis: Record<string, unknown> | null;
  ai_summary: string | null;
  ai_analysis: AiAnalysis | AiAnalysisV2 | null;
  filtered_news?: FilteredNewsItem[] | null;   // v2 新增：资讯预筛
  hot_money_moves?: HotMoneyMove[] | null;     // v2 新增：游资动向
  margin_data?: MarginData | null;             // v2 新增：两融数据
  status: string;                             // success / partial / failed
  created_at: number;                         // UTC 毫秒
}

// ===== 韭研公社涨停原因「今日异动」=====
export interface LimitUpReasonStock {
  board: string;                  // 板数文案："首板" / "5天4板" / "4连板" 等
  code: string;                   // 6位代码
  name: string;                   // 个股名
  time: string;                   // 涨停时间 HH:MM
  float_mv: number | null;        // 流通市值（亿元）
  turnover_amt: number | null;    // 成交额（亿元）
  keyword: string;                // 涨停关键词（个股独立）
}
export interface LimitUpReasonTheme {
  name: string;              // 板块名（如 "算力"）
  count: number;             // 板块涨停数（如 "算力*11" 的 11）
  stocks: LimitUpReasonStock[];
}
export interface LimitUpReasons {
  id: string;
  pick_date: string;         // 'YYYY-MM-DD'
  themes: LimitUpReasonTheme[];
  raw_image_url: string | null;
  source: string;            // 'jiuyan'
  created_at: number;
}

// ===== 近期思路和方向（单条记录，id='singleton'）=====
export interface RecentInsights {
  id: string;
  thoughts: string;
  focus_direction: string;
  updated_at: number;
}

// ===== 每日掘金板块个股 =====
export interface GoldStock {
  code: string;
  name: string;
  comment?: string;
}
export interface GoldSector {
  name: string;
  stocks: GoldStock[];
}
export interface DailyGoldPick {
  id: string;
  pick_date: string;           // 'YYYY-MM-DD'
  sectors: GoldSector[];
  source_type: 'auto' | 'manual';
  created_at: number;
  updated_at: number;
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
