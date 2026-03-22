-- =====================================================
-- 股票代码表（stockCodes）
-- 存储全市场 A 股基础信息，含交易所与板块分类
-- =====================================================

CREATE TABLE IF NOT EXISTS "stockCodes" (
  code        TEXT PRIMARY KEY,          -- 股票代码（6位，如 600519）
  name        TEXT NOT NULL,             -- 股票名称（如 贵州茅台）
  exchange    TEXT NOT NULL,             -- 交易所：SH / SZ / BJ
  board       TEXT NOT NULL,             -- 板块：主板 / 创业板 / 科创板 / 北交所
  created_at  BIGINT NOT NULL            -- 写入时间（UTC 毫秒）
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_stock_codes_exchange ON "stockCodes" (exchange);
CREATE INDEX IF NOT EXISTS idx_stock_codes_board    ON "stockCodes" (board);
CREATE INDEX IF NOT EXISTS idx_stock_codes_name     ON "stockCodes" (name);

-- RLS（仅允许读，写入由服务端脚本操作）
ALTER TABLE "stockCodes" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "允许匿名读取股票代码表"
  ON "stockCodes"
  FOR SELECT
  TO anon
  USING (true);
