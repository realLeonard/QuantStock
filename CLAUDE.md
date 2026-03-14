# 项目开发规范

## 语言规范
- 所有对话和文档都使用中文
- 注释使用中文
- 错误提示使用中文
- 文档使用中文Markdown格式

## 代码规范
- 使用ESLint + Prettier
- 缩进使用2个空格
- 最大行长度100字符
- 函数采用小驼峰命名
- 组件采用大驼峰命名
- 常量使用全大写下划线分隔
- 文件和目录名使用kebab-case（如 `user-profile/`、`use-auth.ts`）
- 组件文件名使用PascalCase（如 `UserProfile.tsx`）

## Git规范
- 使用conventional commits
- commit message 使用中文描述
- feat: 新功能
- fix: 修复bug
- docs: 文档更新
- refactor: 代码重构
- style: 代码格式调整（不影响逻辑）
- test: 添加或修改测试
- chore: 构建流程、依赖管理等杂项
- 分支命名规范：`feature/xxx`、`fix/xxx`、`docs/xxx`
- 禁止直接 push 到 main/master 分支

## 开发原则
- 单一职责原则
- 每个PR只解决一个问题
- PR合并前需至少1人代码审批
- 代码必须有单元测试
- 注释用中文，代码用英文

## 时区处理规范（必须检查）

> ⚠️ 每次涉及时间字段的代码，必须遵守以下规则，否则会产生跨环境时区偏差 bug。

- **数据库存储**：所有时间戳统一存为 UTC 毫秒（BIGINT）
- **API 传输**：统一使用 ISO 8601 UTC 字符串（带 `Z` 后缀，如 `"2026-03-14T02:10:00.000Z"`）
- **解析外部时间字符串**：凡是来自中国数据源（如韭研公社 API）的无时区标识字符串，必须显式指定 `+08:00` 解析，禁止直接 `new Date(str)`
  ```typescript
  // ✅ 正确
  function parseBeijingTime(str: string): number {
    return new Date(str.replace(' ', 'T') + '+08:00').getTime();
  }
  // ❌ 错误（在 UTC 环境如 GitHub Actions 会偏差 8 小时）
  new Date('2026-03-14 10:00:00').getTime()
  ```
- **前端用户输入**：使用 `new Date().toISOString()` 提交，后端直接 `new Date(isoStr).getTime()` 解析
- **前端展示**：从 DB 读出 UTC 毫秒后，转换为北京时间显示
  ```typescript
  new Date(utcMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  ```
- **详细方案**：见 `docs/timezone-strategy.md`

## 个人偏好
- 优先使用函数式组件
- 状态管理使用Zustand
- 样式使用CSS Modules
- 避免使用any类型
- TypeScript开启严格模式（`strict: true`）
- HTTP请求使用axios
- 包管理器使用npm
