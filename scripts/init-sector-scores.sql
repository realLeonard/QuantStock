-- ============================================================
-- sector_scores 表扩展 + sector_rotation_map 新建
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 1. 扩展 sector_scores：新增 6 维评分 + 市场环境 + 生命周期 + 复盘字段
--    （如果表已存在，用 ALTER TABLE 追加字段）

ALTER TABLE sector_scores
  ADD COLUMN IF NOT EXISTS policy_score REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotation_score REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leader_bonus REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS policy_detail JSONB,
  ADD COLUMN IF NOT EXISTS rotation_detail JSONB,
  ADD COLUMN IF NOT EXISTS leader_detail JSONB,
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS confidence REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_reason TEXT,
  ADD COLUMN IF NOT EXISTS market_env TEXT,
  ADD COLUMN IF NOT EXISTS next_day_actual REAL,
  ADD COLUMN IF NOT EXISTS prediction_hit BOOLEAN;

-- 修改 signal 字段注释（新增 risk 信号）
COMMENT ON COLUMN sector_scores.signal IS 'strong_buy / buy / watch / avoid / risk';
COMMENT ON COLUMN sector_scores.stage IS '萌芽 / 发酵 / 主升 / 分歧 / 退潮';
COMMENT ON COLUMN sector_scores.market_env IS 'strong / neutral / weak / extreme';
COMMENT ON COLUMN sector_scores.confidence IS '置信度 0-1';

-- ============================================================
-- 2. 新建 sector_rotation_map 板块关联图谱
-- ============================================================

CREATE TABLE IF NOT EXISTS sector_rotation_map (
  id TEXT PRIMARY KEY,
  source_sector TEXT NOT NULL,
  target_sector TEXT NOT NULL,
  relation_type TEXT DEFAULT 'chain',  -- chain(产业链) / corr(相关性)
  weight REAL DEFAULT 1.0,
  description TEXT,
  UNIQUE(source_sector, target_sector)
);

-- RLS
ALTER TABLE sector_rotation_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow read" ON sector_rotation_map
  FOR SELECT USING (true);
CREATE POLICY "allow insert" ON sector_rotation_map
  FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON sector_rotation_map
  FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON sector_rotation_map
  FOR DELETE USING (true);

-- ============================================================
-- 3. 初始化产业链图谱数据
-- ============================================================

INSERT INTO sector_rotation_map (id, source_sector, target_sector, relation_type, weight, description) VALUES
  -- AI 产业链
  (gen_random_uuid()::text, 'AI算力', '光模块', 'chain', 1.0, 'AI算力需求→光模块出货'),
  (gen_random_uuid()::text, '光模块', 'PCB', 'chain', 0.8, '光模块量产→PCB需求'),
  (gen_random_uuid()::text, 'PCB', '服务器', 'chain', 0.7, 'PCB→服务器组装'),
  (gen_random_uuid()::text, 'CPO概念', '光模块', 'chain', 0.9, 'CPO封装→光模块升级'),
  (gen_random_uuid()::text, '人工智能', 'AI应用', 'chain', 0.8, 'AI基础设施→应用层'),
  -- 新能源车产业链
  (gen_random_uuid()::text, '新能源汽车', '锂电池', 'chain', 1.0, '整车→电池'),
  (gen_random_uuid()::text, '锂电池', '锂矿', 'chain', 0.8, '电池→锂矿资源'),
  (gen_random_uuid()::text, '新能源汽车', '汽车零部件', 'chain', 0.9, '整车→零部件'),
  (gen_random_uuid()::text, '新能源汽车', '充电桩', 'chain', 0.7, '电车普及→充电基础设施'),
  -- 光伏储能链
  (gen_random_uuid()::text, '光伏概念', '储能', 'chain', 1.0, '光伏发电→储能配套'),
  (gen_random_uuid()::text, '储能', '电力', 'chain', 0.8, '储能→电力调度'),
  (gen_random_uuid()::text, '光伏概念', '逆变器', 'chain', 0.9, '光伏→逆变器'),
  -- 机器人产业链
  (gen_random_uuid()::text, '机器人概念', '减速器', 'chain', 1.0, '机器人→核心部件'),
  (gen_random_uuid()::text, '机器人概念', '传感器', 'chain', 0.9, '机器人→感知层'),
  (gen_random_uuid()::text, '机器人概念', '工业母机', 'chain', 0.7, '机器人→精密加工'),
  -- 半导体产业链
  (gen_random_uuid()::text, '半导体', '芯片', 'chain', 1.0, '半导体制造→芯片设计'),
  (gen_random_uuid()::text, '半导体', 'EDA概念', 'chain', 0.9, '半导体→EDA工具'),
  (gen_random_uuid()::text, '芯片', '消费电子', 'chain', 0.7, '芯片→终端产品'),
  -- 军工航天链
  (gen_random_uuid()::text, '军工', '航天航空', 'chain', 1.0, '军工→航天装备'),
  (gen_random_uuid()::text, '航天航空', '卫星互联网', 'chain', 0.9, '航天→卫星通信'),
  (gen_random_uuid()::text, '航天航空', '北斗导航', 'chain', 0.8, '航天→导航系统'),
  (gen_random_uuid()::text, '军工', '船舶制造', 'chain', 0.8, '军工→海军装备'),
  -- 医药链
  (gen_random_uuid()::text, '创新药', 'CRO', 'chain', 0.9, '创新药研发→CRO外包'),
  (gen_random_uuid()::text, '创新药', '医疗器械概念', 'chain', 0.7, '创新药→配套器械')
ON CONFLICT (source_sector, target_sector) DO NOTHING;
