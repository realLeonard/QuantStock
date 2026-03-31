# QuantStock App 设计文档

## 概述

将现有 QuantStock Web 项目扩展出跨平台移动端 App，目标平台为微信小程序、Android、iOS，鸿蒙后续版本。App 面向中国 A 股投资者，支持付费订阅和用户管理，追求推广覆盖面最大化。

---

## 功能规划（三个底部菜单）

### 1. 日报
- 列表页：按日期倒序，显示日期、摘要
- 详情页：Markdown 完整渲染（付费可见）
- 免费用户只看摘要，付费会员看全文

### 2. 掘金
- 今日股票池（功能待定，暂留占位入口）

### 3. 我的
**① 个人资料**
- 头像（支持上传）
- 昵称

**② 付费 Plan 信息**
- 付费类型：免费 / 试用 / 月度 / 季度 / 年度
- 有效期 + 剩余天数
- 升级付费入口

**③ 设置**
- 当前版本号
- 隐私政策
- 服务条款
- 联系我们
- 删除缓存

---

## 技术选型

| 层级 | 技术 |
|------|------|
| App 框架 | uni-app（Vue 3 + TypeScript） |
| IDE | HBuilderX（官方，内置模拟器、一键发布） |
| UI 组件库 | uv-ui（精致，跨端兼容，支持鸿蒙） |
| 状态管理 | Pinia |
| Markdown 渲染 | mp-html 或 towxml（小程序/App 通用） |
| 网络请求 | uni.request 封装 |
| 数据源 | Supabase REST API（复用现有 DB） |
| 支付 | 微信支付订阅 + iOS 苹果内购 |
| 推送 | UniPush（App）+ 微信订阅消息（小程序） |
| 发布渠道 | 微信小程序 + Android + iOS + 鸿蒙（后续） |

---

## 项目目录结构

```
ClaudeDemo/
├── apps/
│   ├── web/                        ← 现有 Next.js（不动）
│   └── mobile/                     ← 新增 uni-app
│       ├── src/
│       │   ├── pages/
│       │   │   ├── report/
│       │   │   │   ├── index.vue       ← 日报列表
│       │   │   │   └── detail.vue      ← 日报详情
│       │   │   ├── jinjin/
│       │   │   │   └── index.vue       ← 掘金（占位）
│       │   │   ├── mine/
│       │   │   │   ├── index.vue       ← 我的主页
│       │   │   │   ├── profile.vue     ← 个人资料
│       │   │   │   ├── plan.vue        ← 付费 Plan
│       │   │   │   └── settings.vue    ← 设置
│       │   │   └── auth/
│       │   │       ├── login.vue       ← 登录/注册
│       │   │       └── pay.vue         ← 付费页
│       │   ├── components/
│       │   │   ├── ReportCard.vue      ← 日报列表卡片
│       │   │   ├── MarkdownView.vue    ← Markdown 渲染
│       │   │   ├── PayWall.vue         ← 付费墙组件
│       │   │   └── PlanBadge.vue       ← 会员标签
│       │   ├── store/
│       │   │   ├── user.ts             ← 用户状态（Pinia）
│       │   │   └── report.ts           ← 日报状态（Pinia）
│       │   ├── api/
│       │   │   ├── supabase.ts         ← Supabase 客户端初始化
│       │   │   ├── auth.ts             ← 登录/注册接口
│       │   │   ├── report.ts           ← 日报接口
│       │   │   └── user.ts             ← 用户信息接口
│       │   ├── utils/
│       │   │   ├── permission.ts       ← 权限判断工具
│       │   │   └── date.ts             ← 日期工具
│       │   └── styles/
│       │       └── variables.scss      ← 全局设计变量（颜色、字号）
│       ├── static/
│       ├── manifest.json
│       ├── pages.json
│       └── package.json
├── packages/
│   ├── types/                      ← 复用：DailyReport 等类型
│   └── ...
```

---

## 用户体系

### 架构：Supabase Auth + 自建 appUsers 表（弱依赖）

- **Supabase Auth**：只负责验证身份（手机号验证码 / 微信 OAuth），返回 JWT
- **appUsers 表**：存所有业务数据，通过 `auth_id` 关联，便于未来迁移

### 注册 / 登录方式
- 手机号 + 短信验证码
- 微信一键登录（小程序用 `wx.login`，App 用微信 OAuth）
- 暂不做邮箱注册

### appUsers 表

```sql
CREATE TABLE appUsers (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_id           UUID UNIQUE NOT NULL,       -- 关联 Supabase Auth UID
  nickname          TEXT,
  avatar_url        TEXT,
  phone             TEXT,
  wechat_openid     TEXT UNIQUE,               -- 微信一键登录
  plan_type         TEXT DEFAULT 'free',       -- free / trial / monthly / quarterly / yearly
  plan_expired_at   BIGINT,                    -- 会员到期时间（UTC ms）
  last_login_at     BIGINT,                    -- 最后登录时间（每次进 App 更新）
  created_at        BIGINT NOT NULL
);
```

---

## 权限矩阵

| 内容 | 未登录 / 免费用户 | 试用期内 | 付费会员（有效） |
|------|------------------|---------|----------------|
| 日报列表 | ✅ | ✅ | ✅ |
| 日报摘要（非当日） | ✅ | ✅ | ✅ |
| 日报摘要（当日） | ❌ | ✅ | ✅ |
| 日报全文（非当日） | ✅ | ✅ | ✅ |
| 日报全文（当日） | ❌ | ✅ | ✅ |
| 掘金（非当日） | ✅ | ✅ | ✅ |
| 掘金（当日） | ❌ | ✅ | ✅ |

> 未登录与免费用户权限完全一致。

### 登录 / 注册引导策略

| 场景 | 引导方式 |
|------|---------|
| 未登录点击当日内容 | 跳登录页，提示「注册即享 3 天免费试用」 |
| 首次注册成功 | 自动激活 trial，plan_expired_at = 注册时间 + 3天 |
| 已注册用户登录（从未购买，试用已过期） | 显示「试用已结束」，引导升级付费 |
| 已购用户会员到期 | 显示「已过期 X 天」，引导续费 |
| 试用期到期 | 降为 free，当日内容重新锁定 |

---

## 付费流程

- **付费模式**：订阅制（自动续费），月度 / 季度 / 年度
- 微信小程序 / Android：微信支付订阅
- iOS：苹果内购订阅（IAP，强制要求），需监听退款回调降级会员
- **支付安全**：服务端接收支付回调后才更新 plan_type，客户端不可信

---

## 推送通知

- 每日早报生成后自动推送：App（UniPush）+ 微信小程序（订阅消息）
- WxPusher 暂时保留并行运行
- **Bark 通知运营者**：用户注册、付费成功 2 个场景触发

---

## 数据统计（自建）

```sql
CREATE TABLE userEvents (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT,                    -- appUsers.id，未登录为 NULL
  event_type   TEXT NOT NULL,           -- view_report / pay_success / register 等
  target_id    TEXT,                    -- 关联内容 ID（如 report_date）
  duration_ms  INTEGER,                 -- 停留时长（毫秒）
  platform     TEXT,                    -- miniprogram / android / ios
  created_at   BIGINT NOT NULL
);
```

---

## 用户反馈

```sql
CREATE TABLE userFeedback (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT,                      -- 可为 NULL（未登录也能提交）
  content    TEXT NOT NULL,
  contact    TEXT,                      -- 用户留的联系方式（可选）
  platform   TEXT,
  created_at BIGINT NOT NULL
);
```

---

## 版本控制

```sql
CREATE TABLE appConfig (
  key        TEXT PRIMARY KEY,          -- min_version / announcement 等
  value      TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

App 启动时读取 `min_version`，低于最低版本强制升级。

---

## 新增数据库表汇总

| 表名 | 用途 |
|------|------|
| `appUsers` | C 端用户业务数据（会员状态、头像昵称等） |
| `userEvents` | 用户行为统计（浏览、停留时长） |
| `userFeedback` | 用户在线反馈表单 |
| `appConfig` | App 版本控制、公告等配置 |

---

## UI 设计原则

- 以 iOS 高质量交互和配色为基准（圆角卡片、模糊背景、层次阴影、SF 风格字重）
- 多端交互一致性：同一套交互逻辑和视觉语言，在小程序、Android、iOS 上体验统一
- 颜色体系：深色/浅色模式均支持，主色调参考 iOS 金融类 App 风格（深蓝/白/金）
- 动效：页面切换、列表加载、下拉刷新保持统一节奏感

---

## 缓存策略

- 非当日日报详情：本地缓存，支持离线阅读
- 当日内容：不缓存（防付费绕过）
- 设置页「删除缓存」清空本地历史缓存

---

## 开发规范

**代码规范：**
- Vue3 组合式 API（`<script setup>`），TypeScript 严格模式
- 组件命名 PascalCase，文件/目录 kebab-case
- ESLint + Prettier，与现有 Web 项目规范一致

**环境配置：**
- 开发/生产环境分离：`.env.development` / `.env.production`
- Supabase URL、anon key、微信 AppID 等敏感配置走环境变量，不硬编码
- 不同平台的 AppID 在 `manifest.json` 中按条件配置

**错误处理：**
- 全局请求拦截：统一处理 401（token 过期自动刷新或跳登录）、网络超时
- 用户可见错误用 Toast 提示，不暴露技术细节
- 关键错误（支付失败、注册失败）上报到 `userEvents` 表

**发布流程：**
- 微信小程序：HBuilderX 一键上传 → 微信公众平台提审
- Android：HBuilderX 打包 → 各应用市场（华为、小米、应用宝等）分发
- iOS：HBuilderX 打包 → Xcode Archive → App Store Connect 提审
- 鸿蒙（后续）：HBuilderX 打包 → 华为 AGC 提审

**隐私与合规：**
- 首次启动弹出隐私政策弹窗，用户主动同意后才初始化 SDK
- 注册页手机号收集需用户主动勾选同意（不可默认勾选）
- App 权限（相机、相册）按需申请，使用时才请求
- 早报免责声明在详情页底部固定显示

---

## 合规检查清单

- [ ] ICP 备案（上线前完成）
- [ ] 微信小程序金融类目资质确认
- [ ] Android 应用市场软著准备
- [ ] iOS App Store 订阅协议和退款政策配置
- [ ] 隐私政策页面上线
- [ ] 服务条款页面上线
