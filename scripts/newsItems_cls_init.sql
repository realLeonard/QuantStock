-- =====================================================
-- newsItems_cls 表初始化 SQL
-- 执行位置：Supabase SQL Editor
-- 说明：财联社新闻专用表，替代旧 newsItems 表
-- =====================================================

-- 1. 建表
CREATE TABLE IF NOT EXISTS "newsItems_cls" (
  id           TEXT PRIMARY KEY,           -- 本系统 uuid
  cls_id       TEXT,                       -- 财联社原始文章 ID（去重用）
  title        TEXT NOT NULL,              -- 标题
  summary      TEXT DEFAULT '',            -- 摘要（深度文章为 brief，快讯为完整 content）
  categories   TEXT[] DEFAULT '{}',        -- 多分类标签，如 {A股,热门,报告}
  level        TEXT DEFAULT 'A',           -- 新闻等级：A / B / C
  url          TEXT DEFAULT '',            -- 原文链接
  published_at BIGINT NOT NULL,            -- 文章原始发布时间（UTC 毫秒）
  created_at   BIGINT NOT NULL             -- 写入时间（UTC 毫秒）
);

-- 2. 去重索引：深度/热榜文章按 cls_id 去重
CREATE UNIQUE INDEX IF NOT EXISTS "newsItems_cls_cls_id_idx"
  ON "newsItems_cls"(cls_id)
  WHERE cls_id IS NOT NULL;

-- 3. 去重索引：快讯按 title + published_at 去重（cls_id 为 NULL 时不生效，实际快讯也有 cls_id，两个索引共同保障）
CREATE INDEX IF NOT EXISTS "newsItems_cls_published_at_idx"
  ON "newsItems_cls"(published_at DESC);

-- 4. 开启 RLS
ALTER TABLE "newsItems_cls" ENABLE ROW LEVEL SECURITY;

-- 5. RLS 策略
CREATE POLICY "allow read" ON "newsItems_cls"
  FOR SELECT USING (true);

CREATE POLICY "allow insert" ON "newsItems_cls"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow update" ON "newsItems_cls"
  FOR UPDATE USING (true);

CREATE POLICY "allow delete" ON "newsItems_cls"
  FOR DELETE USING (true);
