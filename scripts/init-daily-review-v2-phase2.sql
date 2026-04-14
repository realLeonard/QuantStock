-- ============================================================
-- 每日复盘 v2 Phase 2 DB 字段扩展
-- 执行位置：Supabase SQL Editor
-- ============================================================

-- 1. dailyReview 新增 filtered_news 字段（资讯预筛结果，AI 输入）
ALTER TABLE "dailyReview"
  ADD COLUMN IF NOT EXISTS filtered_news JSONB DEFAULT '[]'::jsonb;

-- 2. dailyReview 新增 hot_money_moves 字段（游资席位匹配结果）
ALTER TABLE "dailyReview"
  ADD COLUMN IF NOT EXISTS hot_money_moves JSONB DEFAULT '[]'::jsonb;

-- 验证
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dailyReview'
  AND column_name IN ('filtered_news', 'hot_money_moves');
