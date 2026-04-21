# 板块预测系统设计文档

## 一、架构设计

### 1.1 系统总览

A股概念板块每日自动评分系统，分两个阶段：

```
Phase 1 数据管道                    Phase 2 评分引擎
┌──────────────────┐               ┌──────────────────────────────┐
│ 东财 JSONP 接口   │               │ scoring.py 主入口             │
│  ├─ 板块列表API   │──→ sector    │  ├─ 市场环境分级              │
│  ├─ K线历史API    │    _master   │  ├─ 复盘回填                  │
│  └─ 资金流API     │──→ sector    │  ├─ 6维评分                   │
│                   │    _daily    │  │  ├─ 资金面(30%)             │
│ Playwright 浏览器  │              │  │  ├─ 情绪面(25%)             │
│ (JSONP 请求)      │              │  │  ├─ 政策面(25%,Claude NLP)  │
└──────────────────┘              │  │  ├─ 技术面(15%)             │
                                   │  │  ├─ 轮动(5%)               │
                                   │  │  └─ 龙头加分(0-10)         │
                                   │  ├─ 生命周期判断              │
                                   │  ├─ 排序+信号分档+风险识别     │
                                   │  └─ 写入 sector_scores        │
                                   │                               │
                                   │ push-scores.ts                │
                                   │  └─ WxPusher 微信推送         │
                                   └──────────────────────────────┘
```

### 1.2 触发与调度

- **cron-job.org**：每交易日（周一至周五）20:30 北京时间触发
- **GitHub Actions**：`sector-daily.yml` workflow
- **运行模式**：
  - `daily`：完整流程（采集 → 评分 → 推送）
  - `init`：仅初始化（同步板块列表 + 拉取60日历史K线）
  - `test_kline`：K线采集测试

### 1.3 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 数据采集 | Python + Playwright | 模拟浏览器请求东财 JSONP 接口 |
| 数据存储 | Supabase (PostgreSQL) | sector_master / sector_daily / sector_scores |
| NLP 评分 | Claude API (Sonnet) | 新闻→板块利好/利空批量评估 |
| 推送 | TypeScript + WxPusher | Markdown 格式微信推送 |
| 调度 | cron-job.org + GitHub Actions | 定时触发 + CI/CD 运行 |

### 1.4 数据库表结构

#### `sector_master` — 板块主表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| name | TEXT UNIQUE | 板块名称（如"CPO概念"） |
| bk_code | TEXT | BK代码（如"BK0927"） |
| change_pct | FLOAT | 当日涨跌幅 |
| leading_stock | TEXT | 领涨股名称 |
| is_active | BOOLEAN | 是否仍在东财列表中 |
| created_at / updated_at | BIGINT | UTC 毫秒 |

#### `sector_daily` — 板块每日快照

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| sector_name | TEXT | 板块名称 |
| trade_date | TEXT | YYYY-MM-DD |
| open / close / high / low | FLOAT | K线 OHLC |
| change_pct | FLOAT | 涨跌幅% |
| volume | BIGINT | 成交量 |
| turnover | FLOAT | 成交额 |
| amplitude | FLOAT | 振幅% |
| turnover_rate | FLOAT | 换手率% |
| main_net_inflow | FLOAT | 主力净流入 |
| main_net_inflow_pct | FLOAT | 主力净流入占比% |
| super_large_net | FLOAT | 超大单净流入 |
| large_net / medium_net / small_net | FLOAT | 大/中/小单净流入 |
| fund_leading_stock | TEXT | 资金流龙头股 |
| created_at | BIGINT | UTC 毫秒 |

约束：`UNIQUE(sector_name, trade_date)`

#### `sector_scores` — 板块每日评分

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| trade_date | TEXT | 交易日期 |
| sector_name | TEXT | 板块名 |
| fund_score / sentiment_score / policy_score / tech_score / rotation_score | REAL | 各维度 0-100 |
| leader_bonus | REAL | 龙头加分 0-10 |
| total_score | REAL | 加权总分 |
| fund_detail / sentiment_detail / policy_detail / tech_detail / rotation_detail / leader_detail | JSONB | 各维度子因子明细 |
| rank | INTEGER | 排名 |
| signal | TEXT | strong_buy / buy / watch / avoid / risk |
| stage | TEXT | 萌芽 / 发酵 / 主升 / 分歧 / 退潮 |
| confidence | REAL | 置信度 0-1 |
| risk_reason | TEXT | 风险原因（signal=risk 时） |
| leading_stock | TEXT | 龙头股 |
| market_env | TEXT | strong / neutral / weak / extreme |
| next_day_actual | REAL | 次日实际涨跌幅（复盘回填） |
| prediction_hit | BOOLEAN | 预测是否命中（复盘回填） |
| created_at | BIGINT | UTC 毫秒 |

约束：`UNIQUE(trade_date, sector_name)`

#### `sector_rotation_map` — 板块关联图谱

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | uuid |
| source_sector | TEXT | 上游板块 |
| target_sector | TEXT | 下游板块 |
| relation_type | TEXT | chain(产业链) / corr(相关性) |
| weight | REAL | 传导强度（默认 1.0） |
| description | TEXT | 说明 |

初始 24 条产业链边：AI算力→光模块→PCB→服务器、新能源车→锂电池→锂矿、光伏→储能→电力、机器人→减速器→传感器、半导体→芯片设计→EDA、军工→航天→卫星导航

### 1.5 文件结构

```
scripts/sector-prediction/
├── python/
│   ├── main.py                     ← Phase 1: 每日采集入口
│   ├── init_master.py              ← Phase 1: 初始化入口（60日K线）
│   ├── db.py                       ← 公共: Supabase 连接
│   ├── browser.py                  ← Phase 1: Playwright 浏览器单例
│   ├── collectors/
│   │   ├── __init__.py
│   │   ├── sector_list.py          ← Phase 1: 板块列表 + 当日K线
│   │   ├── sector_kline.py         ← Phase 1: 历史K线批量采集
│   │   └── sector_fund_flow.py     ← Phase 1: 资金流采集
│   ├── scoring.py                  ← Phase 2: 评分主入口（7步流程）
│   ├── scorers/
│   │   ├── __init__.py
│   │   ├── fund_scorer.py          ← Phase 2: 资金面 30%
│   │   ├── sentiment_scorer.py     ← Phase 2: 情绪面 25%
│   │   ├── policy_scorer.py        ← Phase 2: 政策面 25%（含 Claude NLP）
│   │   ├── tech_scorer.py          ← Phase 2: 技术面 15%
│   │   ├── rotation_scorer.py      ← Phase 2: 轮动规律 5%
│   │   └── leader_scorer.py        ← Phase 2: 龙头映射加分
│   ├── market_env.py               ← Phase 2: 市场环境分级
│   ├── lifecycle.py                ← Phase 2: 板块生命周期
│   └── backfill.py                 ← Phase 2: 复盘回填
├── push-scores.ts                  ← Phase 2: WxPusher 推送
├── package.json                    ← Phase 2: Node 依赖
└── requirements.txt                ← Python 依赖
```

### 1.6 环境变量

| 变量 | 阶段 | 用途 |
|------|------|------|
| SUPABASE_URL | 共用 | Supabase 连接 |
| SUPABASE_ANON_KEY | 共用 | Supabase 认证 |
| ANTHROPIC_AUTH_TOKEN | Phase 2 | Claude API 密钥 |
| ANTHROPIC_BASE_URL | Phase 2 | Claude API 代理地址 |
| WXPUSHER_TOKEN | Phase 2 | WxPusher 推送 |
| WXPUSHER_UID | Phase 2 | 推送目标用户 |

---

## 二、业务逻辑

### 2.1 Phase 1：每日数据采集

**目标**：维护全市场 ~491 个概念板块的 K线 + 资金流数据。

**每日执行流程**（`main.py`）：

```
[1/4] 刷新板块列表
      │ 拉取东财全部概念板块 → upsert sector_master
      │ 新板块自动入库，消失的标记 is_active=False
      │ 过滤非真实概念（排除"新高""预增""大盘股"等筛选类板块）
      │
[2/4] 写入当日K线
      │ 从板块列表API返回的OHLCV直接写入 sector_daily
      │ 跳过 OHLC 全为0的板块
      │ update时只更新K线字段，不覆盖已有的资金流字段
      │
[3/4] 采集资金流
      │ 东财资金流排名API → 返回全部板块当日主力/超大单/大单/中单/小单
      │ 按板块名精确匹配写入 sector_daily
      │ 记录不存在则新建（仅含资金流字段）
      │
[4/4] 数据质量检查
      │ K线成功率 < 50% → exit(1) → 触发 Bark 告警
      │ 资金流匹配率 < 50% → exit(1) → 触发 Bark 告警
```

**初始化流程**（`init_master.py`）：

```
[1/2] 同步板块列表（可 SKIP_MASTER=1 跳过）
[2/2] 拉取60日历史K线（逐板块调用K线API，分批防限流）
      注意：初始化不采集资金流，资金流从每日采集开始逐日积累
```

**防限流策略**（K线历史采集专用）：
- 随机打乱板块顺序，避免固定请求模式
- 分批处理：每批30个，批间10-20s + 重建浏览器页面
- 单板块间隔 2-4s 随机延迟
- 熔断机制：连续失败10次中断当前批次
- 长退避：失败3次后重建页面 + 8-15s延迟

**交易日判断**：
- UTC+8 判断 `weekday() < 5` 排除周末
- `FORCE_RUN=1` 可强制在非交易日运行
- 不处理节假日（容忍少量空跑）

### 2.2 Phase 2：评分引擎

**目标**：基于采集数据，每日对全市场板块进行6维度综合评分，输出推荐/风险板块。

**主流程**（`scoring.py`）：

```
[1/7] 查询数据
      │ sector_daily 近60天（约40个交易日）
      │ limitUpReasons 当日（涨停原因 + 板块涨停数）
      │ dailyReview 当日（市场情绪 + 龙虎榜）
      │ sector_rotation_map 全量（产业链关联）
      │ sector_master（龙头股映射）
      │
[2/7] 市场环境分级
      │ 根据涨停数+炸板率 → strong/neutral/weak/extreme
      │ 决定推荐板块上限数量
      │
[3/7] 复盘回填
      │ 查昨日推荐(strong_buy/buy)的板块
      │ 从今日 sector_daily 读实际涨跌幅
      │ 回填 next_day_actual + prediction_hit
      │
[4/7] 准备全市场基准
      │ 收集全市场当日资金流 → 用于百分位排名
      │ 计算全市场3日加权趋势 → 用于趋势分百分位
      │
[5/7] 逐板块6维评分
      │ 每个板块独立计算6个维度 + 龙头加分
      │ 加权汇总 total_score
      │ 判断生命周期阶段
      │ 计算置信度
      │
[6/7] 排序 + 信号分档 + 风险识别
      │ 按 total_score 降序排名
      │ 分档: strong_buy / buy / watch / avoid
      │ 风险: 分歧/退潮期 + 连续流出 → signal=risk
      │
[7/7] 写入 sector_scores
      │ 删除当日已有记录 → 批量 insert
      │ 带重试（3次，间隔2s）
```

**信号分档规则**：

| 信号 | 条件 |
|------|------|
| strong_buy | TOP 5% 且 score ≥ 70 |
| buy | TOP 15% 且 score ≥ 55 |
| watch | TOP 40% |
| avoid | 其余 |
| risk | 分歧/退潮期 且 连续≥2日主力流出（覆盖原信号） |

**市场环境分级**（`market_env.py`）：

| 等级 | 条件 | 推荐上限 |
|------|------|----------|
| strong | 涨停>50 且 炸板率<20% | 10 |
| neutral | 默认 | 5 |
| weak | 涨停<20 且 炸板率>40% | 3 |
| extreme | 跌停>30 | 1 |

**板块生命周期**（`lifecycle.py`）：

| 阶段 | 判断条件 |
|------|----------|
| 萌芽 | 涨停≤2 且 主力刚转为净流入 且 涨幅<2% |
| 发酵 | 涨停3-5 且 成交量放大>50% 且 连涨2-4天 |
| 主升 | 涨停>5 或 累计5日涨幅>5% 且 成交额创近期新高 |
| 分歧 | 振幅>5% 且 换手率骤增>50% |
| 退潮 | 连续2天主力净流出 且 今日下跌 且 近5日上涨≤2天 |

判断顺序：退潮 → 分歧 → 主升 → 发酵 → 萌芽（优先匹配严重阶段）。无法判断时返回空字符串。

**置信度计算**：
各维度得分归一化到 0-1（除以80封顶），按权重加权求和。反映评分的可靠程度，得分越高且多维度同时高分时置信度越大。

**复盘闭环**（`backfill.py`）：
每天评分前先回填昨日预测。查 sector_scores 昨日 signal=strong_buy/buy → 从 sector_daily 读今日实际 change_pct → 回填 next_day_actual + prediction_hit（涨幅>0 = 命中）。命中率展示在推送末尾。

### 2.3 推送

`push-scores.ts` 读取当日 sector_scores，格式化为 Markdown 推送到微信：

- 标题：`📊 日期 板块机会｜市场环境 TOP1板块 分数`
- 强势推荐：表格（板块/总分/阶段/资金/情绪/政策/技术/龙头）
- 关注观察：前5名 watch 板块
- 风险板块：前5名 risk 板块及原因
- 市场概况：各信号数量 + 分数分布 + 昨日命中率

样式参考每日复盘（`━━━` 分隔线 + `▸` 列表 + `_斜体_` 强调）。

---

## 三、取数逻辑

### 3.1 Phase 1：东财数据接口

#### 板块列表（`sector_list.py`）

- **接口**：`push2.eastmoney.com` JSONP
- **请求方式**：Playwright `page.evaluate()` 发 JSONP 请求
- **分页**：每页100个，循环直到拉完
- **过滤**：排除筛选类板块（新高/新低/预增/大盘股/中报/年报等）
- **返回字段**：

| 东财字段 | 含义 | 存储字段 |
|---------|------|---------|
| f12 | 板块代码 | bk_code |
| f14 | 板块名称 | name |
| f3 | 涨跌幅 | change_pct |
| f17/f2/f15/f16 | 开/收/高/低 | open/close/high/low |
| f5/f6 | 成交量/额 | volume/turnover |
| f7/f8 | 振幅/换手率 | amplitude/turnover_rate |
| f128 | 龙头股 | leading_stock |

- **当日K线**：板块列表API自带当日OHLCV，直接写入 sector_daily，替代逐板块调用K线API（避免限流）

#### 历史K线（`sector_kline.py`）

- **接口**：`push2his.eastmoney.com` JSONP
- **参数**：板块代码 + 周期(daily) + 天数
- **限流严格**：需要分批 + 延迟 + 熔断策略
- **仅初始化使用**：日常采集用板块列表API的当日数据即可
- **返回格式**：`"日期,开盘,收盘,最高,最低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"`

#### 资金流（`sector_fund_flow.py`）

- **接口**：`push2.eastmoney.com` 资金流排名 JSONP
- **一次调用返回全部板块**：无需逐板块请求
- **按板块名匹配**：与 sector_daily 已有记录匹配后 update 资金流字段
- **返回字段**：

| 东财字段 | 含义 | 存储字段 |
|---------|------|---------|
| f62 | 主力净流入 | main_net_inflow |
| f184 | 主力净流入% | main_net_inflow_pct |
| f66/f69 | 超大单净额/% | super_large_net |
| f72/f75 | 大单净额/% | large_net |
| f78/f81 | 中单净额/% | medium_net |
| f84/f87 | 小单净额/% | small_net |
| f204 | 龙头股 | fund_leading_stock |

### 3.2 Phase 2：评分数据查询

#### scoring.py 数据获取

| 数据 | 来源表 | 查询条件 | 用途 |
|------|--------|----------|------|
| K线+资金流 | sector_daily | 近60天，按 trade_date ASC | 全部6个维度 |
| 涨停原因 | limitUpReasons | 当日 pick_date | 情绪面（涨停集中度/连板）+ 龙头映射 |
| 每日复盘 | dailyReview | 当日 report_date | 市场环境（涨停数/炸板率）+ 龙虎榜 |
| 板块关联 | sector_rotation_map | 全量 | 轮动评分（上下游传导） |
| 龙头股 | sector_master | is_active=true | 龙头映射评分 |

#### policy_scorer.py 新闻查询

| 数据 | 来源表 | 查询条件 | 用途 |
|------|--------|----------|------|
| 新闻 | newsItems_cls | 近3天（published_at >= 3天前UTC毫秒） | 关键词匹配 + Claude NLP |

分页查询（每页500条），按 published_at DESC 排序。

#### backfill.py 复盘查询

| 数据 | 来源表 | 查询条件 | 用途 |
|------|--------|----------|------|
| 昨日推荐 | sector_scores | 昨日 + signal in (strong_buy, buy) | 找到要回填的记录 |
| 今日实际 | sector_daily | 今日 + 对应板块名 | 读取 change_pct 作为实际值 |

---

## 四、计算逻辑

### 4.1 Phase 1：数据写入

Phase 1 不涉及复杂计算，核心逻辑是 **upsert**：

- **sector_master**：新板块 insert，已存在 update（change_pct/leading_stock/updated_at），消失的标记 is_active=False
- **sector_daily K线**：按 (sector_name, trade_date) upsert，update 时只覆盖K线字段，保留资金流字段
- **sector_daily 资金流**：按板块名匹配已有记录 update 资金流字段，无记录则 insert 新行

### 4.2 Phase 2：6维评分算法

**总分公式**：
```
total = fund×0.30 + sentiment×0.25 + policy×0.25 + tech×0.15 + rotation×0.05 + leader_bonus
```

各维度独立评分 0-100，leader_bonus 为 0-10 直接加分。

#### 4.2.1 资金面（30%）— `fund_scorer.py`

输入：该板块近N天 sector_daily + 全市场当日资金流列表 + 全市场3日趋势列表

| 子因子 | 满分 | 计算方法 |
|--------|------|----------|
| 当日主力净流入排名 | 30 | 取 main_net_inflow，在全市场列表中算百分位 × 30 |
| 3日净流入趋势 | 25 | 加权和 = T×0.5 + T-1×0.3 + T-2×0.2，在全市场同口径趋势列表中算百分位 × 25。无趋势列表时 fallback 到当日流入百分位 |
| 主力净流入占比 | 20 | main_net_inflow_pct / 5% × 20，封顶20 |
| 超大单占比 | 15 | abs(super_large_net) / turnover × 100 / 3% × 15，封顶15 |
| 连续流入天数 | 10 | 从最后一天往回数连续 main_net_inflow > 0 的天数 × 2，封顶10 |

额外输出 consecutive_outflow_days（连续流出天数），供风险识别使用。

**百分位函数**：`below_count / total_count × max_pts`

#### 4.2.2 情绪面（25%）— `sentiment_scorer.py`

输入：板块名 + sector_daily + limitUpReasons + market_sentiment

| 子因子 | 满分 | 计算方法 |
|--------|------|----------|
| 涨停集中度 | 35 | 该板块涨停数 / 全市场涨停总数（取 dailyReview.market_sentiment.limit_up 作为分母），/ 15% × 35 |
| 连板强度 | 25 | 从 limitUpReasons.themes 匹配该板块，解析 "N天N板" 格式。最高板数×5 + 连板股数×3，封顶25 |
| 涨幅连续性 | 20 | 近5日上涨天数 / 5 × 20 |
| 板块情绪质量 | 20 | 涨幅/振幅比（坚决度）× 15 + 市场炸板率修正±5，封顶20 |

**板块名匹配规则**（`_match_theme`）：
- 去掉"概念""板块"后缀后比较
- 完全相同 → 匹配
- 短名称（≤2字如"电力"）→ 只接受精确匹配，不做子串
- 长名称 → 允许子串匹配（一方包含另一方）

#### 4.2.3 政策/事件面（25%）— `policy_scorer.py`

输入：Supabase 客户端 + 板块名列表。内部自行查询 newsItems_cls。

| 子因子 | 满分 | 计算方法 |
|--------|------|----------|
| 相关新闻数量 | 30 | 近3天新闻标题+摘要关键词匹配该板块，命中数 / 5 × 30，封顶30 |
| 新闻等级权重 | 30 | A级×3 + B级×1 累加，/ 10 × 30，封顶30 |
| Claude NLP 解读 | 40 | Claude 返回 0-100（50中性），映射: (raw-50)/50×40+20，封顶40。未被评估的板块得 0 分 |

**Claude NLP 流程**：
1. 关键词匹配筛出有新闻关联的板块（~50-60个）
2. 选取新闻：优先全部A级，剩余额度补B级，上限60条
3. 一次 Claude API 调用：输入新闻列表 + 待评估板块列表 → 输出 JSON `{板块名: 分数}`
4. Claude 只返回受影响的板块（非50分的），其余不在结果中的板块 NLP 分为 0

**关键词匹配规则**（`_keyword_match`）：
- 短名称（≤2字）→ 要求完整板块名出现在文本中
- 长名称 → 去"概念"后子串匹配

#### 4.2.4 技术面（15%）— `tech_scorer.py`

输入：该板块近20天 sector_daily

| 子因子 | 满分 | 计算方法 |
|--------|------|----------|
| MA5/MA10 位置 | 25 | close > MA5 > MA10 → 25（多头排列）；close > MA5 → 18；close > MA10 → 12；close > MA5×0.98 → 6；否则0 |
| 5日动量 | 25 | (today_close - close_5d_ago) / close_5d_ago × 100 → 百分比。0-5% 线性映射到 0-25，>5% 满分，<0 为0 |
| 振幅收敛 | 20 | ratio = 5日振幅均值 / 20日振幅均值。ratio≤0.6 → 20（蓄势）；0.6-1.2 线性递减；>1.2 → 0 |
| 距20日低点位置 | 15 | position = (close - low20d) / (high20d - low20d)。0.2-0.6 → 15（底部起飞区间）；<0.2 线性到12；>0.6 线性递减到0 |
| 量能配合 | 15 | ratio = 3日均量 / 10日均量。1.2-2.0 → 15；<1.2 线性到12；>2.0（过热）递减 |

#### 4.2.5 轮动规律（5%）— `rotation_scorer.py`

输入：板块名 + sector_rotation_map + 全市场 daily_by_sector

| 子因子 | 满分 | 计算方法 |
|--------|------|----------|
| 上游板块昨日表现 | 50 | 查 rotation_map 中以该板块为 target 的上游板块。上游昨日涨幅>2%时：min(涨幅/5%, 1) × 50 × weight。多个上游累加，封顶50 |
| 历史跟涨概率 | 50 | 统计近60天：上游涨>2%的日子，该板块次日涨(>0)的概率。要求≥3个样本才纳入。多个上游取加权平均 × 50 |

**名称匹配**：rotation_map 中的板块名可能不带"概念"后缀，支持模糊匹配。

#### 4.2.6 龙头映射（加分 0-10）— `leader_scorer.py`

输入：板块名 + sector_master.leading_stock + limitUpReasons + dragon_tiger

**龙头股确定**：优先从 limitUpReasons 中找该板块连板最高的股票，找不到则 fallback 到 sector_master.leading_stock（当日涨幅最大股）。

| 条件 | 加分 | 判断方法 |
|------|------|----------|
| 龙头股涨停 | +5 | 在 limitUpReasons 全部 themes 的 stocks 中找到该股 |
| 龙头股连板≥2 | +3 | 解析 board 字段 "N天N板" 格式，N≥2 |
| 龙头股上龙虎榜 | +2 | 在 dailyReview.dragon_tiger 列表中找到该股名 |

### 4.3 Phase 2：辅助计算

#### 生命周期判断（`lifecycle.py`）

输入：sector_daily 近10天 + 涨停数 + 最高连板数

按优先级顺序判断（先到先返回）：

```
退潮：连续2天主力净流出 且 今日下跌 且 近5日上涨≤2天
分歧：今日振幅>5% 且 近2日换手率 > 前3日换手率×1.5
主升：涨停>5 或 (累计5日涨幅>5% 且 今日成交额≥近10日最高×0.9)
发酵：涨停3-5 或 (成交量放大>50% 且 上涨2-4天)
萌芽：涨停≤2 且 今日涨幅0-2% 且 最近一天主力净流入>0
默认：空字符串（无法判断）
```

#### 置信度计算

```python
confidence = sum(min(score/80, 1.0) * weight for score, weight in dimensions) / sum(weights)
```

每个维度得分归一化（/80封顶1.0）后按权重加权。多维度同时高分时置信度高。

#### 风险板块识别

遍历所有评分结果，满足以下条件标记为 risk：
- stage 为"分歧"或"退潮"
- fund_detail.consecutive_outflow_days ≥ 2

risk 信号会覆盖原有的 signal（如原本是 watch 的板块被改为 risk）。

---

## 五、Workflow 集成

`sector-daily.yml` 完整流程：

```yaml
# Phase 1：数据采集
- name: 安装 Python 依赖 + Playwright
- name: 运行数据采集
  run: python main.py 或 init_master.py  # 取决于 mode

# Phase 2：评分（仅 daily 模式）
- name: 安装评分依赖 (httpx)
- name: 运行评分
  run: python scoring.py
  env: SUPABASE + ANTHROPIC

# Phase 2：推送（仅 daily 模式）
- name: Setup Node.js
- name: 推送评分结果
  run: npx tsx push-scores.ts
  env: SUPABASE + WXPUSHER

# 告警
- name: Bark 失败通知
  if: failure()
```

cron-job.org 任务名：`板块评分(K线资金采集→6维评分→WxPusher推送)`
