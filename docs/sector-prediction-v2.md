# 板块评分系统重构 — 从复盘到预测（v3 终版）

## Context

现有评分系统的根本问题：**所有维度都在描述「今天哪些板块最强」，本质是复盘而非预测。**

用户需要的是：根据历史K线+资金流+连板天梯数据模式，识别**未来几天大概率要涨但现在还没爆发的板块**。

两个核心场景：
1. **早期吸筹**：资金悄悄流入，涨幅平平，市场没注意 → 最佳介入点
2. **中期持续性**：已经涨了一段，资金是否减速、量价是否背离 → 决定追还是跑

第一原则：**目的驱动设计，数据不足不砍需求，想办法补数据。**

---

## 数据基础

### 已有数据

| 数据 | 来源 | 历史深度 | 说明 |
|------|------|----------|------|
| K线 OHLCV | sector_daily | 60交易日 | 499板块全覆盖 |
| 资金流分级 | sector_daily | 60交易日 | 主力/超大/大/中/小单 |
| 连板天梯（按概念板块） | limitUpReasons | 5天（用户补60天） | themes[].count/stocks[].board |
| 市场情绪 | dailyReview.market_sentiment | 6天 | 涨停数/跌停数/炸板率/涨跌家数 |
| 龙虎榜 | dailyReview.dragon_tiger | 6天 | |
| 新闻 | newsItems_cls | 滚动3天 | 1079条 |
| 产业链关联 | sector_rotation_map | 固定 | 24条 |

### 需要新增采集的数据

| 数据 | 来源 | 采集方式 | 存入 |
|------|------|----------|------|
| **每板块涨停家数** | 东财板块接口 f106 | 每日采集时新增字段 | sector_daily.limit_up_count |
| **每板块跌停家数** | 东财板块接口 f107 | 每日采集时新增字段 | sector_daily.limit_down_count |
| **每板块上涨家数** | 东财板块接口 f104 | 每日采集时新增字段 | sector_daily.up_count |
| **每板块下跌家数** | 东财板块接口 f105 | 每日采集时新增字段 | sector_daily.down_count |
| **每板块量比** | 东财板块接口 f10 | 每日采集时新增字段 | sector_daily.volume_ratio |

### 数据缺口解决方案

| 缺口 | 方案 | 时间线 |
|------|------|--------|
| limitUpReasons 历史不足 | 用户手动补60天 | 立即 |
| 涨停/跌停家数无历史 | 从今天开始每日采集积累 | 逐天积累 |
| 市场情绪周期历史不足 | dailyReview 每天在存，逐天积累；同时每天从 market_sentiment 提取关键指标写入独立历史表（或 sector_daily 聚合） | 逐天积累 |
| 板块热度/辨识度 | 用新闻提及频率 + limitUpReasons 出现频次近似 | 现有数据可做 |

---

## 评分体系

### 维度与权重

| 维度 | 权重 | 文件 | 核心逻辑 |
|------|------|------|----------|
| 资金暗流 | 30% | `fund_stealth_scorer.py` | 资金悄悄进场但价格未动 |
| 量价蓄势 | 25% | `momentum_scorer.py` | 底部整理完毕、量价配合向好 |
| 模式匹配 | 20% | `pattern_scorer.py` | **跨板块**历史相似形态的后续走势 |
| 催化剂 | 15% | `catalyst_scorer.py` | 政策 + 轮动 + 连板天梯人气 |
| 风险修正 | -5~0 | `risk_adjuster.py` | 过热/见顶信号，直接扣分 |
| 阶段系数 | ×0.7~1.2 | `lifecycle.py` | 吸筹期放大、见顶期压制 |

### 总分公式

```
raw = stealth×0.30 + momentum×0.25 + pattern×0.20 + catalyst×0.15
adjusted = raw × stage_coefficient
final = max(0, adjusted + risk_adjustment)
```

### 大盘共振修正

弱势/极端市场时，所有板块评分整体打折（不只是少推几个）：
- strong → ×1.0
- neutral → ×0.9
- weak → ×0.75
- extreme → ×0.5

---

## 各维度详细算法

### 1. 资金暗流（30%，满分100）

**子因子A：渐进式流入（40分）**
- 取最近10天 main_net_inflow
- 连续正流入天数 ≥ 3 → 基础20分，每多1天 +4，封顶40
- 单日流入量 > 全市场P80 → 系数×0.5（已被市场发现，预测价值降低）
- 流入递增趋势（后3天均值 > 前3天均值 × 1.2）→ 额外+10

**子因子B：大单暗涌（30分）**
- 取最近5天，检查每天是否同时满足：
  - (super_large_net + large_net) / turnover > 0.5%（大单在进）
  - change_pct 在 -1% ~ 2% 之间（价格没大动）
- 满足天数 × 6分，封顶30
- 大单净流入占比5日均值 > 2% → 额外+5

**子因子C：散户反向（30分）**
- 取最近5天，检查每天：small_net < 0 且 main_net_inflow > 0（主力进散户跑）
- 满足天数 × 6分，封顶30

### 2. 量价蓄势（25%，满分100）

**子因子A：底部量能变化（30分）**
- 后10天均量 / 前10天均量 = vol_ratio
- 1.0 < ratio ≤ 1.3 → 15分（温和放量）
- 1.3 < ratio ≤ 1.8 → 30分（明显放量不过热）
- ratio > 1.8 → 20分（过热减分）
- 价格不在低位（position > 0.6）→ 系数×0.5

**子因子B：振幅收敛 + 价格位置（30分）**
- 收敛比 = 5日振幅均值 / 20日振幅均值
- 价格位置 = (close - low20d) / (high20d - low20d)
- 收敛(ratio<0.7) + 上沿(position>0.6) → 30分（即将突破）
- 收敛 + 中部(0.3-0.6) → 20分
- 收敛 + 下沿(<0.3) → 15分
- 不收敛(ratio>1.0) → 0~5分

**子因子C：均线即将金叉（20分）**
- gap_pct = (MA5 - MA10) / MA10 × 100
- 即将金叉（MA5 < MA10 但 gap > -0.5%）→ 20分（最佳预测点）
- 刚金叉（MA5 > MA10，gap < 1%）→ 10分
- 已多头排列 → 5分（预测价值降低）
- 离金叉远（gap < -1%）→ 0分

**子因子D：突破前夜（20分）**
- close ≥ high_20d × 0.98 → 20分
- close ≥ high_20d × 0.95 → 15分
- close < high_20d × 0.90 → 0分

### 3. 模式匹配（20%，满分100）

**核心：跨板块匹配**。在全市场 491板块 × 40天 ≈ 19640个窗口中找相似模式。

**子因子A：资金流模式（50分）**
- 取当前板块最近5天 main_net_inflow_pct 的符号序列（如 [+,+,-,+,+]）
- 在**全市场所有板块**过去40天历史中滑窗匹配相同序列
- 取所有匹配窗口后3天的 change_pct 均值
- 后续涨幅 > 2% → 50分，1-2% → 35分，0-1% → 20分，<0 → 0分
- 匹配窗口 < 10 → 置信度打折（×匹配数/10）

**子因子B：量价形态（50分）**
- 每天归类为4种状态：缩量涨/放量涨/缩量跌/放量跌（量的基准=10日均量）
- 取当前板块最近5天的状态序列
- **跨板块匹配**：在全市场所有板块历史中找相同序列
- 取匹配窗口后3天的 change_pct 均值 → 映射到 0-50分
- 预定义强势模式额外加分：
  - 缩量跌→缩量跌→缩量涨→放量涨→放量涨 → +5（V型启动）
  - 缩量涨×4→放量涨 → +5（蓄势突破）
  - 放量涨×5 → 上限30分（已在主升，追高风险）

### 4. 催化剂（15%，满分100）

**子因子A：政策催化（35分）**
- 保留 Claude NLP 新闻评估
- 有利好新闻且 Claude 评分 > 60 → 35分
- 有相关新闻但评分 50-60 → 15分
- 无相关新闻 → 0分

**子因子B：轮动传导（30分）**
- 上游板块近3天累计涨幅 > 5% → 20分
- 上游板块资金加速流入 → 10分

**子因子C：连板天梯人气（35分）**
- 数据来源：limitUpReasons 近3天（今日+昨日+前日）
- 今日首次出现涨停（昨日该板块0涨停→今日≥1）→ 35分（启动催化，最有预测价值）
- 涨停数比昨日增加 → 25分（人气在聚集）
- 出现2板以上连板股（昨日无→今日有）→ 20分（市场开始接力）
- 首板数量增加 → 15分（新资金在试探）
- 已有高位板(≥4板) → 5分（已被充分认知，预测价值低）

### 5. 风险修正（-5~0）

每条 -1~-2 分，累计最多 -5：
- 连续上涨 > 5天 → -2（追高风险）
- 振幅 > 5% 且换手率骤增 > 1.5倍 → -2（分歧加剧）
- 资金连续流出 ≥ 2天 → -1
- 今日涨幅 > 5% → -2（大涨后回调概率高）
- **最高板断板**（limitUpReasons 昨日最高连板股今日不在涨停列表）→ -2（退潮信号）
- **涨停数连续2天增加 + 最高板≥5** → -1（极度过热，高潮末期）
- **板块跌停家数 > 0**（sector_daily.limit_down_count）→ -1（内部已有恐慌）

### 6. 阶段判断（lifecycle.py）

返回 `(stage, coefficient)`。

**输入数据**：sector_daily（K线+资金流+涨跌停家数）+ limitUpReasons 近3天（连板天梯）

| 阶段 | 系数 | 判断条件 |
|------|------|----------|
| 见顶期 | 0.7 | ①最高板断板，或②涨停数连续2天增+最高板≥5（高潮末期），或③连涨5天+振幅>均值2倍，或④涨>5%但资金流出 |
| 调整期 | 0.8 | ①涨停数减少+无新首板接力，或②连续2天流出+近5日涨幅<0，或③跌破MA5且MA5<MA10 |
| 主升期 | 0.9 | ①涨停数≥3且最高板≥3（天梯成型），或②5日涨>5%+量能放大+连续3天流入 |
| 发酵期 | 1.0 | ①涨停数增加+出现2板（人气聚集），或②成交量放大>50%+上涨2-4天 |
| 启动期 | 1.1 | ①首板从无到有（板块刚出现涨停），或②MA5刚上穿MA10+量能放大，或③首次突破20日高点 |
| 吸筹期 | 1.2 | 无涨停+资金连续3天流入（递增）+价格在0.3-0.6+振幅收敛+成交额>全市场中位数 |
| 观察期 | 1.0 | 默认 |

**连板天梯信号链**：
```
无涨停(吸筹) → 首板出现(启动) → 首板增多+2板出现(发酵) → 涨停爆发+天梯升高(主升)
→ 极度过热(见顶) → 最高板断板(见顶) → 涨停减少无接力(调整) → 无涨停(回到吸筹)
```

---

## 市场级情绪周期

独立于板块级 lifecycle，用于大盘共振判断。

**数据来源**：dailyReview.market_sentiment（涨停数、跌停数、炸板率、涨跌家数）

| 阶段 | 判断条件 | 对评分影响 |
|------|----------|------------|
| 冰点 | 涨停<15 且 炸板率>50% 且 跌停>20 | ×0.5（但吸筹信号最有价值） |
| 复苏 | 涨停20-40 且 炸板率下降趋势 | ×0.8 |
| 发酵 | 涨停40-60 且 炸板率<30% | ×0.9 |
| 高潮 | 涨停>80 且 炸板率<15% | ×1.0（但风险修正更严格） |
| 分歧 | 涨停>50 但 炸板率骤升>30% | ×0.8 |
| 退潮 | 涨停数连续2天减少 且 炸板率>40% | ×0.6 |

注：数据不足6天时暂按 neutral（×0.9）处理，随数据积累自动启用完整周期判断。

---

## 板块重叠处理

推荐输出时去重：
- 计算 TOP 推荐板块两两之间的20日 change_pct 相关系数
- 相关系数 > 0.8 的视为重叠板块
- 重叠组内只保留得分最高的一个
- 推送时标注："与XXX高度相关，已去重"

---

## 信号分档

| 信号 | 条件 | 时间建议 |
|------|------|----------|
| strong_buy | TOP 5% 且 score ≥ 60 且 阶段=吸筹/启动 | 中期布局(3-5天) |
| buy | TOP 10% 且 score ≥ 50 且 阶段≠见顶/调整 | 短期机会(1-3天) |
| hold | 主升期/发酵期 且 score ≥ 50 | 持有观察 |
| sell | 见顶期 且 risk_adjustment ≤ -3 | 建议离场 |
| watch | TOP 40% | 关注 |
| avoid | 其余 | 回避 |

**止损建议**（附在推送中）：
- strong_buy/buy：建议止损 -3%，持有上限 5 个交易日无明显上涨则离场
- hold：跌破 MA5 则离场

---

## 文件变更

### 新增（5个）
- `scorers/fund_stealth_scorer.py` — 资金暗流
- `scorers/momentum_scorer.py` — 量价蓄势
- `scorers/pattern_scorer.py` — 模式匹配（跨板块）
- `scorers/risk_adjuster.py` — 风险修正
- `backtest.py` — 回测框架

### 改造（5个）
- `scoring.py` — 主入口：新维度、新权重、新信号、大盘共振、板块去重
- `lifecycle.py` — 返回(stage, coefficient)，引入连板天梯
- `scorers/__init__.py` — 更新导出
- `scorers/policy_scorer.py` + `rotation_scorer.py` → 合并为 `catalyst_scorer.py`
- `collectors/sector_list.py` — 新增 f104/f105/f106/f107/f10 字段采集

### 推送改造
- `push-scores.ts` — 新维度表头、新信号(hold/sell)、止损建议、板块去重标注、时间维度

### 保留不变
- `main.py`、`db.py`、`browser.py`
- `collectors/sector_fund_flow.py`、`collectors/sector_kline.py`
- `market_env.py`（保留，被大盘共振模块复用）
- `backfill.py`（复盘保留）

### 旧文件备份
- `fund_scorer.py` → `fund_scorer_legacy.py`
- `tech_scorer.py` → `tech_scorer_legacy.py`
- `sentiment_scorer.py` → `sentiment_scorer_legacy.py`

---

## 数据库变更

```sql
-- sector_daily 新增字段
ALTER TABLE sector_daily ADD COLUMN IF NOT EXISTS limit_up_count INT DEFAULT 0;
ALTER TABLE sector_daily ADD COLUMN IF NOT EXISTS limit_down_count INT DEFAULT 0;
ALTER TABLE sector_daily ADD COLUMN IF NOT EXISTS up_count INT DEFAULT 0;
ALTER TABLE sector_daily ADD COLUMN IF NOT EXISTS down_count INT DEFAULT 0;
ALTER TABLE sector_daily ADD COLUMN IF NOT EXISTS volume_ratio REAL DEFAULT 0;

-- sector_scores 新增字段
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS stealth_fund_score REAL DEFAULT 0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS momentum_score REAL DEFAULT 0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS pattern_score REAL DEFAULT 0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS catalyst_score REAL DEFAULT 0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS risk_adjustment REAL DEFAULT 0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS stage_coefficient REAL DEFAULT 1.0;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS market_emotion_phase TEXT;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS time_horizon TEXT;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS stealth_fund_detail JSONB;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS momentum_detail JSONB;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS pattern_detail JSONB;
ALTER TABLE sector_scores ADD COLUMN IF NOT EXISTS catalyst_detail JSONB;
```

---

## 实施顺序

### Phase 0：数据基础
1. sector_daily 加字段（SQL）
2. `collectors/sector_list.py` 新增 f104/f105/f106/f107/f10 采集
3. `scoring.py` 评分前从 limitUpReasons 提取连板天梯数据
4. 用户回填 limitUpReasons 60天历史
5. 写 `backtest.py` 回测框架

### Phase 1：核心 Scorers
6. `fund_stealth_scorer.py` → 回测验证
7. `momentum_scorer.py` → 回测验证
8. `pattern_scorer.py`（跨板块匹配）→ 回测验证
9. 根据回测结果调优阈值

### Phase 2：辅助模块
10. `catalyst_scorer.py`（政策 + 轮动 + 人气催化）
11. `risk_adjuster.py`（含断板检测、跌停检测）
12. `lifecycle.py` 改造（引入连板天梯 + 涨跌停数据）
13. 市场级情绪周期模块
14. 板块重叠检测

### Phase 3：串联上线
15. `scoring.py` 主入口串联（新维度 + 大盘共振 + 去重）
16. DB 变更
17. `push-scores.ts` 格式更新（新维度、止损建议、时间维度）
18. 端到端测试

### Phase 4：持续调优
19. 每日复盘对比命中率
20. 数据积累后启用市场情绪周期完整判断
21. 根据实际表现调整权重和阈值

---

## 验证方式

1. **回测先行**：每个 scorer 实现后跑 `backtest.py`
   - 信号触发次数 > 30（统计显著）
   - 命中率 > 55%（优于随机）
   - 触发后3天平均涨幅 > 0.5%
2. **端到端**：`python3 scoring.py`，检查分布合理性
3. **复盘闭环**：每日 backfill 对比预测 vs 实际
4. **推送测试**：`npx tsx push-scores.ts`
5. **板块去重验证**：确认 TOP 推荐不存在高度重叠
