-- ============================================================================
-- P0 安全改造·阶段 D：RLS 全面收紧（anon 零权限）
-- 执行前提（缺一不可）：
--   1. 阶段 A/B/C 已全部部署：Web/移动端数据操作已收口到 Hono API（service key）
--   2. 所有采集脚本/workflow 已切 SUPABASE_SERVICE_KEY
--   3. 在采集空窗时段执行（避开 GitHub Actions cron 运行窗口）
-- 执行方式：Supabase Dashboard → SQL Editor 整段执行
-- 效果：所有表开启 RLS 且无任何 policy → anon/authenticated 完全无法读写；
--       service_role（Hono API、采集脚本）天然绕过 RLS，不受影响
-- 回滚：见文件底部注释掉的回滚段（分钟级恢复）
-- ============================================================================

-- 第 1 步：动态删除 public schema 下所有表的全部 policy（不怕漏、幂等）
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname, pol.schemaname, pol.tablename
    );
  END LOOP;
END $$;

-- 第 2 步：对全部 28 张表开启 RLS（幂等；含 4 张小写遗留表）
ALTER TABLE IF EXISTS "adminUsers"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "appConfig"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "appUsers"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "appVersionControl" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "appconfig"         ENABLE ROW LEVEL SECURITY; -- 遗留小写表
ALTER TABLE IF EXISTS "appusers"          ENABLE ROW LEVEL SECURITY; -- 遗留小写表
ALTER TABLE IF EXISTS "dailyGoldPicks"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "dailyReport"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "dailyReview"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "hotMoneySeats"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "limitUpReasons"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "marketBreadth"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "newsItems"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "newsItems_cls"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "rawMarketData"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "recentInsights"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sector_daily"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sector_master"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sector_rotation_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "sector_scores"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "stockCodes"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "subscriptionOrders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "themeConcept"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "themeStocks"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "userEvents"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "userFeedback"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "userevents"        ENABLE ROW LEVEL SECURITY; -- 遗留小写表
ALTER TABLE IF EXISTS "userfeedback"      ENABLE ROW LEVEL SECURITY; -- 遗留小写表

-- 第 3 步：验证（执行后应返回 0 行 policy、28 行 rls_enabled=true）
SELECT count(*) AS remaining_policies FROM pg_policies WHERE schemaname = 'public';
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================================
-- 回滚段（紧急恢复用；平时保持注释）
-- 恢复旧的「anon 全开」策略——仅在 Hono 链路故障、需临时回到直连模式时执行。
-- 恢复后前端旧版本（直连 Supabase 的构建）可重新工作。
-- ============================================================================
-- DO $$
-- DECLARE
--   t TEXT;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'adminUsers','appConfig','appUsers','appVersionControl',
--     'dailyGoldPicks','dailyReport','dailyReview','hotMoneySeats',
--     'limitUpReasons','marketBreadth','newsItems','newsItems_cls',
--     'rawMarketData','recentInsights','sector_daily','sector_master',
--     'sector_rotation_map','sector_scores','stockCodes','subscriptionOrders',
--     'themeConcept','themeStocks','userEvents','userFeedback'
--   ]
--   LOOP
--     EXECUTE format('CREATE POLICY "allow read"   ON %I FOR SELECT USING (true)', t);
--     EXECUTE format('CREATE POLICY "allow insert" ON %I FOR INSERT WITH CHECK (true)', t);
--     EXECUTE format('CREATE POLICY "allow update" ON %I FOR UPDATE USING (true)', t);
--     EXECUTE format('CREATE POLICY "allow delete" ON %I FOR DELETE USING (true)', t);
--   END LOOP;
-- END $$;
