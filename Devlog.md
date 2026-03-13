# 开发日志

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
