-- ============================================================
-- 板块预测系统 Phase 1 — 建表 SQL
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. sector_master — 板块主表
CREATE TABLE IF NOT EXISTS "sector_master" (
  "id"             TEXT PRIMARY KEY,
  "name"           TEXT NOT NULL UNIQUE,
  "bk_code"        TEXT,
  "stock_count"    INT,
  "change_pct"     FLOAT,
  "leading_stock"  TEXT,
  "is_active"      BOOLEAN DEFAULT true,
  "created_at"     BIGINT NOT NULL,
  "updated_at"     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sector_master_name ON "sector_master" ("name");
CREATE INDEX IF NOT EXISTS idx_sector_master_bk_code ON "sector_master" ("bk_code");

-- RLS
ALTER TABLE "sector_master" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow read" ON "sector_master" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "sector_master" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "sector_master" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "sector_master" FOR DELETE USING (true);

-- 2. sector_daily — 板块每日快照
CREATE TABLE IF NOT EXISTS "sector_daily" (
  "id"                    TEXT PRIMARY KEY,
  "sector_name"           TEXT NOT NULL,
  "trade_date"            TEXT NOT NULL,
  -- K 线字段
  "open"                  FLOAT,
  "close"                 FLOAT,
  "high"                  FLOAT,
  "low"                   FLOAT,
  "change_pct"            FLOAT,
  "volume"                BIGINT,
  "turnover"              FLOAT,
  "amplitude"             FLOAT,
  "turnover_rate"         FLOAT,
  -- 资金流字段（东财）
  "main_net_inflow"       FLOAT,
  "main_net_inflow_pct"   FLOAT,
  "super_large_net"       FLOAT,
  "large_net"             FLOAT,
  "medium_net"            FLOAT,
  "small_net"             FLOAT,
  "fund_leading_stock"    TEXT,
  "created_at"            BIGINT NOT NULL,

  CONSTRAINT uq_sector_daily UNIQUE ("sector_name", "trade_date")
);

CREATE INDEX IF NOT EXISTS idx_sector_daily_trade_date ON "sector_daily" ("trade_date" DESC);
CREATE INDEX IF NOT EXISTS idx_sector_daily_name_date ON "sector_daily" ("sector_name", "trade_date" DESC);

-- RLS
ALTER TABLE "sector_daily" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow read" ON "sector_daily" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "sector_daily" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "sector_daily" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "sector_daily" FOR DELETE USING (true);
