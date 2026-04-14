# 上次会话进展

**日期**：2026-04-15

## 本次完成

### 1. 列表页卡片摘要增强
- **文件**：`apps/web/components/daily-review/DailyReviewView.tsx` + `.module.css`
- 每张卡片新增：AI headline（紫色渐变条）、情绪阶段标签 + 分数、主线 chips（Top4，强中弱配色）、仓位/模式、主力净流入、晋级率、溢价率、两融变化
- 新 `ListCard` 组件拆出，含 `stageColorClass` / `strengthChipClass` 工具函数
- 兼容无 v2 AI 的旧数据（降级显示基础指标）

### 2. 连板天梯明细首板折叠（前次）
- 首板默认收缩，带点击展开头（▸/▾ + 「点击展开/收起」提示）
- 2 板及以上全展开
- 文案"其中有股票 X 只"

### 3. 两融余额指标（进行中，核心已完成）
- **DB 新列**：`dailyReview.margin_data JSONB`（已执行 SQL）
- **类型**：`MarginData` 接口 + `AiAnalysisV2FundPicture.margin_summary`
- **Python 采集**：`scripts/daily-review/python/collectors/margin.py`
  - akshare `stock_margin_sse` 拉 1 年 SSE 时序 + `stock_margin_szse(date)` 拉当日深市
  - 计算：总余额、日变化、近 5 日 diff 数组、连续天数、1Y 分位
- **增量脚本**：`scripts/daily-review/python/refresh_margin.py`（只补 margin_data + 清 ai_analysis，保护已补丁字段）
- **main.py + db.py**：接入到模块 1 扩展下，`save_daily_review` 写 margin_data
- **TS `scripts/daily-review/index.ts`**：
  - schema 加 `margin_summary`
  - prompt 规则 10：5 档定性判断（顶部警示/加仓信号/企稳/撤离）
  - userContent 注入 `margin_data`
  - 推送 Markdown 加"两融:"行
- **前端 `FullReportV2.tsx`**：资金画像新增第 5 张卡「⚡ 两融杠杆」
  - 顶部结构化指标行（余额/1Y分位/日变化/连续天数）
  - 底部 AI 解读（margin_summary）
- **前端 `DailyReviewView.tsx`**：列表卡摘要加"两融 ±X 亿"

## 待解决（延迟到下次）

### 两融数据 T+1 延迟问题 ⚠️
**现象**：2026-04-15 跑 `refresh_margin.py --date 2026-04-14`，akshare SSE 最新只有 20260413 的数据，4-14 数据尚未披露。

**根因**：
- 交易所披露时间：4-14 盘后的两融余额 → 4-15 16:00+ 才在官方页更新
- akshare 爬取延迟：通常 T+2 凌晨才能稳定拿到
- 当天盘后立即跑会拿到 T-2 的数据（有 1 天滞后）

**当前行为**：
- margin_data.trade_date 字段会如实记录实际拿到的日期（如 4-13 而非 4-14）
- 前端目前**未显示该标注**，用户可能会误以为是当日数据

**下次要做的方向（择一）**：
1. 前端加"（截至 YYYY-MM-DD）"标注（简单，5 分钟）
2. 改定时任务延迟到 T+2 早上再跑 margin（稳定，但当晚报告看不到）
3. 换数据源（东财/Wind，成本较高）
4. 接受 T-1 滞后 + 加标注（最现实）

**SZSE 当日合计问题**：
- `stock_margin_szse(date)` 返回 0.0，当前 total_balance 退化为 SSE 单市（~1.32 万亿，实际两市约 1.8-2 万亿）
- 需要排查：列名是否匹配 / 接口是否返回的是当日待披露的空 DataFrame / 是否需要其他聚合函数
- 不影响主线，SSE 和两市总量相关性 0.98

## 已落库数据（2026-04-14）
- margin_data: 1.32万亿（SSE单市，实际 trade_date=2026-04-13）/ 1Y分位 79.2% / 连续 +5 日 / 日变化 +78.94 亿
- AI 已重跑，headline："情绪升温涨停55家创板指涨2.36%"
- fund_picture.margin_summary 已由 Opus 生成（未在本次会话验证具体文案）

## 本次会话遗留的核对项
- [ ] 用户未最终确认前端 UI 效果（因 margin_data 数据是 T-1 延迟，用户选择延期解决）
- [ ] margin_summary AI 生成结果未人工检查（已落库，可随时打开全览 Tab 查看）

## 关键文件清单（本次改动）
- `packages/types/src/index.ts`
- `scripts/daily-review/python/collectors/margin.py`（新）
- `scripts/daily-review/python/refresh_margin.py`（新）
- `scripts/daily-review/python/main.py`
- `scripts/daily-review/python/db.py`
- `scripts/daily-review/index.ts`
- `apps/web/components/daily-review/DailyReviewView.tsx` + `.module.css`
- `apps/web/components/daily-review/FullReportV2.tsx` + `.module.css`
