# 开发日志

---

## 2026-04-03

### 阿里云迁移 + 安全加固

---

#### 一、功能概述

将项目从纯 Vercel 部署迁移至「阿里云宝塔 + Vercel」双轨架构，并修复移动端安全隐患。

#### 二、改造内容

**Part 1：Hono API 安全加固**
- 新建 `backend/api/src/server.ts`：Node.js 独立启动入口，支持 PM2 管理
- 新建 `backend/api/src/middleware/auth.ts`：两个鉴权中间件
  - `adminAuth`：验证管理后台 JWT（HS256，7天有效期）
  - `mobileAuth`：验证移动端 Supabase JWT（调用 `supabase.auth.getUser()`）
- 修复安全漏洞：管理员登录接口 `POST /api/auth/login`，密码比对移到服务端，`password_hash` 不再传给前端
- 为 themes/stocks 路由接入 `adminAuth` 保护
- 新增移动端路由 `/api/mobile/*`，受 `mobileAuth` 保护：
  - `POST /api/mobile/user/sync`：首次登录同步用户（激活 3 天试用）
  - `GET /api/mobile/user/me`：获取用户信息
  - `PATCH /api/mobile/user/profile`：更新昵称/头像
  - `POST /api/mobile/events`：上报行为事件
  - `POST /api/mobile/feedback`：提交反馈
  - `GET /api/mobile/version`：获取版本控制信息
- CORS 新增 `ALLOWED_ORIGINS` 环境变量支持
- 新增 `bcryptjs` + `@hono/zod-validator` 依赖，新增 `start` 脚本

**Part 2：Web 前端登录改造**
- 登录 action 改调 `POST /api/auth/login`，不再从前端拉取 `password_hash`
- JWT token 存入 `sessionStorage('admin_token')`，退出登录时一并清除

**Part 3：移动端改造**
- 新建 `apps/mobile/api/backend.ts`：封装对 Hono API 的请求，自动携带 Supabase JWT
- `user.ts` 改造：`getOrCreateAppUser`、`fetchAppUser`、`updateAppUser`、`trackEvent`、`submitFeedback`、`fetchAppVersion` 全部改走 Hono API
- OTP 发送/验证保留直连 Supabase Auth
- `.env.production` 新增 `VITE_API_BASE_URL`

**Part 4：部署配置**
- 新建 `ecosystem.config.js`：PM2 双进程配置（web:3000 + api:3001）
- 新建 `docs/deploy-alicloud.md`：宝塔完整部署手册（环境变量、Nginx、验证、运维）

#### 三、验证结果
- `backend/api` TypeScript 编译通过（`npx tsc --noEmit`）
- `apps/web` TypeScript 编译通过
- API 本地启动测试通过：健康检查、无 token → 401、有 token → 正常

#### 四、待办
- [ ] 部署到阿里云：拉代码、安装依赖、build、配置 .env.server、PM2 启动
- [ ] 替换 `apps/mobile/.env.production` 中的 `<服务器IP>`
- [ ] 替换 `ecosystem.config.js` 中 `ALLOWED_ORIGINS` 注释为实际 IP
- [ ] Web 前端：`NEXT_PUBLIC_API_BASE_URL` 在 Vercel 控制台配置（指向阿里云 IP）
- [ ] 移动端重新打包 APK 并测试 OTP 登录 → sync → me 完整流程

---

## 2026-04-01

### APP 管理模块上线

---

#### 一、功能概述

在后台管理系统侧边栏新增"APP 管理"分组，包含4个子菜单，服务于 C 端 App 的运营管理需求：

| 菜单 | 功能 |
|------|------|
| APP用户管理 | 查看 App 注册用户列表，支持编辑套餐类型和到期时间 |
| 用户反馈 | 只读查看用户提交的反馈内容及联系方式 |
| 用户行为 | 只读查看用户行为事件记录（最多200条） |
| 管理控制 | 版本发布管理，支持新增/编辑版本号、强制升级策略、版本说明 |

---

#### 二、数据库变更

新建 `appVersionControl` 表（需在 Supabase SQL Editor 手动执行）：

```sql
CREATE TABLE "appVersionControl" (
  id              TEXT PRIMARY KEY,
  version         TEXT NOT NULL,
  is_force_update BOOLEAN NOT NULL DEFAULT false,
  value_desc      TEXT NOT NULL DEFAULT '',
  created_at      BIGINT NOT NULL
);
```

已配置完整 RLS 策略（SELECT / INSERT / UPDATE / DELETE）。

`appUser`、`userFeedback`、`userEvent` 三张表为 App 端已有表，本次仅新增后台读取接口。

---

#### 三、代码变更

**packages/types**
- 新增 `AppVersionControl` 接口

**packages/api-client**
- 新增7个方法：`listAppUsers`、`updateAppUserPlan`、`listUserFeedbacks`、`listUserEvents`、`listVersions`、`createVersion`、`updateVersion`

**store/index.ts**
- `NavItem` 扩展4项：`app-users`、`app-feedback`、`app-events`、`app-version`
- 新增4组 state（`appUsers`、`userFeedbacks`、`userEvents`、`appVersions`）及对应 Actions
- 新增 `appMenuOpen`（默认 `false`，折叠状态）/ `toggleAppMenu`

**AdminLayout.tsx**
- `handleNav` 加入4个新页面的数据加载分支
- `NAV_LABEL` 补充4项面包屑映射
- 侧边栏在"系统管理"上方插入"APP 管理"可折叠分组，仅 admin 可见

**新建组件（6个）**
- `components/app-users/AppUsersView.tsx` — 用户列表，含套餐类型/到期时间展示
- `components/app-users/AppUserModal.tsx` — 编辑套餐弹窗，日期解析遵循北京时间规范（`+08:00`）
- `components/app-feedback/AppFeedbackView.tsx` — 反馈只读列表
- `components/app-events/AppEventsView.tsx` — 行为事件只读列表
- `components/app-version/AppVersionView.tsx` — 版本列表，含发布/编辑入口
- `components/app-version/AppVersionModal.tsx` — 版本新增/编辑弹窗

---

#### 四、注意事项

- `appMenuOpen` 默认 `false`（折叠），避免侧边栏初始过长
- `AppUserModal` 日期字段严格使用 `+08:00` 解析，避免跨时区偏差
- 套餐到期日留空表示永久/无限制，保存时传 `null`

---

## 2026-03-24

### 早报展示优化 + 时区 Bug 全面修复 + 数据采集清理

---

#### 一、早报列表卡片摘要优化

**问题**：早报列表页每张卡片展示的是完整报告内容，格式混乱（含 `①②③`、`**粗体**`、`━━━` 等 Markdown 符号）。

**修复内容**：
- 重构 `cleanMarkdown()` 函数：逐行扫描，智能跳过 `📰` 标题行、`---` 分隔线、`投资早报 YYYY-MM-DD` 日期行，返回第一段有意义的纯文本
- `ZaobaoView.module.css`：`.summary` 添加 CSS 3行 line-clamp 截断，防止超长内容溢出
- `generate.ts`：`summary` 字段改为只提取 `①【市场基调】` 单行，不再存储完整三点内容

**涉及文件**：
- `apps/web/components/zaobao/ZaobaoView.tsx`
- `apps/web/components/zaobao/ZaobaoView.module.css`
- `scripts/zaobao/generate.ts`

---

#### 二、早报下载功能

**新增**：早报详情页顶部操作栏新增「下载早报」按钮，生成自包含 HTML 文件，可离线查看。

**技术细节**：
- `escapeHtml()` 防止 HTML 特殊字符破坏结构
- `renderMarkdown()` 将 `**粗体**`、`*斜体*`、`` `代码` `` 渲染为 HTML 标签
- 章节标题检测兼容 `## ━━━ xxx ━━━` 格式，`---` 分隔线渲染为 `<hr>`
- 修复 Safari 兼容性：`document.body.appendChild(a)` 后再 `click()`，并延迟 revoke Blob URL
- 文件名格式：`2026-03-24-交易日早报.html`（去掉品牌名，去掉空格避免截断）
- 报告末尾保留「本报告仅供参考，不构成投资建议」，去掉 AI 自动添加的数据来源注释

**涉及文件**：
- `apps/web/components/zaobao/ZaobaoDetail.tsx`
- `scripts/zaobao/prompts.ts`（新增禁止数据来源尾注 + 末尾格式规范）

---

#### 三、时区 Bug 全面排查与修复

**背景**：用户发现 `03-23 08:06` 的新闻出现在 `03-24` 的早报中（应在窗口之外），触发系统性时区审计。

**根本原因**：新闻窗口日期计算用 `new Date('YYYY-MM-DDT00:00:00+08:00').getTime()` 取 BJ 午夜时间戳，再做毫秒减法后 `toISOString()` 还原日期，因为 BJ 00:00 = UTC 前一天 16:00，每减一天多偏移一天，实际窗口比预期宽 24 小时。

**修复清单**：

| 文件 | 修复内容 |
|------|---------|
| `generate.ts` | 新增 `addDays()` 纯 UTC 日历运算函数，替换所有 `dateMs ± N*86400000` 的日期推算 |
| `generate.ts` | `isTradeDay()` 改用 `new Date('YYYY-MM-DDT12:00:00+08:00').getDay()` 避免时区偏移 |
| `akshare_fetcher.py` | `get_today_str()` / `get_yesterday_str()` 改用 `datetime.now(ZoneInfo('Asia/Shanghai'))` |

**新增日志**：三种窗口场景（普通交易日 / 周一 / 周报）均打印窗口起止时间，方便验证。

**记忆更新**：将 5 种时区高危反模式补充进 `MEMORY.md`，防止重复踩坑。

---

#### 四、数据采集清理

- **移除 ^HSCEI**：Yahoo Finance 该标的已退市，采集报 404，从 `yfinance_fetcher.py` 删除
- **移除 CCTV 新闻联播采集**：数据无实际价值，从 `main.py` 删除
- **移除财联社公告精选采集**：同上，从 `main.py` 删除
- 步骤编号重排为 1/4 ~ 4/4

---

#### 五、新闻窗口与分类规则调整

- **普通交易日窗口起始时间**：`12:00 BJ` → `15:00 BJ`（A股收盘后），与周一/周报统一
- **报告分类新增关键词**：`REPORT_PATTERN` 新增「全球要闻」
- **需求文档同步更新**：`docs/requirements-cls-news.md`

---

## 2026-03-23

### 今日资讯页面 + 财联社采集重构 + 定时任务迁移至 cron-job.org

---

#### 一、今日资讯页面（NewsView）

**新增页面**：后台管理系统侧边栏新增「今日资讯」导航项，展示 `newsItems_cls` 表中的财联社新闻数据。

**功能设计**：
- 两个 Tab：**快讯**（默认）/ **热门**，快讯显示在前
- 热门 Tab 包含分类为 `热门 / 深度 / 提醒` 的内容；快讯 Tab 显示其余条目
- 支持标题和摘要全文搜索，支持日期选择（默认今日北京时间）
- 表格列：发布时间 / 标题+摘要（含"查看原文"超链接，新窗口打开）/ 分类标签 / 重要程度（A=重大/B=重要/C=一般）

**UI 规范**：
- 页面标题、搜索框、section-header 布局与主题管理页保持一致
- Tab 字号与主题名（15px/600）一致，摘要字号与主题描述（13px/#64748b）一致
- 菜单顺序：今日资讯排在涨跌家数之前

**涉及文件**：
- `apps/web/components/news/NewsView.tsx`（新建）
- `apps/web/components/news/NewsView.module.css`（新建）
- `apps/web/store/index.ts`：新增 `NewsItem` 接口、`'news'` NavItem、`newsItems/newsDate` 状态、`loadNewsItems` action
- `apps/web/components/layout/AdminLayout.tsx`：新增导航项和数据加载逻辑
- `apps/web/app/page.tsx`：条件渲染 NewsView

---

#### 二、财联社深度采集重构

**背景**：原深度采集（`cls-news-collector`）分类使用 `A股`，头条字段使用 `top_list`（错误），导致 0 条入库。

**修复内容**：
- 字段名修正：`top_article`（非 `top_list`），同一 API 请求复用
- 新增 `DEPTH_TOP_TAKE = 10`，头条取前 10 条，不限时间窗口
- 深度文章时间窗口由 3h 扩展为 24h（编辑精选内容，不适合短窗口过滤）
- **分类统一**：原 `A股` 和 `头条` 两个分类合并为 `深度`，均走 `detect_categories()` 报告/提醒检测规则
- 采集优先级：热门 > 深度头条 > 深度文章 > 快讯
- 同步更新 `generate.ts` / `NewsView.tsx` / `prompts.ts` 中的 `PRIORITY_CATS`（热门/深度/提醒）
- 数据库旧记录手动执行 SQL 将 `A股` 分类批量替换为 `深度`：
  ```sql
  UPDATE "newsItems_cls"
  SET categories = array_replace(categories, 'A股', '深度')
  WHERE 'A股' = ANY(categories);
  ```

---

#### 三、定时任务迁移至 cron-job.org

**问题**：GitHub Actions 内置 `schedule` 触发器在免费账号下极不可靠，手动 Enable 后 13+ 小时未自动运行。

**解决方案**：移除三个 workflow 的 `schedule` 配置，改由 [cron-job.org](https://cron-job.org) 外部定时调用 GitHub `workflow_dispatch` API。

**cron-job.org 任务配置**：

| 任务 | Workflow | 触发频率 |
|------|---------|---------|
| 快讯采集 | `cls-flash-collector.yml` | 每小时（整点） |
| 深度采集 | `cls-news-collector.yml` | 每6小时（北京 02/08/14/20 时） |
| 每日早报 | `zaobao.yml` | 工作日+周日（北京 08:05/18:05） |

**说明**：
- 早报 workflow 内已内置深度采集步骤，自身形成完整依赖链，无需外部协调
- cron-job.org 仅作触发器，代码/脚本无需同步，push 到 main 后下次触发自动使用最新代码

---

## 2026-03-22

### 涨跌家数页面上线 + 股票代码表初始化

---

#### 一、涨跌家数前端页面（BreadthView）

**新增页面**：后台管理系统侧边栏新增「涨跌家数」导航项，展示全市场 A 股每日上涨/下跌家数趋势。

**技术实现**：
- 安装 `recharts` 图表库
- `packages/types`：新增 `MarketBreadth` 接口，`NavItem` 扩展 `'breadth'`
- `packages/api-client`：新增 `getBreadthByMonth(mode)` 方法，支持 `'recent30'`（最近30天）和 `'YYYY-MM'`（指定月份）两种查询模式
- `store/index.ts`：新增 `breadthData`、`breadthMonth` 状态和 `loadBreadth` action
- `AdminLayout.tsx`：侧边栏插入导航项，点击时自动加载最近30天数据
- `BreadthView.tsx`：核心组件，包含情绪解读、五项统计数字、月份切换器、折线图

**页面布局（从上到下）**：
1. 页面标题（复用全局 `page-title` / `page-desc` 样式）
2. 情绪解读（乐咕乐股数据，5档判断：`rise/total` 比例）+ 五项统计（上涨/下跌/涨停/跌停/平盘）
3. 月份切换器（最近30天 + 最近6个月，从近到远，禁止选未来月份）
4. recharts 折线图（绿色线条，Tooltip 显示完整日数据，无数据日期自然断开）

**情绪判断逻辑**：
- `rise/total >= 0.6`：🔥 市场情绪热烈，多头主导
- `rise/total >= 0.45`：📈 市场情绪偏多，上涨氛围良好
- `rise/total >= 0.35`：🔄 市场情绪中性，涨跌分化
- `rise/total >= 0.25`：📉 市场情绪偏弱，下跌家数占优
- 否则：❄️ 市场情绪低迷，建议谨慎

---

#### 二、marketBreadth 历史数据初始化

**问题背景**：
- 原脚本 `init_market_breadth.py` 使用 `ak.stock_zh_a_hist` 逐股拉历史行情，因东财接口被限流大量返回空数据，每天只统计到 ~13 只股票（全市场应有 5000+），数据严重偏少

**解决方案**：改用 `baostock`（专为量化设计的免费历史数据源）

**数据验证（3月20日对比乐咕乐股）**：
| 字段 | 乐咕乐股 | baostock 脚本 |
|------|---------|--------------|
| 上涨 | 620 | 620 ✅ |
| 下跌 | 4531 | 4531 ✅ |
| 平盘 | 30 | 30 ✅ |
| 涨停 | 40 | 44（含 ST 5% 涨停，误差 <1%）|
| 跌停 | 26 | 34（同上）|

**脚本逻辑**（`init_market_breadth.py`）：
1. baostock 登录
2. `query_stock_basic` 拉全量上市 A 股（5191 只，过滤 type=1 & status=1）
3. 逐只拉 `date,pctChg`（涨跌幅），聚合到 `date_stats[trade_date]`
4. 支持断点续跑（跳过 DB 已有交易日）
5. 批量写入 Supabase `marketBreadth` 表

**运行结果**：49 个交易日（2026-01-05 至 2026-03-20），失败 0 只，全部写入成功

**注意**：3月21日（周五）baostock 延迟到周一才更新，届时重跑脚本即可补入（断点续跑）

---

#### 三、stockCodes 股票代码表初始化

**新增表**：`stockCodes`（code, name, exchange, board, created_at）
- `exchange`：SH / SZ / BJ（按交易所）
- `board`：主板 / 创业板 / 科创板 / 北交所（按板块）
- 板块由代码前缀规则推断（非数据源直接给出）

**代码前缀规则**：
- `60xxxx` → SH 主板，`688xxx` → SH 科创板
- `00xxxx / 002xxx / 003xxx` → SZ 主板，`300xxx / 301xxx` → SZ 创业板
- `8xxxxx / 4xxxxx` → BJ 北交所

**数据来源**：`ak.stock_info_a_code_name()`（东方财富）

**写入结果**：5491 只（SH 2306 / SZ 2885 / BJ 300），全部 upsert 成功

**后续维护**：手动按需重跑 `init_stock_codes.py` 即可，无需定时任务

---

#### 四、数据流说明

```
历史数据：init_market_breadth.py（baostock）→ marketBreadth 表（一次性）
每日增量：zaobao main.py → akshare_fetcher.fetch_market_breadth()
         → ak.stock_market_activity_legu()（乐咕乐股）→ marketBreadth 表
前端展示：BreadthView → apiClient.getBreadthByMonth() → Supabase → 折线图
```

---

#### 五、Bug 修复

**akshare_fetcher.py 字段匹配 bug**：
- 原逻辑用 `elif '涨停' in label` 模糊匹配，`真实涨停=35`、`st st*涨停=11` 会依次覆盖 `limit_up`，最终存入错误值 11
- 修复：改为精确匹配 `EXACT_MAP = {'上涨': 'rise', '下跌': 'fall', '平盘': 'flat', '涨停': 'limit_up', '跌停': 'limit_down'}`，子行（真实涨停、ST 涨停等）全部跳过

---

## 2026-03-18

### 增量同步优化：支持 sort_order/title_color 字段 + SKIP_IDS 永久排除

**背景**：韭研公社 API 返回的前15条主题带有 `title_red`（标红）和 `sort_no`（排序）字段，之前未同步到 DB。同时发现 `index.ts` 的 `MAX_UPDATES_PER_RUN` 限额逻辑不够精细，需要区分"重抓图片"和"只刷元数据"两种场景。

**主要改动**：

1. **新字段同步**（`fetcher.ts`）：`ThemeItem` 接口新增 `title_red`、`sort_no` 字段
2. **importer.ts 扩展**：
   - `fetchExistingThemes` 返回完整元数据（含 `sortOrder`/`titleColor`），用于变更对比
   - 新增 `updateThemeMeta()`：仅更新 sort_order/title_color/overview，不触碰股票数据
   - 新增 `clearStaleTopFields()`：每次同步后清空不再位于前15条的主题的排序/标色字段
3. **index.ts 增量逻辑重构**：
   - 更新检测范围收窄至**前15条**（非前15的主题排位变化不影响展示，无需同步）
   - 区分两类更新：`fullUpdateItems`（update_time 日期推进 → 重抓 Vision）/ `metaOnlyItems`（日期不变但排位/标色变化 → 只刷元数据）
   - 移除 `MAX_UPDATES_PER_RUN` 限额，前15条全部处理
   - 新增 `SKIP_IDS` 永久跳过列表（北交所 `7df6369f...`），`fetchAllItems` 过滤后返回
4. **smart-sync.ts**：同步加入 `SKIP_IDS` + `posMap`，支持写入 `sort_order`/`title_color`
5. **vision.ts**：Claude API timeout 从 60s 调整为 120s，`maxRetries` 设为 0，补充 `fetch failed` 网络错误识别
6. **sync.yml**：workflow timeout 从 15 分钟调整为 60 分钟，摘要适配新统计格式（前15更新/前15元数据变更）
7. **package.json**：新增 `"type": "module"`

**DB 清理**：
- 删除 API 已下架主题 `PCB`（`fa126a3d...`）
- 删除永久跳过主题 `北交所`（`7df6369f...`），DB 最终 707 个主题，与 API 官方数对齐

---

## 2026-03-15

### 韭研公社全量数据同步完成

**目标**：将韭研公社产业库 909 个主题批量导入 Supabase，建立增量同步机制

**最终结果**：908/909 主题有股票数据，1 个（干细胞再生胰岛）因 OSS 图片已删除 404 无法处理

**解决的技术问题**（共经历 8 轮同步）：

1. **图片 mediaType 误判**：URL 以 `.jpg` 结尾但实际是 PNG → 改用魔术字节检测（`0xFF 0xD8` = JPEG）
2. **Vision JSON 截断**：`relation` 字段内容过长导致 `max_tokens:8192` 不够用，JSON 被截断无法 parse
   - 第一步：提示词加 "15字限制" 规则（模型不一定遵守）
   - 第二步：`repairTruncatedJson()` 补齐缺失括号（处理了部分情况）
   - 第三步：正则兜底 `extractRowsByRegex()` 直接从文本提取股票对象（彻底解决）
   - 第四步：修 JSON 提取逻辑，用 `text.indexOf('{')` 代替贪婪正则，避免截掉有效内容
3. **超大图片（>5MB）**：Claude API base64 限制 5MB，原始图需 ≤ 3.75MB
   - 引入 `sharp`，阈值 3.5MB，超限压缩为 JPEG quality:70，width:2000
4. **imgs 字段格式异常**：部分主题 imgs 是逗号分隔字符串而非 JSON 数组 → 加逗号分割兜底
5. **重试时 duplicate key**：第一次插入主题成功但 stocks 失败 → 主题残留 DB → 每轮结束执行 `DELETE FROM "themeConcept" WHERE id NOT IN (SELECT DISTINCT theme_id FROM "themeStocks")` 清理后重跑

**增量同步方式**：每日执行 `npm run sync`，自动跳过已有主题，只处理新增

---

## 2026-03-14

### 多用户登录 + 角色权限系统（v1.1.0）

**背景**：系统原使用硬编码账号（admin/123456）+ sessionStorage，无法支持多人协作，密码明文比对存在安全隐患。

**核心改动**：
1. **数据库**：新增 `adminUsers` 表（id, username, password_hash, role, created_at），RLS 已开启，初始账号 `admin`（密码需自行设置）
2. **密码安全**：引入 `bcryptjs`（cost=10），彻底替代明文比对
3. **三角色体系**：viewer（只读）/ editor（增删改）/ admin（全权 + 用户管理）
4. **新增文件**：
   - `apps/web/lib/crypto.ts` — hashPassword / verifyPassword
   - `apps/web/components/users/UsersView.tsx` — 用户管理列表页
   - `apps/web/components/users/UserModal.tsx` — 新增用户 / 重置密码弹窗
   - `apps/web/components/roles/RolesView.tsx` — 角色权限说明（只读）
   - `scripts/init-admin-users.sql` — Supabase 建表 + 初始数据脚本
   - `docs/requirements-auth.md` — 需求文档
5. **修改文件**：types / api-client / store / LoginPage / AdminLayout / page.tsx / Dashboard / ThemesView / StocksView

**部署**：Supabase SQL 已执行，`adminUsers` 表创建成功，bcrypt 验证通过

**UI 微调**：「系统管理」菜单通过 flex 间距固定在侧边栏底部，不随导航条目数量浮动

---

### 问题修复

**线上数据加载超时（statement timeout）**
- 现象：登录后 Toast 报错「加载数据失败：canceling statement due to statement timeout」
- 原因：`loadThemes` 通过 `themeStocks(*)` 一次性 JOIN 所有主题和股票，数据量超过 Supabase 免费套餐语句超时限制（~8秒）
- 修复：在 Supabase SQL Editor 执行以下语句添加索引：
  ```sql
  CREATE INDEX IF NOT EXISTS idx_themestocks_theme_id ON "themeStocks"(theme_id);
  ```
- 结果：页面恢复正常

---

## 2026-03-13

### 完成内容

**1. 主题列表页搜索功能**
- 新增关键字搜索框，实时过滤匹配主题名称
- 搜索框置于页面标题行中央（CSS Grid 三列布局：左标题 / 中搜索框 / 右按钮）
- 支持清除按钮（×），搜索框聚焦时自动展宽（280px → 320px）
- 无匹配结果时显示专属空状态提示

**2. 主题列表排序优化**
- 主题卡片按 `updated_at` 倒序排列，最近修改的主题排在最前

**3. 股票池页面列宽调整**
- 大类、子类列宽统一调整为 100px（与个股列一致）
- 相关性列取消固定宽度，自适应内容

**4. 全局悬浮快捷操作按钮**
- 页面右下角新增竖向悬浮按钮组
- 「回到顶部」：平滑滚动至内容区顶部
- 「返回上一步」：基于 Zustand 应用状态导航（股票池 → 主题列表 → 仪表盘），仅在有上一步时显示

**5. 股票池合并展示优化**
- 相关性字段为空的个股，按最深非空分类（细分 → 子类 → 大类）合并为同一行展示
- 合并行个股名称用顿号（、）分隔，支持红色/橙色高亮
- 合并行不显示星级标识，保持视觉简洁
- 仅有单支个股时不合并，仍按普通行展示

**6. 类型与数据层扩展**
- `packages/types`：`Stock` 新增 `sort_order: number | null`，`Theme` 新增 `updated_at: number`
- `packages/api-client`：`createTheme` / `updateTheme` 自动写入 `updated_at: Date.now()`
- `StockModal.tsx` 补充 `sort_order: null` 修复 TypeScript 类型错误

### 部署
- Git commit & push → Vercel 自动部署
- 线上地址：https://quantstock.vercel.app/

---

## 2026-03-11

### 完成内容

**1. 重构项目为股票后台管理系统**
- 将单页 Demo 改造为带登录页的后台管理系统
- 新增登录页（admin / 123456），支持 sessionStorage 登录态管理
- 新增后台布局：深色侧边栏（220px）+ 白色 Topbar + 主内容区
- 新增仪表盘页面，展示主题总数、股票总数、重点标记数、平均星级统计卡片
- 保留原有股票池 CRUD 功能，嵌入新布局框架

**2. 写入股票数据**
- 解析「光通信/CPO（250608）」图片股票池
- 联网搜索股票代码，写入 40 条结构化股票记录到 localStorage
- 涵盖上游材料及元器件（光材料、光芯片、光器件、石英晶振、插芯、设备）和中游光通信（光模块 CPO/LPO/光引擎、光纤光缆、光纤涂料）两大分类

**3. 修复 Bootstrap Icons CDN 失效问题**
- 移除 jsdelivr.net CDN 引用（Playwright 环境无法访问）
- 新增 `ICONS` JS 对象，用内联 SVG 替换所有 `bi-*` 图标
- 星级选择器改用 Unicode `★` 字符 + CSS 颜色切换
- 空状态改用 emoji（📭 📈）

**4. 修复主题编辑/删除按钮空白 Bug**
- 原因：按钮内容依赖 CDN 图标，CDN 失效后显示空白
- 修复：JS 模板字符串中注入 `${ICONS.pencil}` / `${ICONS.trash}` 内联 SVG

**5. 修复侧边栏登出按钮不可见 Bug**
- 原因：图标依赖 CDN + 深色背景上文字颜色对比度不足
- 修复：改为带样式的 `<button class="sidebar-logout-btn">` + 内联 SVG + "退出"文字

**6. 修复密码框 DOM 警告**
- 将登录表单包裹在 `<form onsubmit>` 中，消除浏览器无障碍警告

**7. 修复滚动出现空白页面 Bug**
- 原因：整个页面（body）在滚动，侧边栏 `position: fixed` 不动，内容滚走后留下空白背景
- 修复：锁死 `html, body { height: 100%; overflow: hidden; }`，让只有 `.main-content` 区域内部滚动（`overflow-y: auto`），实现标准后台管理布局
- 效果：侧边栏和 Topbar 始终固定可见，仅内容区域滚动

### 技术栈
- 纯 HTML + CSS + 原生 JS（无构建工具，单文件）
- 数据持久化：localStorage（股票数据）+ sessionStorage（登录态）
- 图标：全部内联 SVG，零外部依赖

---
