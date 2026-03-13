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

## 个人偏好
- 优先使用函数式组件
- 状态管理使用Zustand
- 样式使用CSS Modules
- 避免使用any类型
- TypeScript开启严格模式（`strict: true`）
- HTTP请求使用axios
- 包管理器使用npm
