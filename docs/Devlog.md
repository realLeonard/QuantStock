# 开发日志

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
1. **数据库**：新增 `adminUsers` 表（id, username, password_hash, role, created_at），RLS 已开启，初始账号 `admin / admin123`
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
