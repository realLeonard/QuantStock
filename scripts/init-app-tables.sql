-- ============================================================
-- QuantStock App 端数据库表初始化脚本
-- 执行环境：Supabase SQL Editor
-- 执行时间：2026-03-31
-- ============================================================

-- ============================================================
-- 1. appUsers 表（C 端用户业务数据）
-- ============================================================
CREATE TABLE IF NOT EXISTS "appUsers" (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_id           UUID UNIQUE NOT NULL,        -- 关联 Supabase Auth UID
  nickname          TEXT,
  avatar_url        TEXT,
  phone             TEXT,
  wechat_openid     TEXT UNIQUE,                -- 微信一键登录 OpenID
  plan_type         TEXT NOT NULL DEFAULT 'free'
                    CHECK (plan_type IN ('free', 'trial', 'monthly', 'quarterly', 'yearly')),
  plan_expired_at   BIGINT,                     -- 会员到期时间（UTC ms），NULL=永久或免费
  last_login_at     BIGINT,                     -- 最后登录时间（每次进 App 更新）
  created_at        BIGINT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_appusers_auth_id ON "appUsers" (auth_id);
CREATE INDEX IF NOT EXISTS idx_appusers_plan_type ON "appUsers" (plan_type);
CREATE INDEX IF NOT EXISTS idx_appusers_phone ON "appUsers" (phone);

-- RLS 策略
ALTER TABLE "appUsers" ENABLE ROW LEVEL SECURITY;

-- 读取：已登录用户只能读自己的记录
CREATE POLICY "appUsers_select" ON "appUsers"
  FOR SELECT USING (auth.uid()::text = auth_id::text);

-- 写入：任何人可以创建（注册时通过 anon key 写入）
CREATE POLICY "appUsers_insert" ON "appUsers"
  FOR INSERT WITH CHECK (true);

-- 修改：只能改自己的记录
CREATE POLICY "appUsers_update" ON "appUsers"
  FOR UPDATE USING (auth.uid()::text = auth_id::text);

-- ============================================================
-- 2. userEvents 表（用户行为统计）
-- ============================================================
CREATE TABLE IF NOT EXISTS "userEvents" (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT,                            -- appUsers.id，未登录为 NULL
  event_type   TEXT NOT NULL,                  -- view_report / pay_success / register 等
  target_id    TEXT,                           -- 关联内容 ID（如 report_date）
  duration_ms  INTEGER,                        -- 停留时长（毫秒）
  platform     TEXT,                          -- miniprogram / android / ios / h5
  created_at   BIGINT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_userevents_user_id ON "userEvents" (user_id);
CREATE INDEX IF NOT EXISTS idx_userevents_event_type ON "userEvents" (event_type);
CREATE INDEX IF NOT EXISTS idx_userevents_created_at ON "userEvents" (created_at);

-- RLS 策略
ALTER TABLE "userEvents" ENABLE ROW LEVEL SECURITY;

-- 读取：不允许客户端读取（仅服务端/管理后台）
-- CREATE POLICY "userEvents_select" ON "userEvents" FOR SELECT USING (false);

-- 写入：任何人可以写入（事件上报，含未登录用户）
CREATE POLICY "userEvents_insert" ON "userEvents"
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 3. userFeedback 表（用户在线反馈）
-- ============================================================
CREATE TABLE IF NOT EXISTS "userFeedback" (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT,                              -- 可为 NULL（未登录也能提交）
  content    TEXT NOT NULL,
  contact    TEXT,                             -- 用户留的联系方式（可选）
  platform   TEXT,
  created_at BIGINT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_userfeedback_created_at ON "userFeedback" (created_at);

-- RLS 策略
ALTER TABLE "userFeedback" ENABLE ROW LEVEL SECURITY;

-- 写入：任何人可以提交反馈
CREATE POLICY "userFeedback_insert" ON "userFeedback"
  FOR INSERT WITH CHECK (true);

-- 读取：不允许客户端读取
-- CREATE POLICY "userFeedback_select" ON "userFeedback" FOR SELECT USING (false);

-- ============================================================
-- 4. appConfig 表（App 版本控制、公告等配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS "appConfig" (
  key        TEXT PRIMARY KEY,                 -- min_version / announcement 等
  value      TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- RLS 策略
ALTER TABLE "appConfig" ENABLE ROW LEVEL SECURITY;

-- 读取：所有人可读配置（anon key 即可）
CREATE POLICY "appConfig_select" ON "appConfig"
  FOR SELECT USING (true);

-- 写入：禁止客户端写入（只通过 Supabase SQL Editor 维护）
-- （不创建 insert/update policy 即默认禁止）

-- ============================================================
-- 5. 初始化 appConfig 数据
-- ============================================================
INSERT INTO "appConfig" (key, value, updated_at) VALUES
  ('min_version', '1.0.0', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000),
  ('announcement', '', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 验证
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('appUsers', 'userEvents', 'userFeedback', 'appConfig');
