# 每日早报系统设计文档

## 系统概述

面向 A 股投资者的每日投资早报系统。每天早上 08:20 自动生成，通过 QuantStock 网页展示 + WxPusher 推送微信。

---

## 报告结构（确认版）

```
📰 投资早报  YYYY-MM-DD  08:20

━━━ 今日一句话 ━━━
一句话概括今日市场基调和操作方向

━━━ 今日必须知道的N件事（1-5条弹性）━━━
🔴 [重大事件] → 影响板块 + 操作建议
🟡 [中等事件] → 影响说明
⚪ [参考事件] → 简要说明

━━━ 今日情绪与资金预判 ━━━
北向资金：预计流入/流出
板块资金重心：XXX > XXX > XXX

━━━ 昨日预判验证（能做则做，不准确可去掉）━━━
✅/❌ 昨日预判 → 实际结果

[维度N] XXX                    🔴/🟡/⚪ 今日影响
（动态排序，按今日影响力从高到低）
（无重要事件的维度折叠为一行）

今日无重要事件：[维度名] [维度名]

━━━ 今日操作指引 ━━━
🎯 重点关注板块：XXX（原因）
⚠️  回避或谨慎：XXX（原因）
📌 开盘注意：XXX
```

---

## 七维度完整框架

### 第一维度：外部冲击
**包含内容：**
- 地缘政治（冲突、制裁、外交事件）
- 国际经济（贸易、汇率、全球供应链）
- 能源与资源（油价、天然气、铁矿石）
- 国际组织决议（WTO、IMF、G20）
- **大宗商品产业链价格**：猪价、钢价、煤价、稀土、锂盐等

**输出格式：**
- 发生了什么
- 影响哪些板块
- 短期还是中长期影响

---

### 第二维度：国内政策面
**包含内容：**
- 顶层设计（国务院、两会、中央经济工作会议精神）
- 产业政策（新能源、半导体、消费等专项政策）
- 监管动态（证监会、银保监、工信部等）
- 财政政策（专项债、税收优惠、财政支出）
- 货币政策（降准降息、LPR调整）
- **今日流动性操作**：央行逆回购净投放/净回笼、DR007利率

**输出格式：**
- 政策核心条款
- 受益板块
- 落地时间表
- 今日资金面松紧

---

### 第三维度：宏观数据
**包含内容：**

国内数据：
- GDP、CPI、PPI、PMI（制造业 + 服务业）
- 社融、M1/M2、信贷数据
- 进出口数据、外汇储备

国际数据：
- 美国 CPI、PPI、非农就业
- 美联储利率决议、FOMC 会议纪要
- 欧元区 PMI、英国 GDP

**输出格式：**
- 数据表现（超预期 / 符合预期 / 不及预期）
- 市场风格影响（成长 vs 价值，大盘 vs 小盘）
- 板块利好利空

---

### 第四维度：技术与产业事件
**包含内容：**
- 技术突破（AI、半导体、新能源、生物医药）
- 行业大会（世界互联网大会、CES、MWC 等）
- 商业进展：
  - 大额订单签署
  - 重要产品发布
  - 企业合作/战略投资
  - 业绩超预期

**输出格式：**
- 催化强度（强 / 中 / 弱）
- 受益板块和标的
- 短期还是中长期驱动

---

### 第五维度：领军人物与公司事件
**包含内容：**
- 领军人物动向（马斯克、黄仁勋、任正非等）
- 公司重要发布会（苹果、英伟达、特斯拉等）
- **财报日历**：
  - 今日 / 本周重要财报
  - 业绩预期 vs 实际（超预期 / 不及预期）

**输出格式：**
- 人物 / 公司 / 事件
- 影响板块
- 市场预期对比
- 持续性判断

---

### 第六维度：国内市场结构
**包含内容：**
- 板块轮动（昨日领涨 → 今日预判）
- 风格切换（大盘 / 小盘、成长 / 价值）
- **融资余额变化**（较前日增减）
- **期权 PCR 值**（Put/Call Ratio，情绪指标）
- **连板晋级率**（昨日二连板晋三板成功率）
- **机构调研动态**：近3日密集调研标的
- **解禁与减持日历**：本周重要解禁 / 减持计划

**输出格式：**
- 市场主线
- 市场风格
- 资金迁移方向
- 市场情绪（贪婪 / 恐惧指数）
- 解禁风险预警

---

### 第七维度：外盘市场结构
**包含内容：**
- 美股三大指数（道琼斯、纳斯达克、标普500）
- 纳斯达克热门板块（AI芯片、云计算、生物科技）
- 重要期货（原油、黄金、铜、铁矿石）
- **港股动态**：
  - 南向资金流向（港股通净买入）
  - AH 溢价指数

**输出格式：**
- 资金主线
- 热门板块
- 期货对 A 股的影响
- 港股先行信号

---

## 特殊规则

- **非交易日**（周末 / 节假日）出「本周展望 / 下周预判」版本
- **维度顺序**按今日影响力动态排序，不固定
- 「包含内容」是引导思考方向，不是限制范围，Claude 应主动纳入相关内容
- 无重要事件的维度折叠为一行展示

---

## 技术架构

```
Python 数据采集层（每日 07:00 定时）
  akshare      → A股：涨停家数、北向资金、融资余额、机构调研、解禁日历
  yfinance     → 美股三大指数、纳斯达克板块、原油/黄金/铜期货、港股
  RSS 解析     → 财联社、新华社财经、华尔街见闻、36氪、路透中文
  ↓ 全部写入 Supabase rawMarketData 表

TypeScript 报告生成层（每日 07:30）
  读取 Supabase 原始数据
  调用 Claude API（Sonnet 4.6）生成七维度报告
  存入 dailyReport 表
  WxPusher 推送微信
```

---

## 数据库表结构

### dailyReport 表
```sql
CREATE TABLE "dailyReport" (
  id          TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  report_type TEXT NOT NULL,        -- 'trading' | 'weekly'
  content     TEXT NOT NULL,        -- 完整报告 Markdown
  summary     TEXT NOT NULL,        -- 今日一句话
  created_at  BIGINT NOT NULL       -- UTC 毫秒
);
CREATE UNIQUE INDEX ON "dailyReport"(report_date);
```

### rawMarketData 表
```sql
CREATE TABLE "rawMarketData" (
  id          TEXT PRIMARY KEY,
  data_date   TEXT NOT NULL,        -- 'YYYY-MM-DD'
  data_type   TEXT NOT NULL,        -- 'a_share' | 'intl_market' | 'news'
  source      TEXT NOT NULL,        -- 'akshare' | 'yfinance' | 'rss_cailian'
  payload     JSONB NOT NULL,       -- 原始数据
  created_at  BIGINT NOT NULL
);
```

---

## 文件结构

```
scripts/zaobao/
├── python/
│   ├── fetchers/
│   │   ├── akshare_fetcher.py    # A股行情数据采集
│   │   ├── yfinance_fetcher.py   # 国际市场数据采集
│   │   └── rss_fetcher.py        # RSS 新闻采集
│   ├── main.py                   # 采集入口
│   └── requirements.txt          # Python 依赖
├── generate.ts                   # 读取原始数据，调 Claude API 生成报告
├── notify.ts                     # WxPusher 推送
├── prompts.ts                    # Claude 提示词模板
└── index.ts                      # 入口，判断交易日/非交易日

apps/web/components/zaobao/
├── ZaobaoView.tsx                # 早报列表页
├── ZaobaoDetail.tsx              # 早报详情页
├── ZaobaoView.module.css
└── ZaobaoDetail.module.css
```

---

## 执行顺序

1. 在 Supabase SQL Editor 执行 `scripts/zaobao-tables.sql` 建表
2. 更新 `packages/types` 新增 DailyReport 类型
3. 更新 `packages/api-client` 新增报告 CRUD
4. 配置环境变量（`.env.local` 新增 `ANTHROPIC_API_KEY`、`WXPUSHER_TOKEN`）
5. 执行 `python scripts/zaobao/python/main.py` 测试数据采集
6. 执行 `npx tsx scripts/zaobao/index.ts` 测试报告生成
7. 打开 QuantStock 网页，确认早报页面展示正常
8. 确认微信 WxPusher 推送正常

---

## 环境变量

| 变量名 | 说明 | 位置 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | Claude API 密钥 | `apps/web/.env.local` / GitHub Secrets |
| `WXPUSHER_TOKEN` | WxPusher 应用 Token | 同上 |
| `WXPUSHER_UID` | WxPusher 用户 UID | 同上 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 同上 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | 同上 |
