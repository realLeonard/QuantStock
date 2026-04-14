# 每日复盘全览 v2 · 内容重构规格

> 文档版本：2026-04-14 初稿
> 适用模块：`apps/web/components/daily-review/` + `scripts/daily-review/` + `scripts/zaobao/python/`

---

## 1. 背景与目标

### 1.1 v1 现状
- 全览页展示 AI headline + 情绪温度条 + 9 个指标卡 + 主线 + 异动信号 + 明日展望 + 11 个折叠原始数据。
- 问题：
  - 顶部指标杂乱无分层，缺少「好坏判断」和「环比对比」。
  - 情绪面维度单一，仅覆盖短线赚钱效应，缺少宽度 / 风格 / 资金维度。
  - 主线缺少「演绎天数」「龙头梯队」「分歧点」等短线核心要素。
  - 连板梯队埋在原始数据折叠区，用户几乎不展开。
  - 明日展望停留在"方向词"，缺少具体标的、容错位、观察点。
  - 资讯与市场表现没有打通，无法解释"今天为什么这样走"。
  - 缺少与昨日的承接验证，每日复盘孤立成篇。

### 1.2 v2 目标
- **以投研者决策视角组织内容**：读完一遍能回答「今天什么状态、钱在哪里、明天怎么打」。
- **情绪面分层 + 每层带结论**：不只是数据堆砌。
- **新增数据维度**：涨停原因（韭研 Vision 解析）+ 黄白线 + 游资席位字典 + 资讯融合。
- **承接验证**：连接昨日判断与今日兑现。

---

## 2. 最终全览内容结构

> 阅读顺序按决策价值排序。

```
0. 今日头条（一句话定性）
1. 🌡️ 情绪面全景            （宽度 + 高度 + 赚钱效应 + 风格，含 7 日情绪走势）
2. 💰 资金画像                （大盘主力/散户 + 板块 + 龙虎榜机构/游资）
3. 📰 影响今日盘面的重要资讯  （盘前/盘中/盘后分段，3~8 条）
4. 🎯 今日主线                （含演绎天数 + 龙头梯队 + 客观预判信号）
5. 🪜 连板梯队                （高度股 + 梯队分布 + 晋级率 + 断板 + 新晋级）
6. ⚠️ 风险预警                （消息面 + 技术面）
7. 📋 明日作战计划            （仓位 + 模式 + 跟踪标的 + 回避 + 关键观察点）
8. ↩️ 昨日承接验证            （昨日主线今日兑现度 + 龙头去留 + 情绪连续性）
```

---

## 3. 每块内容的字段规格与数据来源

### 3.1 [0] 今日头条

| 字段 | 说明 | 来源 |
|---|---|---|
| `headline` | 一句话定性（如「缩量分化日，权重护盘但题材退潮」） | AI 生成 |
| `date` | 报告日期 | system |

---

### 3.2 [1] 情绪面全景

#### A. 宽度情绪（market_breadth）
| 字段 | 说明 | 数据源 |
|---|---|---|
| `up_count / down_count` | 涨 / 跌家数 | `market_sentiment` |
| `strong_count / weak_count` | 涨幅 >7% / 跌幅 >7% 家数 | `market_sentiment` |
| `limit_up / limit_down` | 涨停 / 跌停数（非 ST） | `market_sentiment` |
| `conclusion` | AI 小结论（"宽度偏强 / 偏弱 / 分化"） | AI |

#### B. 高度情绪（ladder_emotion）
| 字段 | 说明 | 数据源 |
|---|---|---|
| `max_board` | 今日最高连板 | `limit_up_ladder` |
| `ladder_dist` | 梯队分布 `{1: 32, 2: 8, 3: 3, 4: 1, 5: 1}` | `limit_up_ladder` |
| `promotion_rate` | 首板晋级率 | `limit_analysis.promotion.rate` |
| `broken_leaders` | 断板高度股列表（≥3 板断板） | 新增计算 |
| `new_leaders` | 新晋级 ≥2 板 | 新增计算 |
| `conclusion` | "高度情绪健康 / 回落 / 冰点" | AI |

#### C. 赚钱效应（profit_effect）
| 字段 | 说明 | 数据源 |
|---|---|---|
| `premium_rate` | 昨日涨停今日平均溢价率 | `limit_analysis.premium_summary.avg_premium` |
| `broken_rate` | 炸板率 | `market_sentiment.broken_rate` |
| `total_seal_fund` | 涨停封单总额 | `limit_analysis.seal_stats.total_seal_fund` |
| `conclusion` | "打板赚钱 / 亏钱 / 中性" | AI |

#### D. 风格情绪（style_emotion）【新增】
| 字段 | 说明 | 数据源 |
|---|---|---|
| `yellow_line_chg` | 上证黄线收盘涨跌幅（等权，反映小盘） | **新增采集** |
| `white_line_chg` | 上证白线收盘涨跌幅（加权，反映权重） | **新增采集** |
| `divergence` | 背离方向 + 幅度 | 计算 |
| `index_perf` | 各大指数涨跌 | `market_overview.indices` |
| `volume_price` | 量价关系（放量涨/缩量涨/放量跌/缩量跌） | 计算（`volume.today` vs `avg_5d` + 指数涨跌） |
| `conclusion` | "题材风格 / 权重风格 / 分化" | AI |

#### 情绪综合
| 字段 | 说明 | 来源 |
|---|---|---|
| `sentiment_score` | 综合温度 1-10 | AI（已有） |
| `sentiment_stage` | 冰点/修复/升温/主升/高潮/退潮/分歧 | AI（已有） |
| `sentiment_7d_trend` | 近 7 日温度序列（供 mini 走势图） | 查 DB 近 7 日 ai_analysis.sentiment_score |

---

### 3.3 [2] 资金画像

#### 大盘资金（dashboard_fund）【新增】
| 字段 | 说明 | 数据源 |
|---|---|---|
| `total_main_inflow` | 主力净流入（超大单+大单，全市场聚合） | akshare `stock_individual_fund_flow_rank` |
| `total_retail_inflow` | 散户净流入（小单） | 同上 |
| `total_amount` | 两市成交额 | `market_overview.volume.today` |
| `amount_vs_5d` | 成交额 vs 5 日均对比 | 计算 |
| `conclusion` | "主力进场散户撤退 / 主力撤退散户接盘 / 分歧" | AI |

#### 板块主力流向（sector_flow）
| 字段 | 说明 | 数据源 |
|---|---|---|
| `top_inflow` | 流入 TOP5 板块 | `sector_fund_flow.inflow`（已有） |
| `top_outflow` | 流出 TOP5 板块 | `sector_fund_flow.outflow`（已有） |
| `migration` | 资金切换路径（从 X 板块 → Y 板块） | AI 基于流向推理 |

#### 龙虎榜机构席位（institution_seats）【新增加工】
| 字段 | 说明 | 数据源 |
|---|---|---|
| `net_buy_top5` | 机构专用席位净买 TOP5 | `dragon_tiger` 过滤 "机构专用" |
| `net_sell_top5` | 机构专用席位净卖 TOP5 | 同上 |
| `total_inst_net` | 机构净买入总额 | 聚合 |

#### 一线游资动向（hot_money）【新增】
| 字段 | 说明 | 数据源 |
|---|---|---|
| `seats_appeared` | 今日上榜的一线游资席位数 | `dragon_tiger` + `hotMoneySeats` 字典匹配 |
| `signature_moves` | 标志性操作（孙哥买 XX / 章盟主卖 YY） | 同上 |

**需要新建字典表**：`hotMoneySeats`（一线游资标志营业部）。

---

### 3.4 [3] 影响今日盘面的重要资讯

#### 资讯数据结构
```typescript
interface ImportantNews {
  time_segment: 'pre_market' | 'intraday' | 'post_market';  // 盘前/盘中/盘后
  news_time: string;       // "2026-04-14 11:30"
  level: 'A' | 'B';        // 重要级别
  headline: string;        // 标题
  summary: string;         // 30-80 字摘要
  driven_target: {         // 驱动对象
    type: 'theme' | 'sector' | 'stock' | 'market';
    name: string;          // "半导体" / "光模块" / "中际旭创" / "全市场"
    impact: 'bullish' | 'bearish' | 'neutral';
  };
  source: string;          // "CLS" | "zaobao" | "jiuyan"
  url?: string;
}
```

#### 数据源与筛选
- **来源**：`newsItems_cls`（财联社电报）+ `dailyReport`（每日早报）
- **时间窗**：
  - 「解释今天」：前一日 15:00 → 今日 15:00
  - 「预示明天」：今日 15:00 → 复盘生成时刻
- **两阶段筛选**：
  1. 规则预筛（Python 代码）：level + 关键词白名单 + 类别过滤 + 排除噪音
  2. AI 精选：从预筛结果中选 3~8 条真正驱动盘面的

---

### 3.5 [4] 今日主线

#### 主线数据结构
```typescript
interface MainTheme {
  name: string;                       // "CPO/光模块"
  strength: '强' | '中' | '弱';
  stage: string;                      // "启动D1" | "主升D3" | "分歧D4" | "退潮D5"
  days: number;                       // 演绎天数
  leader_ladder: {                    // 龙头梯队（不是简单 chip 列表）
    leader: { code: string; name: string; board: number; status: string };
    second: Array<{ code: string; name: string; board: number; status: string }>;
    new_promotion: Array<{ code: string; name: string; board: number }>;
  };
  catalyst: string;                   // 驱动催化（订单/政策/财报/突发）
  today_performance: {
    plate_change_pct: number;         // 板块涨幅
    net_inflow: number;               // 主力净流入金额（亿）
    limit_count: number;              // 本主线今日涨停数
  };
  divergence_signals: string[];       // 分歧点（断板、减仓、资金撤退等客观信号）
  next_day_signals: {                 // 明日预判信号（非主观结论）
    label: '延续概率高' | '分歧加剧' | '退潮概率高' | '信号不足';
    evidence: string[];               // 具体证据
    suggestion?: string;              // 可选操作建议
  };
}
```

#### 数据来源
- **主线识别**：韭研涨停原因图片解析的 `themes` 字段（聚类最准确）+ 同花顺热门概念辅助
- **演绎天数**：查近 N 天历史 `limitUpReasons`，同主题名称连续出现即可计算
- **龙头梯队**：从 `limit_up_ladder` 按连板数排序 + 涨停原因聚类到对应主线
- **分歧信号**：`limit_analysis.premium_details`（昨日涨停今日表现）+ 断板识别
- **预判规则**（给 AI）：
  - D1-D2 + 梯队增加 → 延续概率高
  - D3-D4 + 断板出现 → 分歧加剧
  - D5+ 或 主力撤退 → 退潮概率高

---

### 3.6 [5] 连板梯队

#### 数据结构
```typescript
interface LadderView {
  high_leaders: Array<{   // 高度股（≥4 板）
    code: string;
    name: string;
    board: number;
    first_seal_time: string;
    seal_fund: number;           // 封单（亿）
    broken_count: number;
    theme: string;               // 所属主线
    reason: string;              // 涨停原因（来自韭研）
  }>;
  ladder_distribution: {         // 按连板数分布
    [board: number]: Array<{ code; name; theme; reason }>;
  };
  promotion_rate: number;        // 首板晋级率
  yesterday_limit_count: number; // 昨日涨停数
  promoted_count: number;        // 今日晋级数
  broken_highs: Array<{ code; name; board; reason: string }>; // 断板高度股
  new_promotions: Array<{ code; name; board; reason: string }>; // 新晋级≥2板
}
```

#### 数据来源
- 基础：`limit_up_ladder` + `limit_analysis.promotion` + `limit_analysis.seal_details`
- 涨停原因：**韭研 limitUpReasons 表（新增）** → 每只涨停票匹配出 reason + theme

---

### 3.7 [6] 风险预警

```typescript
interface RiskAlert {
  type: 'news' | 'technical';
  level: 'high' | 'medium' | 'low';
  title: string;                 // "央行重启逆回购，流动性收紧信号"
  evidence: string;              // 证据
  impact: string;                // 影响板块/个股
}
```

- **消息面风险**：从重要资讯里筛出利空条目
- **技术面风险**：
  - 高度股断板（≥4 板断）
  - 指数跌破关键位（破 60 日线 / 年线）
  - 量价背离
  - 一致性预期反转（如主线连日亏钱效应）

---

### 3.8 [7] 明日作战计划

```typescript
interface BattlePlan {
  position_level: '满仓' | '半仓偏多' | '半仓' | '半仓偏空' | '空仓观望';
  mode: '打板优先' | '低吸优先' | '接力为主' | '观望为主';
  focus_stocks: Array<{           // 重点跟踪（具体股）
    code: string;
    name: string;
    reason: string;               // 跟踪理由
    fault_tolerance: string;      // 容错位（如"5% 止损"/"10日线企稳"）
    action: '打板' | '低吸' | '接力' | '观察';
  }>;
  avoid_list: string[];           // 绝对回避
  key_observations: string[];     // 明日开盘关键观察点
}
```

---

### 3.9 [8] 昨日承接验证（放最后）

```typescript
interface YesterdayVerify {
  yesterday_themes: Array<{       // 昨日主线今日表现
    name: string;
    yesterday_strength: string;
    today_performance: string;    // "兑现 / 哑火 / 反向"
    today_leader: string;         // 昨日龙头今日状态
  }>;
  sentiment_trend: {
    yesterday_score: number;
    today_score: number;
    direction: '延续' | '反转' | '修复' | '破位';
  };
  conclusion: string;             // AI 总结"昨日判断是否兑现"
}
```

- 查询昨日 `dailyReview.ai_analysis`，取主线列表 + 情绪分数
- 对比今日主线/情绪表现，由 AI 生成兑现度评估

---

## 4. 新增数据采集任务

### 4.1 韭研涨停原因图片解析（挂入现有 17:00 任务）

**合并位置**：`scripts/zaobao/python/cls_news_collector.py` Step 6（涨跌家数）之后新增 **Step 7**。

**幂等规则**：查 DB `limitUpReasons.pick_date = today`，已存在则跳过。

**处理流程**：
1. 访问 `https://www.jiuyangongshe.com/action/{YYYY-MM-DD}`
2. 从 HTML 中提取涨停复盘图 URL
3. 下载图片
4. 调 Claude Vision（复用 `scripts/scraper/vision.ts` 模式）返回结构化 JSON
5. 写入 `limitUpReasons` 表

**新建表**：
```sql
CREATE TABLE "limitUpReasons" (
  id TEXT PRIMARY KEY,
  pick_date TEXT NOT NULL UNIQUE,
  themes JSONB NOT NULL DEFAULT '[]',
  raw_image_url TEXT,
  source TEXT DEFAULT 'jiuyan',
  created_at BIGINT NOT NULL
);
ALTER TABLE "limitUpReasons" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow read" ON "limitUpReasons" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "limitUpReasons" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "limitUpReasons" FOR UPDATE USING (true);
```

**themes JSONB 结构**：
```typescript
interface LimitUpThemeGroup {
  name: string;                  // 题材名（如"光模块"）
  stock_count: number;           // 该题材涨停家数
  leader_code: string;           // 龙头代码
  driver: string;                // 题材驱动解读
  stocks: Array<{
    code: string;
    name: string;
    continuous_limit: number;
    first_seal_time: string;
    last_seal_time: string;
    limit_open_times: number;    // 炸板次数
    seal_fund: number;           // 封单金额（亿）
    turnover_rate: number;       // 换手率
    reason: string;              // 个股涨停原因文字
    concept_tags: string[];      // 关键词标签
    theme_position: string;      // "龙头" | "龙二" | "接力" | "补涨" | "跟风"
    leader_rank: number | null;
  }>;
}
```

---

### 4.2 上证黄白线数据采集【新增】

**新建 collector**：`scripts/daily-review/python/collectors/index_yellow_white.py`

**数据源**：akshare `stock_zh_a_hist_min_em`（上证综指 1min 分时数据）

**采集策略**：
- 取收盘时的两个值：
  - 白线 = 加权涨跌幅（上证综指本身）
  - 黄线 = 等权涨跌幅（需自行计算 or 从指数接口拿等权版本）
- 计算两者的背离幅度

**写入位置**：`dailyReview.market_overview.yellow_white`
```typescript
interface YellowWhite {
  yellow_line_chg: number;     // 黄线涨跌幅
  white_line_chg: number;      // 白线涨跌幅
  divergence: number;          // 差值
  style_bias: '题材风格' | '权重风格' | '均衡';
}
```

---

### 4.3 大盘主力/散户资金聚合【新增】

**新建 collector**：`scripts/daily-review/python/collectors/market_fund_flow.py`

**数据源**：akshare `stock_market_fund_flow`（全市场资金流向，含主力/超大单/大单/中单/小单）

**写入位置**：`dailyReview.market_overview.fund_flow`
```typescript
interface MarketFundFlow {
  main_inflow: number;         // 主力净流入（超大单+大单，亿）
  retail_inflow: number;       // 散户净流入（小单，亿）
  mid_inflow: number;          // 中单净流入（亿）
  super_large_inflow: number;  // 超大单（亿）
}
```

---

### 4.4 一线游资席位字典【新增】

**新建表**：`hotMoneySeats`
```sql
CREATE TABLE "hotMoneySeats" (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,          -- 孙哥 / 章盟主 / 方新侠 / 作手新一 / 炒股养家...
  seat_name TEXT NOT NULL,         -- 营业部全称
  aliases TEXT[],                  -- 别名数组（用于模糊匹配）
  tier INT NOT NULL DEFAULT 1,     -- 等级 1-3（一线/二线/三线）
  description TEXT,                -- 介绍（风格、擅长方向）
  active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL
);
ALTER TABLE "hotMoneySeats" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow read" ON "hotMoneySeats" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "hotMoneySeats" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "hotMoneySeats" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "hotMoneySeats" FOR DELETE USING (true);
```

**初始数据**：收集市场公认的约 30~50 个一线游资营业部（需要一次性整理后 insert）。

**加工逻辑**：每日复盘生成时，从 `dragon_tiger` 中匹配席位名，识别一线游资动向。

---

## 5. 资讯预筛策略（Python 代码）

**新增模块**：`scripts/daily-review/python/collectors/news_filter.py`

```python
def filter_important_news(sb, date_str):
    """
    从 newsItems_cls + dailyReport 中筛选重要资讯
    返回 30~50 条候选，供 AI 二次精选
    """
    # 时间窗：前一日 15:00 ~ 今日复盘生成时刻
    # 分段标记：pre_market / intraday / post_market

    # 规则 1：level 过滤（A/B 级优先）
    # 规则 2：关键词白名单命中
    #   - 政策类：政策 降准 加息 利率 补贴 出口管制 关税
    #   - 产业催化：订单 量产 交付 招标 中标 合作 签约
    #   - 公司重大：并购 重组 增持 举牌 停复牌 立案
    #   - 业绩类：业绩预增 业绩预减 业绩预告 净利润
    #   - 题材类：光模块 机器人 华为 AI 固态电池 核聚变 ...（需维护）
    # 规则 3：排除噪音关键词
    #   - 减持计划 股东质押 基金持仓 高管变动 股东诉讼
    # 规则 4：合并去重（同一事件多家转发只保留最重要一条）
    # 规则 5：限量 50 条
    pass
```

---

## 6. AI Prompt 草案

> 完整 prompt 在实施阶段调整，这里给核心结构。

### 6.1 输入数据
```
报告日期：{date}
【情绪数据】
  - 宽度：{up_count}/{down_count}/{limit_up}/{limit_down}/{strong}/{weak}
  - 高度：最高 {max_board} 板，梯队 {ladder_distribution}
  - 赚钱效应：溢价 {avg_premium}%，炸板 {broken_rate}%，封单 {total_seal_fund}
  - 风格：黄线 {yellow}%，白线 {white}%，量能 {volume_ratio}
【资金数据】
  - 大盘：主力 {main_inflow}亿，散户 {retail_inflow}亿
  - 板块流入：{top_inflow}
  - 板块流出：{top_outflow}
  - 龙虎榜机构：买 {inst_buy_top5}，卖 {inst_sell_top5}
  - 一线游资：{hot_money_moves}
【连板梯队】
  - 高度股：{high_leaders}
  - 断板：{broken_highs}
  - 新晋级：{new_promotions}
【涨停原因聚类】（韭研）
  {themes_with_stocks}
【资讯预筛】（30~50 条）
  {filtered_news}
【昨日数据】
  - 昨日主线：{yesterday_themes}
  - 昨日情绪分：{yesterday_score}
  - 昨日龙头：{yesterday_leaders}
```

### 6.2 输出 JSON schema
```json
{
  "headline": "...",
  "sentiment": {
    "score": 6,
    "stage": "分歧",
    "width_conclusion": "...",
    "ladder_conclusion": "...",
    "profit_conclusion": "...",
    "style_conclusion": "...",
    "summary": "..."
  },
  "fund_picture": {
    "dashboard_conclusion": "...",
    "migration": "...",
    "inst_summary": "...",
    "hot_money_summary": "..."
  },
  "important_news": [
    { "segment": "intraday", "time": "...", "headline": "...", "summary": "...", "driven": {...}, "level": "A" }
  ],
  "main_themes": [
    {
      "name": "CPO/光模块",
      "strength": "强",
      "stage": "主升D3",
      "days": 3,
      "leader_ladder": {...},
      "catalyst": "...",
      "today_performance": {...},
      "divergence_signals": [...],
      "next_day_signals": {
        "label": "分歧加剧",
        "evidence": ["XX 5板断板", "新晋级数 3 (昨日 5)", "板块主力转为流出 -12亿"],
        "suggestion": "降级到 2 板以下容错位"
      }
    }
  ],
  "ladder_view": {...},
  "risk_alerts": [...],
  "battle_plan": {
    "position_level": "半仓偏多",
    "mode": "打板优先",
    "focus_stocks": [...],
    "avoid_list": [...],
    "key_observations": [...]
  },
  "yesterday_verify": {...}
}
```

### 6.3 关键规则（在 prompt 里强制）
- **"客观证据在前，主观结论在后"**：每个结论必须有具体数据证据支撑。
- **数字必须引用**：不允许模糊说"涨停较多"，必须说"涨停 48 家"。
- **主线预判三档**：延续概率高 / 分歧加剧 / 退潮概率高 / 信号不足（四选一）。
- **明日作战计划必须到个股**：不能停留在"关注半导体方向"这种空话。

---

## 7. DB 表结构变更清单

### 7.1 新增
- `limitUpReasons` — 韭研涨停原因
- `hotMoneySeats` — 一线游资营业部字典

### 7.2 扩展（`dailyReview` 表）
- `market_overview.yellow_white`（新增字段，JSON 内部扩展，无需建表）
- `market_overview.fund_flow`（新增字段）
- `ai_analysis` 结构升级：按 6.2 新 schema 改造（老数据通过兼容性降级逻辑处理）

---

## 8. 前端 UI 改造清单

### 8.1 新组件（`apps/web/components/daily-review/panels/v2/`）
- `HeadlinePanel.tsx` — 头条 + 情绪温度 + 7 日走势
- `SentimentOverview.tsx` — 情绪四维度卡片（宽度/高度/赚钱效应/风格）
- `FundPicturePanel.tsx` — 资金画像
- `ImportantNewsPanel.tsx` — 影响今日盘面的资讯（按时段分段）
- `MainThemesV2Panel.tsx` — 主线 v2（含演绎天数 + 龙头梯队 + 预判信号）
- `LadderViewPanel.tsx` — 连板梯队（升级为一级）
- `RiskAlertsPanel.tsx` — 风险预警
- `BattlePlanPanel.tsx` — 明日作战计划
- `YesterdayVerifyPanel.tsx` — 昨日承接验证

### 8.2 辅助组件
- `SentimentMiniTrend.tsx` — 7 日情绪 sparkline
- `ConclusionBadge.tsx` — 各分层的结论标签
- `LeaderLadder.tsx` — 龙头梯队展示
- `NewsTimeline.tsx` — 按盘前/盘中/盘后分段的资讯时间线

### 8.3 旧组件保留/移除
- 保留：`LegacyFullReportPanel`（作为 v2 数据缺失时的降级）
- 移除："原始数据折叠区"从 FullReport 中移除（用户在各 Tab 查看）

---

## 9. 实施阶段规划

建议分 **4 个阶段**，每阶段独立交付，前端改造滞后于数据就绪：

### 阶段 1：数据基础（数据先行）
- [ ] 建表 `limitUpReasons`、`hotMoneySeats`
- [ ] 编写 `collectors/limit_up_reason.py`（韭研图片解析）
- [ ] 合并到 `cls_news_collector.py` Step 7
- [ ] 编写 `collectors/index_yellow_white.py`
- [ ] 编写 `collectors/market_fund_flow.py`
- [ ] 一次性初始化 `hotMoneySeats` 基础数据（整理 30~50 条）

### 阶段 2：资讯筛选 + AI prompt 重构
- [ ] 编写 `collectors/news_filter.py`
- [ ] `dailyReview.market_overview` 扩展字段入 DB 流程
- [ ] AI prompt 按 6.2 重构
- [ ] `ai_analysis` schema 升级（保持向下兼容）

### 阶段 3：前端 v2 展示
- [ ] 按 8.1 新建面板组件
- [ ] 按最终结构重排全览页（8 块 + 昨日验证放最后）
- [ ] 7 日情绪 mini 走势
- [ ] 适配旧数据降级展示

### 阶段 4：打磨 + 规则维护
- [ ] 游资字典持续补充
- [ ] 资讯关键词白名单/黑名单维护
- [ ] AI prompt 迭代（根据输出质量调优）
- [ ] 推送端 Markdown 格式同步升级

---

## 10. 待确认 / 待后续讨论

- [ ] 韭研页面的防爬强度（cookies / UA 伪装）
- [ ] 一线游资字典的初始化数据（需人工整理 or 找公开清单）
- [ ] 黄白线的数据源细节（等权涨幅的具体算法）
- [ ] 资讯预筛关键词白名单的完整列表
- [ ] AI 输出 JSON 的 token 成本评估（新 schema 大了约 2~3 倍）
- [ ] 推送给微信的精简版格式（推送不适合放全部内容，需选摘要）
