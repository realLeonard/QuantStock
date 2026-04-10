# 每日复盘 — 需求文档

> 版本：v1.0
> 日期：2026-04-10
> 状态：需求确认完毕，待开发

## 一、概述

每个交易日 17:00（北京时间）自动采集 A 股收盘数据，生成每日复盘报告，写入数据库并通过 WxPusher 推送到微信。后台新增"每日复盘"菜单页展示报告详情。

## 二、10 个数据模块

### 模块1：大盘概览

市场全局温度计，包含指数、资金、量能三个维度。

**指数行情：**

| 字段 | 说明 |
|------|------|
| 指数名称 | 上证指数、深证成指、创业板指、科创50、恒生指数 |
| 收盘价 | 当日收盘 |
| 涨跌幅% | 当日涨跌 |
| 成交额（亿） | 当日成交金额（恒生可不填） |

**资金面：**

| 字段 | 说明 |
|------|------|
| 北向资金今日净流入（亿） | 沪股通 + 深股通合计 |
| 北向资金近5日累计（亿） | 判断持续性，区分单日脉冲 vs 连续流入 |
| 融资余额（亿） | 两市融资余额 |
| 融资余额变化（亿） | 较前一日增减 |
| 融资解读 | 由 AI 总结模块结合大盘、资金流向动态生成 |

**量能趋势：**

| 字段 | 说明 |
|------|------|
| 今日两市成交额（亿） | 沪 + 深合计 |
| 5日均量（亿） | 近5个交易日平均成交额 |
| 量能变化% | 较5日均量的变化百分比（放量/缩量判断） |

### 模块2：市场情绪指标

多空力量对比，衡量赚钱效应。

| 字段 | 说明 |
|------|------|
| 上涨家数 | 当日上涨个股数 |
| 下跌家数 | 当日下跌个股数 |
| 涨停数（非ST） | 当日涨停个股数 |
| 跌停数（非ST） | 当日跌停个股数 |
| 炸板数 | 盘中涨停后打开的个股数 |
| 炸板率% | 炸板数 / (涨停数 + 炸板数) |
| 涨幅>7% | 强势股数量 |
| 跌幅>7% | 弱势股数量 |

### 模块3：近期热门股 TOP20

东方财富人气榜前20只，反映市场关注焦点。

| 字段 | 说明 |
|------|------|
| 排名 | 热度排名序号 |
| 代码 | 股票代码 |
| 名称 | 股票名称 |
| 现价 | 最新价 |
| 涨幅% | 当日涨跌幅 |
| 换手率% | 当日换手率 |

**数据源：** `stock_hot_rank_em()`

### 模块4：连板天梯

连续涨停个股排名，体现市场最强主线。

| 字段 | 说明 |
|------|------|
| 代码 | 股票代码 |
| 名称 | 股票名称 |
| 现价 | 最新价 |
| 涨幅% | 当日涨跌幅 |
| 连板数 | 连续涨停天数（降序排列） |
| 主要行业 | 最多3个行业标签 |

**数据源：** akshare 连板数据接口

### 模块5：龙虎榜明细

当日全部上榜个股，揭示主力资金动向。

| 字段 | 说明 |
|------|------|
| 代码 | 股票代码 |
| 名称 | 股票名称 |
| 涨幅% | 当日涨跌幅 |
| 买入额（万） | 龙虎榜买入合计 |
| 卖出额（万） | 龙虎榜卖出合计 |
| 净额（万） | 买入 - 卖出 |
| 上榜原因 | 如"日涨幅偏离值达7%"等 |

**数据源：** akshare 龙虎榜接口
**不含营业部明细**，只展示汇总金额。

### 模块6：行业分布统计（聚合）

将模块3（热门股）+ 模块4（连板）+ 模块5（龙虎榜）按行业合并统计。

| 字段 | 说明 |
|------|------|
| 行业 | 行业名称 |
| 热门股数 | 来自模块3的个股数量 |
| 连板股数 | 来自模块4的个股数量 |
| 龙虎榜数 | 来自模块5的个股数量 |
| 合计 | 三项之和（降序排列） |
| 代表个股 | 列出个股名称，龙虎榜来源加🔥标识 |

### 模块7：涨跌停行业分布

按行业维度统计当日涨停和跌停个股分布。

| 字段 | 说明 |
|------|------|
| 行业 | 行业名称 |
| 涨停数 | 该行业当日涨停个股数（降序排列） |
| 跌停数 | 该行业当日跌停个股数 |
| 涨停代表股 | 3-5只，按涨停时间最早排序 |
| 跌停代表股 | 3-5只（如有） |

**数据源：** `stock_zt_pool_em()` / `stock_dt_pool_em()`

### 模块8：板块资金流向 TOP10

| 字段 | 说明 |
|------|------|
| 板块名称 | 行业/概念板块 |
| 今日净额（亿） | 正 = 流入，负 = 流出 |
| 代表个股 | 3-5只，按该板块内净流入金额降序 |
| 10日流入天数 | 近10个交易日中净流入的天数 |

**排列方式：** 先列10大流入板块，再列10大流出板块。

### 模块9：个股资金流向 TOP10

| 字段 | 说明 |
|------|------|
| 代码 | 股票代码 |
| 名称 | 股票名称 |
| 今日净额（亿） | 正 = 流入，负 = 流出 |
| 涨幅% | 当日涨跌幅 |
| 10日流入天数 | 近10个交易日中净流入的天数 |

**排列方式：** 先列10大流入个股，再列10大流出个股。

### 模块10：AI 复盘总结

| 项 | 说明 |
|----|------|
| 模型 | Claude Opus |
| 输入 | 模块1-9全部结构化数据 |
| 风格 | 完整复盘分析，不是简单2-3句话 |

**输出结构参考：**

```
【大盘】指数表现、量能变化、关键支撑/压力位...
【资金】北向资金动向、融资余额趋势解读、内外资是否共振...
【主线】当日最强主线板块、连板高度、板块持续性分析...
【情绪】涨跌停数据解读、炸板率含义、赚钱效应强弱...
【龙虎榜】主力资金重点介入/撤离的方向...
【资金流向】板块和个股资金流向趋势、10日持续性分析...
【关注】明日重点观察方向、风险提示...
```

## 三、数据库设计

### 表名：`dailyReview`

```sql
CREATE TABLE "dailyReview" (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL UNIQUE,          -- "2026-04-10"
  market_overview JSONB,                     -- 模块1: 大盘概览（指数+资金+量能）
  market_sentiment JSONB,                    -- 模块2: 市场情绪指标
  hot_stocks JSONB,                          -- 模块3: 热门股 TOP20
  limit_up_ladder JSONB,                     -- 模块4: 连板天梯
  dragon_tiger JSONB,                        -- 模块5: 龙虎榜明细
  industry_distribution JSONB,               -- 模块6: 行业分布统计（聚合）
  limit_industry_distribution JSONB,         -- 模块7: 涨跌停行业分布
  sector_fund_flow JSONB,                    -- 模块8: 板块资金流向
  stock_fund_flow JSONB,                     -- 模块9: 个股资金流向
  ai_summary TEXT,                           -- 模块10: AI 复盘总结
  status TEXT DEFAULT 'success',             -- success / partial / failed
  created_at BIGINT NOT NULL                 -- UTC 毫秒
);

-- RLS 策略
ALTER TABLE "dailyReview" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow read" ON "dailyReview"
  FOR SELECT USING (true);

CREATE POLICY "allow insert" ON "dailyReview"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "allow update" ON "dailyReview"
  FOR UPDATE USING (true);

CREATE POLICY "allow delete" ON "dailyReview"
  FOR DELETE USING (true);
```

### JSONB 字段结构示例

```jsonc
// market_overview
{
  "indices": [
    { "name": "上证指数", "close": 3256.78, "change_pct": 1.23, "amount": 5432.1 },
    { "name": "恒生指数", "close": 21345.67, "change_pct": -0.45, "amount": null }
  ],
  "north_bound": {
    "today": 82.3,
    "recent_5d": 156.7
  },
  "margin": {
    "balance": 18523.4,
    "change": 45.2
  },
  "volume": {
    "today": 10234.5,
    "avg_5d": 9876.3,
    "change_pct": 3.63
  }
}

// market_sentiment
{
  "up_count": 3456,
  "down_count": 1234,
  "limit_up": 67,
  "limit_down": 12,
  "broken_limit": 15,
  "broken_rate": 18.29,
  "strong_stocks": 89,
  "weak_stocks": 23
}

// hot_stocks
[
  { "rank": 1, "code": "600519", "name": "贵州茅台", "price": 1680.5, "change_pct": 2.3, "turnover_rate": 0.8 }
]

// limit_up_ladder
[
  { "code": "000001", "name": "XX股份", "price": 15.6, "change_pct": 10.02, "continuous_limit": 5, "industries": ["半导体", "芯片", "科技"] }
]

// dragon_tiger
[
  { "code": "000001", "name": "XX股份", "change_pct": 9.98, "buy_amount": 12345.6, "sell_amount": 6789.0, "net_amount": 5556.6, "reason": "日涨幅偏离值达7%" }
]

// industry_distribution
[
  { "industry": "半导体", "hot_count": 3, "limit_count": 2, "dragon_count": 1, "total": 6, "top_stocks": ["中芯国际", "北方华创🔥", "韦尔股份"] }
]

// limit_industry_distribution
[
  { "industry": "半导体", "limit_up_count": 5, "limit_down_count": 0, "limit_up_stocks": ["XX股份", "YY科技", "ZZ电子"], "limit_down_stocks": [] }
]

// sector_fund_flow
{
  "inflow": [
    { "sector": "半导体", "net_amount": 12.5, "top_stocks": ["中芯国际", "北方华创", "韦尔股份"], "inflow_days_10": 7 }
  ],
  "outflow": [
    { "sector": "房地产", "net_amount": -8.3, "top_stocks": ["万科A", "保利发展", "招商蛇口"], "inflow_days_10": 3 }
  ]
}

// stock_fund_flow
{
  "inflow": [
    { "code": "600519", "name": "贵州茅台", "net_amount": 5.6, "change_pct": 2.3, "inflow_days_10": 8 }
  ],
  "outflow": [
    { "code": "000001", "name": "平安银行", "net_amount": -3.2, "change_pct": -1.5, "inflow_days_10": 2 }
  ]
}
```

## 四、技术方案

### 整体流程

```
cron-job.org (17:00 北京时间触发)
  │
  ▼
GitHub Actions (workflow_dispatch)
  │
  ▼
Python 脚本 (akshare 采集模块1-9数据)
  │
  ├──▶ 写入 Supabase dailyReview 表 (结构化 JSONB)
  │
  ▼
TypeScript 脚本
  ├──▶ 读取 dailyReview 数据 → 调用 Claude Opus → 生成 AI 总结 → 回写 ai_summary
  │
  └──▶ 渲染 Markdown 全量内容 → WxPusher 推送到微信

Web 后台
  └──▶ "每日复盘" 菜单页 → 读 dailyReview → 表格渲染
```

### 数据源（akshare）

| 模块 | akshare 接口 | 说明 |
|------|-------------|------|
| 大盘指数 | `stock_zh_index_daily_em()` | 上证/深证/创业板/科创50 |
| 恒生指数 | `stock_hk_index_daily_em()` | 恒生指数 |
| 北向资金 | `stock_hsgt_north_net_flow_in_em()` | 沪深港通资金流 |
| 融资余额 | `stock_margin_sse()` + `stock_margin_szse()` | 两市融资余额 |
| 成交额 | 从指数数据中获取 | 沪深合计 |
| 市场情绪 | `stock_zt_pool_em()` / `stock_dt_pool_em()` | 涨跌停池 |
| 热门股 | `stock_hot_rank_em()` | 东方财富人气榜 |
| 连板 | `stock_zt_pool_em()` 连板字段 | 连续涨停 |
| 龙虎榜 | `stock_lhb_detail_em()` | 龙虎榜明细 |
| 板块资金 | `stock_fund_flow_industry()` | 行业板块资金流 |
| 个股资金 | `stock_fund_flow_individual()` | 个股资金流 |

### 复用现有设施

| 已有 | 复用方式 |
|------|---------|
| `scripts/zaobao/notify.ts` | 复用 `sendWxPush()` 函数 |
| `.github/workflows/zaobao.yml` | 参考结构新建 `daily-review.yml` |
| cron-job.org | 新增一个 17:00 触发任务 |
| GitHub Secrets | WxPusher token/uid 已配好，直接复用 |
| Claude API 代理 | `ANTHROPIC_BASE_URL` 已配好 |

### WxPusher 推送

- **推送内容：** 全量推送10个模块（后续可简化）
- **格式：** Markdown（contentType: 3）
- **复用：** `scripts/zaobao/notify.ts` 的 `sendWxPush()` 函数
- **配置：**
  - Token: `AT_ZwHJFTB6epjY2bxftdHzf0DtRsm3JvRs`
  - UID: `UID_fbyM7USUtlBiPrvLeBbmQJDmuEzh`

## 五、后台页面

### 菜单名称：每日复盘

### 页面结构

- **顶部**：日期选择器（默认当天），左右箭头切换日期
- **内容区**：10个模块按 Tab 或折叠面板展示
- **每个模块**：渲染为表格，支持排序
- **模块6和7**：可加简单柱状图（行业分布可视化，后续迭代）
- **模块10**：Markdown 渲染的 AI 总结文本

### 导航接入（四处必改）

1. `store/index.ts` — NavItem 类型 + state/action
2. `AdminLayout.tsx` — handleNav 数据加载
3. `AdminLayout.tsx` — Topbar 面包屑
4. `AdminLayout.tsx` — 侧边栏菜单项

## 六、开发顺序

1. ✅ 需求文档写入 `docs/daily-review.md`
2. ⬜ Python 采集脚本（`scripts/daily-review/`）
3. ⬜ Supabase 建表 + RLS（提供 SQL 让用户执行）
4. ⬜ 后台"每日复盘"页面
5. ⬜ TypeScript AI 总结 + WxPusher 推送脚本
6. ⬜ GitHub Actions workflow（`daily-review.yml`）
7. ⬜ cron-job.org 配置 17:00 触发

## 七、后续可扩展

| 功能 | 说明 | 优先级 |
|------|------|--------|
| ETF 份额变化 | 沪深300/科创50 ETF 份额增减，反映机构态度 | 中 |
| 大宗交易 | 折价/溢价率，机构暗中建仓信号 | 低 |
| 次日重要事件 | 经济数据发布、新股申购等 | 中 |
| WxPusher 推送简化 | 只推关键摘要，详情去 APP 查看 | 中 |
| APP 端展示 | uni-app 移动端原生渲染 | 后续 |
