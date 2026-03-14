# 时区处理规范

## 背景

本项目采集的数据来自中国区（北京时间 UTC+8），但服务端运行环境均在中国以外：

- **GitHub Actions**：UTC 环境
- **Vercel 前端**：UTC 环境
- **Supabase 数据库**：UTC 环境
- **用户**：中国用户，浏览器本地时间为 UTC+8

如不显式处理时区，`new Date("2026-03-14 10:00:00")` 在不同环境会产生 8 小时偏差。

---

## 统一原则：UTC 作为唯一存储标准

```
原始数据（中国时区）
    ↓  parse 时明确指定 +08:00
存入 DB（UTC 毫秒 BIGINT）
    ↓  API 返回 UTC ISO 字符串
前端展示时转换为北京时间
```

---

## 各环节规则

### 1. 解析外部中国时区字符串（爬虫 / 用户上传）

外部数据源返回的时间字符串通常不带时区标识，如 `"2026-03-14 10:00:00"`，必须显式指定 `+08:00`：

```typescript
// ✅ 正确：任何机器上结果一致
function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

// ❌ 错误：UTC 机器（GitHub Actions）解析结果比本地 UTC+8 机器多 8 小时
new Date('2026-03-14 10:00:00').getTime()
```

### 2. 数据库存储

所有时间戳字段统一存储为 **UTC 毫秒（BIGINT）**：

```
themeConcept.created_at  → UTC 毫秒
themeConcept.updated_at  → UTC 毫秒
adminUsers.created_at    → UTC 毫秒（Postgres NOW() 本身是 UTC）
```

不使用 TIMESTAMP 类型，避免 ORM 层的隐式时区转换。

### 3. API 传输

前后端之间统一使用 **ISO 8601 UTC 字符串**（带 `Z` 后缀）：

```typescript
// 后端响应
{ updated_at: new Date(utcMs).toISOString() }
// → "2026-03-14T02:10:00.000Z"

// 前端发送（JS Date 内部就是 UTC）
{ create_time: new Date().toISOString() }
// → "2026-03-14T02:10:00.000Z"
```

后端解析前端时间：
```typescript
const utcMs = new Date(isoStr).getTime(); // ISO 字符串带 Z，永远正确
```

### 4. 前端展示

从 DB 读出 UTC 毫秒，展示时转为北京时间：

```typescript
// 基础用法
new Date(utcMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
// → "2026/3/14 10:10:00"

// 格式化
new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit'
}).format(new Date(utcMs))
// → "2026/03/14 10:10"
```

---

## 各数据表时间字段状态

| 表 | 字段 | 类型 | 状态 |
|---|---|---|---|
| `themeConcept` | `created_at` | BIGINT UTC ms | ✅ 已修复（2026-03-14） |
| `themeConcept` | `updated_at` | BIGINT UTC ms | ✅ 已修复（2026-03-14） |
| `themeStocks` | 无时间字段 | — | — |
| `adminUsers` | `created_at` | BIGINT UTC ms | ✅ 正确（Postgres NOW()） |

---

## 历史问题与修复记录

**问题**：2026-03-14 发现，原始 909 条 `themeConcept` 数据的 `created_at` 和 `updated_at`
均偏差 +8 小时。原因是初次批量导入在 GitHub Actions（UTC）执行，
北京时间字符串 `"2026-03-14 10:00:00"` 被 `new Date()` 误解析为 UTC，
实际应为 `2026-03-14T02:00:00Z`，却存成了 `2026-03-14T10:00:00Z`。

**修复**：执行 `scripts/scraper/fix-updated-at.ts --apply`，909 条全部修正，0 失败。
代码层同步引入 `parseBeijingTime()` 工具函数，从根本上杜绝此类问题。

---

## 快速检查清单

新增或修改涉及时间的代码时，逐条过一遍：

- [ ] 是否有直接 `new Date(str)` 解析来自中国数据源的字符串？→ 改用 `parseBeijingTime()`
- [ ] 存入 DB 的时间是否为 UTC 毫秒？
- [ ] API 响应的时间字段是否带 `Z` 后缀的 ISO 字符串？
- [ ] 前端展示是否指定了 `timeZone: 'Asia/Shanghai'`？
