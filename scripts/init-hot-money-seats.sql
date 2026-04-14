-- ============================================================
-- 一线游资营业部字典初始化
-- 执行位置：Supabase SQL Editor
-- 前置：已执行 scripts/init-daily-review-v2.sql（建表）
-- ============================================================

-- 可重复执行：用 ON CONFLICT (id) 幂等
-- 别名（aliases）用于在 dragon_tiger 席位名模糊匹配

INSERT INTO "hotMoneySeats" (id, nickname, seat_name, aliases, tier, description, active, created_at)
VALUES
  -- ===== 一线游资（tier=1，20 席） =====
  ('seat_sunge',       '孙哥',       '中信证券股份有限公司上海溧阳路证券营业部',
   ARRAY['溧阳路','中信溧阳路','孙国栋'], 1,
   '超短猛庄，低吸高抛见长，常与章盟主同向', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_zhangmengzhu','章盟主',     '中信证券股份有限公司杭州延安路证券营业部',
   ARRAY['杭州延安路','中信杭州延安路'], 1,
   '赛道龙头擅长者，擅长人气股接力', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_fangxinxia',  '方新侠',     '东方财富证券股份有限公司拉萨东环路第二证券营业部',
   ARRAY['拉萨东环路第二','东财拉萨东环路2'], 1,
   '空间板核按钮，擅长高标打板', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_zuoshouxinyi','作手新一',   '东方财富证券股份有限公司拉萨团结路第二证券营业部',
   ARRAY['拉萨团结路第二','东财拉萨团结路2'], 1,
   '短线题材龙头终结者', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_chaoguyangjia','炒股养家','东方财富证券股份有限公司拉萨东环路第一证券营业部',
   ARRAY['拉萨东环路第一','东财拉萨东环路1'], 1,
   '人气之王，短线节奏感强', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_zhaolaoge',   '赵老哥',     '中国银河证券股份有限公司绍兴证券营业部',
   ARRAY['银河绍兴','绍兴营业部'], 1,
   '情绪周期大师，擅长龙一龙二接力', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_xiaoeyu',     '小鳄鱼',     '国泰君安证券股份有限公司南京太平南路证券营业部',
   ARRAY['国君南京太平南路','南京太平南路'], 1,
   '南京帮核心，首板打板手', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_qiaobangzhu', '乔帮主',     '国泰君安证券股份有限公司上海江苏路证券营业部',
   ARRAY['国君上海江苏路','江苏路'], 1,
   '老牌大佬，低位埋伏类强势', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_siling',      '司令',       '华鑫证券有限责任公司上海分公司',
   ARRAY['华鑫上海分公司','华鑫上分','华鑫'], 1,
   '量化特征明显，换手率极高', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_fenge',       '粉葛',       '国泰君安证券股份有限公司成都北一环路第二证券营业部',
   ARRAY['国君成都北一环第二','成都北一环'], 1,
   '擅长接力强势股', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_qiniu',       '骑牛',       '中信建投证券股份有限公司北京东直门南大街证券营业部',
   ARRAY['中信建投北京东直门','东直门南大街'], 1,
   '北京帮，关注次新股和一二线龙头', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_lianghua1',   '量化1号',   '国泰君安证券股份有限公司顺德大良证券营业部',
   ARRAY['国君顺德大良','顺德大良'], 1,
   '量化席位，龙头股打板常见', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_ningboangel', '宁波敢死队','中国中金财富证券有限公司宁波桑田路证券营业部',
   ARRAY['中金财富宁波桑田路','宁波桑田路','宁波解放南路'], 1,
   '宁波帮核心，高抛低吸犀利', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_gewd',        '葛卫东',     '中泰证券股份有限公司上海浦东新区世纪大道证券营业部',
   ARRAY['中泰上海世纪大道','葛老'], 1,
   '混沌天成实控人席位，中线大资金', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_joyhouse',    '欢乐海岸',   '中信证券股份有限公司北京北三环中路证券营业部',
   ARRAY['中信北京北三环','北三环中路'], 1,
   '北京欢乐海岸，中线白马+短线并行', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_jidanning',   '纪淡宁',     '中国中金财富证券有限公司上海分公司',
   ARRAY['中金财富上海分公司','中金财富上分'], 1,
   '擅长中军接力和连板高度', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_ruihexian',   '瑞鹤仙',     '东方财富证券股份有限公司拉萨东环路第二证券营业部',
   ARRAY['拉萨东环路第二-瑞鹤仙'], 1,
   '与方新侠共用席位，高标打板手', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_beijingbang', '北京帮',     '方正证券股份有限公司北京阜外大街证券营业部',
   ARRAY['方正北京阜外大街','阜外大街'], 1,
   '北京帮聚集席位，常与骑牛同向', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_chenxiaoqun', '陈小群',     '国金证券股份有限公司上海互联网证券分公司',
   ARRAY['国金上海互联网','国金互联网'], 1,
   '敢死队新生代，高位博弈大师', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_fucaige',     '福才哥',     '招商证券股份有限公司上海江苏路证券营业部',
   ARRAY['招商上海江苏路'], 1,
   '题材龙头接力手', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  -- ===== 二线游资（tier=2，10 席） =====
  ('seat_xuxiaofeng',  '徐晓峰',     '华泰证券股份有限公司厦门厦禾路证券营业部',
   ARRAY['华泰厦门厦禾路'], 2,
   '闽系游资代表', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_swhy_sh',     '申万宏源上海', '申万宏源证券有限公司上海闵行区东川路证券营业部',
   ARRAY['申万宏源东川路','上海闵行东川路'], 2,
   '中短线席位，偶有大单', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_guojun_tibet','国君拉萨帮', '国泰君安证券股份有限公司拉萨金融城环路证券营业部',
   ARRAY['国君拉萨金融城环','国君拉萨'], 2,
   '拉萨游资集中席位', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_donghai',     '东海帮',     '东海证券股份有限公司常州延陵西路证券营业部',
   ARRAY['东海常州延陵西路'], 2,
   '常州帮代表', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_cicc_sh',     '中金上海',   '中国国际金融股份有限公司上海分公司',
   ARRAY['中金上海分公司','中金上分'], 2,
   '量化/机构混杂席位', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_fangzheng_sh','方正上海',   '方正证券股份有限公司上海杨高南路证券营业部',
   ARRAY['方正上海杨高南路'], 2,
   '中短线席位', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_galaxy_sh',   '银河上海',   '中国银河证券股份有限公司上海浦东大道证券营业部',
   ARRAY['银河浦东大道','银河上海浦东大道'], 2,
   '浦东帮代表', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_htsc_nj',     '华泰南京',   '华泰证券股份有限公司南京中央路证券营业部',
   ARRAY['华泰南京中央路'], 2,
   '南京二线游资', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_gtja_sz',     '国君深圳',   '国泰君安证券股份有限公司深圳益田路证券营业部',
   ARRAY['国君深圳益田路'], 2,
   '深圳帮代表', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT),

  ('seat_cjsc_wh',     '长江武汉',   '长江证券股份有限公司武汉中北路证券营业部',
   ARRAY['长江武汉中北路'], 2,
   '中部题材股活跃席位', true, (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
ON CONFLICT (id) DO UPDATE SET
  nickname    = EXCLUDED.nickname,
  seat_name   = EXCLUDED.seat_name,
  aliases     = EXCLUDED.aliases,
  tier        = EXCLUDED.tier,
  description = EXCLUDED.description,
  active      = EXCLUDED.active;

-- 验证
SELECT tier, COUNT(*) FROM "hotMoneySeats" GROUP BY tier ORDER BY tier;
