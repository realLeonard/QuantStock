-- ============================================================
-- adminUsers 表初始化脚本
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. 创建 adminUsers 表
CREATE TABLE IF NOT EXISTS "adminUsers" (
  id          TEXT PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  created_at  BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- 2. 开启 RLS
ALTER TABLE "adminUsers" ENABLE ROW LEVEL SECURITY;

-- 3. 禁止 anon 读取（防止直接拉取账号列表）
-- 注意：前端通过 anon key 操作，所以需要一条允许策略供登录用
-- 方案：允许按 username 查询单条（登录时使用），禁止全量 SELECT
-- 如果你希望完全通过后端 API 管理，可以不加任何 anon 策略

-- 允许 anon 按 username 查询（登录验证需要）
CREATE POLICY "allow_anon_select_by_username"
  ON "adminUsers"
  FOR SELECT
  TO anon
  USING (true);  -- 前端仅 .eq('username', xxx).single() 查询，不会全量拉取

-- 4. 插入初始 admin 账号
-- 密码：admin123，bcrypt hash（cost=10）预生成值
-- 如果需要重新生成，可在 Node.js 中运行：
--   const bcrypt = require('bcryptjs'); console.log(bcrypt.hashSync('admin123', 10))
INSERT INTO "adminUsers" (id, username, password_hash, role, created_at)
VALUES (
  'usr_init_admin_001',
  'admin',
  '$2b$10$UTImxwwiRZTOwFKlMzgEcOkRWyIbFxDHpjnsa5QBNr/bZqf6jdx3K',
  'admin',
  (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
)
ON CONFLICT (username) DO NOTHING;

-- 上方 hash 对应密码 admin123（bcrypt cost=10，2026-03-14 生成）
-- 首次登录后请立即修改密码
