# 产品需求文档

**项目**：股海远洋（QuantStock）
**最后更新**：2026-03-22
**维护约定**：功能新增/变更时同步更新本文档，并在 commit message 注明 `docs: 更新需求文档`

---

## 一、产品定位

**股海远洋**是一款面向 A 股个人投资者的数据可视化与 AI 资讯平台，定位为"股票投资智能小助理"。核心功能包括：行业主题跟踪、每日 AI 早报、市场情绪监测和多角色协作管理。

**技术栈**：Next.js 15 + Supabase（PostgreSQL）+ Zustand + CSS Modules + TypeScript

### 用户角色总览

| 角色 | 英文标识 | 权限范围 |
|------|---------|---------|
| 管理员 | admin | 查看数据 + 增删改主题/股票 + 管理用户账号 |
| 编辑者 | editor | 查看数据 + 增删改主题/股票 |
| 观察者 | viewer | 仅查看数据，不可进行任何写操作 |

---

## 二、功能模块目录（状态总览）

| 编号 | 模块名 | 导航路径 | 状态 | 详细文档 |
|------|--------|---------|------|---------|
| F01 | 登录与认证 | `/login` | ✅ 已上线 | [requirements-auth.md](./requirements-auth.md) |
| F02 | 仪表盘 | `/dashboard` | ✅ 已上线 | 本文 §三.F02 |
| F03 | 主题管理 | `/themes` | ✅ 已上线 | 本文 §三.F03 |
| F04 | 股票池管理 | `/themes`（子视图） | ✅ 已上线 | 本文 §三.F04 |
| F05 | 每日早报 | `/zaobao` | ✅ 已上线 | [zaobao.md](./zaobao.md) |
| F06 | 涨跌家数 | `/breadth` | ✅ 已上线 | 本文 §三.F06 |
| F07 | 用户管理 | `/users` | ✅ 已上线 | [requirements-auth.md](./requirements-auth.md) |
| F08 | 角色说明 | `/roles` | ✅ 已上线 | [requirements-auth.md](./requirements-auth.md) |

---

## 三、各功能模块需求详述

### F01 登录与认证

**详细需求**：见 [requirements-auth.md](./requirements-auth.md)

**功能描述**：系统入口，所有用户登录后方可访问其他功能页面。

**需求点**：
- F01-01：用户输入用户名和密码，系统验证后放行
- F01-02：密码使用 bcryptjs（cost factor 10）哈希存储，前端直接与数据库比对
- F01-03：登录成功后将 `{ username, role }` 存入 `sessionStorage`，刷新页面可恢复登录态
- F01-04：登录失败显示「账号或密码错误」提示
- F01-05：退出登录清除 `sessionStorage`，跳转回登录页

**业务规则**：
- 未登录用户访问任何路由均重定向至 `/login`
- 侧边栏菜单按角色动态显示：「用户管理」「角色说明」仅 admin 可见

---

### F02 仪表盘

**功能描述**：登录后的首页，提供全局数据概览和最近主题快速入口，面向所有登录用户。

**需求点**：
- F02-01：页面顶部展示 4 个统计卡片：主题总数、股票总数、重点标记数、平均星级
- F02-02：展示前 15 条主题预览列表（含主题名、概览摘要、股票数量）
- F02-03：主题列表支持点击跳转到对应主题的股票池详情

**业务规则**：
- 前 15 条排序规则：有 `sort_order` 的按 `sort_order` 正序，无 `sort_order` 的按 `updated_at` 倒序追加
- 两阶段加载策略：主题元数据（名称、概览）优先渲染，股票数量后台静默加载，避免页面卡顿
- 重点标记数 = `highlight` 为 `'red'` 或 `'orange'` 的股票总数
- 平均星级保留 1 位小数

**数据结构**：依赖 `themeConcept`、`themeStocks` 表

---

### F03 主题管理

**功能描述**：管理所有投资主题，支持搜索浏览和增删改操作，editor/admin 可编辑，viewer 只读。

**需求点**：
- F03-01：以网格卡片形式展示所有主题（主题名、概览、股票数量、更新时间）
- F03-02：顶部搜索框实时过滤主题名称和概览内容
- F03-03：editor/admin 可新增主题（填写名称、概览）
- F03-04：editor/admin 可编辑主题（修改名称、概览）
- F03-05：editor/admin 可删除主题（同时级联删除旗下所有股票）
- F03-06：`title_color` 为 `'red'` 的主题名称以红色字体高亮显示

**业务规则**：
- `sort_order` 字段：爬虫同步的前 15 条主题有值（1-15），手动创建的为 `null`
- 删除时弹出确认对话框，明确提示将同时删除旗下所有股票
- viewer 不渲染新增/编辑/删除按钮（不可见，非禁用）

**数据结构**：`themeConcept`（id, name, overview, sort_order, title_color, updated_at）

---

### F04 股票池管理

**功能描述**：展示某主题下的所有股票，支持多级分类浏览和增删改，editor/admin 可编辑，viewer 只读。

**需求点**：
- F04-01：以表格形式展示股票列表，列包括：大类(cat1)、子类(cat2)、细分(cat3)、关联说明(relation)、股票代码、股票名称、星级、高亮标记、操作
- F04-02：同分类、`relation` 为空的多支股票可合并为一行（多股票单元格）
- F04-03：无任何股票包含数据的列自动隐藏（如所有 cat3 均为空则隐藏 cat3 列）
- F04-04：editor/admin 可新增股票，填写完整字段
- F04-05：editor/admin 可编辑单支股票信息
- F04-06：editor/admin 可删除单支股票

**业务规则**：
- 排序规则：有 `sort_order` 的股票按 `sort_order` 正序（保持爬虫采集的图片顺序）；`sort_order` 为 `null` 的按 `cat1 → cat2 → cat3 → stars`（倒序）排列
- 星级范围：1-5 整数，用星形图标展示
- 高亮标记枚举：`''`（无）/ `'red'`（红）/ `'orange'`（橙），以有色标签展示

**数据结构**：`themeStocks`（id, theme_id, code, name, cat1, cat2, cat3, relation, stars, highlight, sort_order）

---

### F05 每日早报

**详细设计**：见 [zaobao.md](./zaobao.md)

**功能描述**：展示 AI 生成的每日市场早报和周报，面向所有登录用户。

**需求点**：
- F05-01：列表页展示最近 30 条报告（日期、类型、一句话摘要）
- F05-02：点击报告进入详情页，完整渲染 Markdown 内容
- F05-03：报告区分类型：`trading`（交易日早报）/ `weekly`（周报）
- F05-04：报告由后台脚本自动生成，前端只读展示

**业务规则**：
- 报告按 `report_date` 倒序排列（最新在前）
- 详情页支持返回列表
- 后台生成链路：Python 采集数据（akshare + baostock + yfinance + 财经新闻）→ Node.js 调用 Claude API 生成 Markdown 报告 → 写入 `dailyReport` 表
- GitHub Actions 在每个交易日早晨定时触发（详见 zaobao.md）

**数据结构**：`dailyReport`（id, report_date, report_type, content, summary, created_at）

---

### F06 涨跌家数

**功能描述**：展示 A 股每日涨跌家数统计及市场情绪分析，帮助投资者判断市场整体热度，面向所有登录用户。

**需求点**：
- F06-01：最新交易日统计卡片，显示：上涨家数、下跌家数、涨停家数、跌停家数、平盘家数
- F06-02：市场情绪解读标签（5 档，见业务规则）
- F06-03：连续趋势补充说明（见业务规则）
- F06-04：月份切换器：提供「最近30天」快捷入口 + 最近6个月按钮，不可选未来月份
- F06-05：折线图展示所选时间段内涨跌家数走势
- F06-06：图表 Tooltip 悬停显示当日 5 项数据（上涨/下跌/涨停/跌停/平盘）

**业务规则**：
- 情绪档位（按当日 `rise / (rise + fall + flat)` 比例）：
  - ≥ 70%：极度乐观
  - 55%-70%：偏强
  - 45%-55%：震荡
  - 30%-45%：偏弱
  - < 30%：极度悲观
- 连续趋势判断（基于最近2日）：
  - 连续 2 日 `rise < 1000` → 显示「连续低迷」提示
  - 连续 2 日 `rise > 4000` → 显示「市场过热」提示
  - 中间区间按涨跌趋势给出「回暖」或「走弱」判断
- 折线图 Y 轴固定范围：0 ~ 5500；X 轴标签格式：MM-DD
- 数据来源：baostock 历史初始化（`init_market_breadth.py`）+ akshare 每日定时采集

**数据结构**：`marketBreadth`（id, trade_date, rise, fall, flat, limit_up, limit_down, created_at）

---

### F07 用户管理

**详细需求**：见 [requirements-auth.md](./requirements-auth.md)

**功能描述**：admin 专属功能，维护系统用户账号和角色分配。

**需求点**：
- F07-01：表格展示所有用户：用户名、角色、创建时间、操作列
- F07-02：新增用户（填写用户名、初始密码、选择角色）
- F07-03：修改角色（在列表中直接变更某用户角色）
- F07-04：重置密码（输入新密码，bcryptjs 哈希后更新）
- F07-05：删除用户（二次确认弹窗）

**业务规则**：
- 不可对当前登录账号执行修改角色或删除操作
- 用户名唯一，创建时重名提示「用户名已存在」
- 密码统一使用 bcryptjs（cost factor 10）哈希，数据库中只存哈希值

**数据结构**：`adminUsers`（id, username, password_hash, role, created_at）

---

### F08 角色说明

**详细需求**：见 [requirements-auth.md](./requirements-auth.md)

**功能描述**：admin 专属只读页面，展示系统三个内置角色的权限范围说明。

**需求点**：
- F08-01：以卡片形式展示 admin / editor / viewer 三个角色的权限说明
- F08-02：页面顶部注明「角色权限为系统内置，如需调整请联系开发者」

**业务规则**：
- 页面纯展示，无可操作元素
- 仅 admin 可通过侧边栏导航访问

---

## 四、数据库表总览

| 表名 | 关键字段 | 说明 |
|------|---------|------|
| `themeConcept` | id(TEXT PK), name, overview, sort_order(INT\|null), title_color(TEXT\|null), updated_at(BIGINT), created_at(BIGINT) | 投资主题 |
| `themeStocks` | id(TEXT PK), theme_id(FK→themeConcept CASCADE), code, name, cat1, cat2, cat3, relation, stars(INT), highlight(TEXT), sort_order(INT\|null) | 股票池 |
| `adminUsers` | id(TEXT PK), username(UNIQUE), password_hash(TEXT), role(TEXT), created_at(BIGINT) | 系统用户（RLS 已开启） |
| `dailyReport` | id(TEXT PK), report_date(TEXT), report_type(TEXT), content(TEXT), summary(TEXT), created_at(BIGINT) | 每日早报 |
| `marketBreadth` | id(TEXT PK), trade_date(TEXT), rise(INT), fall(INT), flat(INT), limit_up(INT), limit_down(INT), created_at(BIGINT) | 市场涨跌家数 |

> ⚠️ 所有 `created_at` / `updated_at` 均存储 UTC 毫秒（BIGINT）。时区处理规范详见 [timezone-strategy.md](./timezone-strategy.md)

---

## 五、后台脚本说明

### 主题爬虫（`scripts/scraper/`）

| 脚本 | 用途 | 运行频率 |
|------|------|---------|
| `index.ts` | 增量同步：拉 API → 与 DB 对比 `update_time`（日期级）→ 有变化则 upsert，每次最多处理 20 个更新 | 日常定时 |
| `smart-sync.ts` | 全量补全：仅处理 DB 中股票为 0 的主题，支持断点续跑 | 初始化/修复用 |
| `full-init.ts` | 全量初始化：首次建库时使用 | 一次性 |
| `repair-empty-stocks.ts` | 修复 DB 中股票为 0 的主题 | 按需 |

### 早报系统（`scripts/zaobao/`）

- Python 脚本采集市场数据：akshare + baostock + yfinance + 财经新闻
- Node.js 脚本调用 Claude API（Sonnet 4.6）生成 Markdown 早报
- GitHub Actions 在每个交易日早晨定时触发
- 生成早报的同时附带采集当日涨跌家数，写入 `marketBreadth` 表

### 涨跌家数初始化

- `scripts/init_market_breadth.py`：使用 baostock 一次性初始化历史数据

---

## 六、文档维护约定

- **新增功能**：在 §二 模块目录新增一行，在 §三 新增对应章节
- **功能变更**：在对应需求点后追加注释，格式：`[变更 YYYY-MM-DD] 说明`
- **废弃功能**：需求点用 ~~删除线~~ 标注并注明废弃日期
- **每次 commit** 涉及功能变化时，同步更新本文档，commit message 注明 `docs: 更新需求文档`
- **详细设计文档**（auth/zaobao/timezone）：独立维护，本文仅保留链接引用
