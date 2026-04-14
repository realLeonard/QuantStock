-- ============================================================
-- 每日复盘 v2 新增数据表
-- 执行位置：Supabase SQL Editor
-- 文档：docs/daily-review-v2-spec.md
-- ============================================================

-- ----------------------------------------------------
-- 1. 韭研涨停原因（每日一条）
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "limitUpReasons" (
  id TEXT PRIMARY KEY,
  pick_date TEXT NOT NULL UNIQUE,            -- 'YYYY-MM-DD'
  themes JSONB NOT NULL DEFAULT '[]',        -- 题材聚类结构，见 spec 4.1
  raw_image_url TEXT,                        -- 源图片 URL
  source TEXT DEFAULT 'jiuyan',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_limit_up_reasons_date
  ON "limitUpReasons" (pick_date DESC);

ALTER TABLE "limitUpReasons" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow read" ON "limitUpReasons" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "limitUpReasons" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "limitUpReasons" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "limitUpReasons" FOR DELETE USING (true);


-- ----------------------------------------------------
-- 2. 一线游资营业部字典
-- ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "hotMoneySeats" (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,                    -- 孙哥 / 章盟主 / 方新侠 ...
  seat_name TEXT NOT NULL,                   -- 营业部全称
  aliases TEXT[] DEFAULT '{}',               -- 别名数组（模糊匹配）
  tier INT NOT NULL DEFAULT 1,               -- 1 一线 / 2 二线 / 3 三线
  description TEXT,                          -- 风格、擅长方向
  active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hot_money_seats_active
  ON "hotMoneySeats" (active, tier);

ALTER TABLE "hotMoneySeats" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow read" ON "hotMoneySeats" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "hotMoneySeats" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "hotMoneySeats" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "hotMoneySeats" FOR DELETE USING (true);
