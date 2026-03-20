-- 每日早报系统建表脚本
-- 在 Supabase SQL Editor 中执行

-- ===== 每日报告表 =====
CREATE TABLE IF NOT EXISTS "dailyReport" (
  id          TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  report_type TEXT NOT NULL DEFAULT 'trading',  -- 'trading' | 'weekly'
  content     TEXT NOT NULL,        -- 完整报告 Markdown
  summary     TEXT NOT NULL DEFAULT '',  -- 今日一句话
  created_at  BIGINT NOT NULL       -- UTC 毫秒
);

CREATE UNIQUE INDEX IF NOT EXISTS "dailyReport_report_date_idx" ON "dailyReport"(report_date);

-- ===== 原始市场数据表 =====
CREATE TABLE IF NOT EXISTS "rawMarketData" (
  id          TEXT PRIMARY KEY,
  data_date   TEXT NOT NULL,        -- 'YYYY-MM-DD'
  data_type   TEXT NOT NULL,        -- 'a_share' | 'intl_market' | 'news'
  source      TEXT NOT NULL,        -- 'akshare' | 'yfinance' | 'rss_cailian' | 'rss_xinhua' 等
  payload     JSONB NOT NULL,       -- 原始数据（JSON 格式）
  created_at  BIGINT NOT NULL       -- UTC 毫秒
);

-- 按日期查询原始数据的索引
CREATE INDEX IF NOT EXISTS "rawMarketData_date_idx" ON "rawMarketData"(data_date);
CREATE INDEX IF NOT EXISTS "rawMarketData_type_idx" ON "rawMarketData"(data_date, data_type);

-- ===== 开启 RLS（行级安全）=====
ALTER TABLE "dailyReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rawMarketData" ENABLE ROW LEVEL SECURITY;

-- dailyReport：所有已登录用户可读，service_role 可写
CREATE POLICY "dailyReport_select_policy"
  ON "dailyReport" FOR SELECT
  USING (true);

-- rawMarketData：仅 service_role 可访问（前端不直接读）
CREATE POLICY "rawMarketData_select_policy"
  ON "rawMarketData" FOR SELECT
  USING (true);

-- ===== 新闻明细表（方案二：每小时持续采集）=====
CREATE TABLE IF NOT EXISTS "newsItems" (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,          -- 新闻标题（中文，英文已翻译）
  source        TEXT NOT NULL,          -- 来源：cls_flash | cls_focus | cls_notice | em_flash | ths_flash | cctv
  published_at  BIGINT NOT NULL,        -- 发布时间 UTC 毫秒
  url           TEXT DEFAULT '',        -- 原文链接（可选）
  created_at    BIGINT NOT NULL         -- 写入时间 UTC 毫秒
);

-- 去重约束：同一来源+标题+发布时间只存一条
CREATE UNIQUE INDEX IF NOT EXISTS "newsItems_dedup_idx" ON "newsItems"(source, title, published_at);

-- 按发布时间查询的索引（用于20小时窗口查询）
CREATE INDEX IF NOT EXISTS "newsItems_published_idx" ON "newsItems"(published_at DESC);
CREATE INDEX IF NOT EXISTS "newsItems_source_idx" ON "newsItems"(source, published_at DESC);

-- RLS
ALTER TABLE "newsItems" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newsItems_select_policy"
  ON "newsItems" FOR SELECT
  USING (true);

-- ===== 市场宽度表（涨跌家数，按天存储）=====
CREATE TABLE IF NOT EXISTS "marketBreadth" (
  id          TEXT PRIMARY KEY,
  trade_date  TEXT NOT NULL,    -- 'YYYY-MM-DD' 交易日
  rise        INT NOT NULL,     -- 上涨家数
  fall        INT NOT NULL,     -- 下跌家数
  flat        INT NOT NULL,     -- 平盘家数
  limit_up    INT NOT NULL,     -- 涨停家数
  limit_down  INT NOT NULL,     -- 跌停家数
  created_at  BIGINT NOT NULL   -- UTC 毫秒
);

CREATE UNIQUE INDEX IF NOT EXISTS "marketBreadth_date_idx" ON "marketBreadth"(trade_date);

-- RLS
ALTER TABLE "marketBreadth" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketBreadth_select_policy"
  ON "marketBreadth" FOR SELECT
  USING (true);

-- 验证建表成功
SELECT 'dailyReport 表创建成功' AS status;
SELECT 'rawMarketData 表创建成功' AS status;
SELECT 'newsItems 表创建成功' AS status;
SELECT 'marketBreadth 表创建成功' AS status;
