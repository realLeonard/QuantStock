# 股海远洋 App（uni-app 移动端）

## 技术栈
- **框架**：uni-app（Vue 3 + TypeScript）
- **状态管理**：Pinia
- **网络请求**：uni.request 封装（兼容小程序/App/H5）
- **数据源**：Supabase REST API（直连）
- **Markdown 渲染**：mp-html（待接入）

## 目录结构

```
src/
├── pages/
│   ├── report/         # 日报列表 + 详情
│   ├── jinjin/         # 掘金（占位）
│   ├── mine/           # 我的
│   └── auth/           # 登录/注册
├── store/
│   ├── user.ts         # 用户状态（登录态、会员状态）
│   └── report.ts       # 日报数据
├── api/
│   ├── supabase.ts     # Supabase REST 请求封装
│   ├── report.ts       # 日报接口
│   └── user.ts         # 用户/事件接口
├── utils/
│   ├── time.ts         # 时间处理（北京时间）
│   ├── permission.ts   # 权限矩阵
│   └── cache.ts        # 本地缓存管理
└── types/
    └── index.ts        # App 端类型定义
```

## 开发环境

### 前置要求
- 安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（uni-app 官方 IDE）
- 或使用 CLI：`npm install -g @vue/cli` + `@dcloudio/vue-cli-plugin-uni`

### 配置环境变量
复制 `.env.development`，填入实际 Supabase 凭证：
```env
VITE_SUPABASE_URL=https://wtogbmrbcgpmbtybkvle.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 运行
```bash
# 微信小程序
npm run dev:mp-weixin

# H5 调试
npm run dev:h5

# App
npm run dev:app
```

## 数据库表
执行 `scripts/init-app-tables.sql` 创建以下表：
- `appUsers` — C 端用户（会员状态、头像昵称）
- `userEvents` — 用户行为统计
- `userFeedback` — 用户反馈
- `appConfig` — App 版本控制、公告

## 权限矩阵

| 内容 | 游客/免费 | 试用期内 | 付费会员 |
|------|----------|---------|---------|
| 日报列表 | ✅ | ✅ | ✅ |
| 日报摘要（非当日）| ✅ | ✅ | ✅ |
| 日报全文（非当日）| ✅ | ✅ | ✅ |
| 日报摘要（当日） | ❌ | ✅ | ✅ |
| 日报全文（当日） | ❌ | ✅ | ✅ |

## 发布配置
- 微信小程序：在 `manifest.json` 的 `mp-weixin.appid` 填入 AppID
- App 端：在 `manifest.json` 的 `app-plus.distribute.sdkConfigs.payment.weixin.appid` 填入微信支付 AppID
- iOS：需配置 UniversalLinks
