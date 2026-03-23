# 财联社新闻采集系统需求文档

> 版本：v1.0
> 日期：2026-03-23
> 状态：待开发

---

## 一、背景与目标

替换现有 `news_collector.py`（akshare 采集方案），改为直接对接财联社内部 API，采集更丰富的字段（等级、分类、摘要、原始 URL 等），支持后续日报生成使用。

**新建独立数据表 `newsItems_cls`，停止旧任务 `news-collector.yml`，旧表 `newsItems` 和旧脚本代码均保留不删除。**

---

## 二、数据库表设计

### 表名：`newsItems_cls`

```sql
CREATE TABLE "newsItems_cls" (
  id           TEXT PRIMARY KEY,        -- 本系统 uuid，写入时生成
  cls_id       TEXT,                    -- 财联社原始文章 ID（深度/热榜文章使用，快讯为 NULL）
  title        TEXT NOT NULL,           -- 标题（快讯无标题时从内容提取，见第四节）
  summary      TEXT,                    -- 摘要（快讯为清洗后的内容，深度文章为 brief 字段）
  categories   TEXT[] DEFAULT '{}',     -- 多分类标签数组，见第三节
  level        TEXT,                    -- 新闻等级：A / B / C，见第三节
  url          TEXT DEFAULT '',         -- 原文链接，格式 https://www.cls.cn/detail/{cls_id}
  published_at BIGINT NOT NULL,         -- 文章原始发布时间，UTC 毫秒
  created_at   BIGINT NOT NULL          -- 写入数据库时间，UTC 毫秒
);
```

### 去重索引

```sql
-- 深度文章/热榜：按财联社文章 ID 去重
CREATE UNIQUE INDEX "newsItems_cls_cls_id_idx"
  ON "newsItems_cls"(cls_id)
  WHERE cls_id IS NOT NULL;

-- 快讯：按标题 + 发布时间去重
CREATE UNIQUE INDEX "newsItems_cls_title_time_idx"
  ON "newsItems_cls"(title, published_at)
  WHERE cls_id IS NULL;
```

### RLS 策略

```sql
ALTER TABLE "newsItems_cls" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow read"   ON "newsItems_cls" FOR SELECT USING (true);
CREATE POLICY "allow insert" ON "newsItems_cls" FOR INSERT WITH CHECK (true);
CREATE POLICY "allow update" ON "newsItems_cls" FOR UPDATE USING (true);
CREATE POLICY "allow delete" ON "newsItems_cls" FOR DELETE USING (true);
```

> ⚠️ 建表后必须立即在 Supabase SQL Editor 执行 RLS 策略，否则前端无法读写。

---

## 三、分类与等级规则

### 3.1 categories 取值说明

| 分类值 | 来源 | 含义 |
|--------|------|------|
| `热门` | 热门文章排行榜 | 基础分类 |
| `深度` | A股频道深度文章（top_list + depth_list） | 基础分类 |
| `快讯` | 财联社电报（telegraphList） | 基础分类 |
| `报告` | 任意来源 | 标题含「早报/午报/晚报/周报/周末要闻/新闻精选」则追加 |
| `提醒` | 任意来源 | 标题含「投资日历」或 subjects 含「提醒电报」则追加 |

**支持多分类**，同一条新闻可同时属于多个分类，如：
- 热榜中的早报：`['热门', '报告']`
- 深度频道中的早报：`['深度', '报告']`
- 快讯中的投资日历：`['快讯', '提醒']`

### 3.2 level 取值说明

| 来源 | level 规则 |
|------|-----------|
| 深度文章（A股频道） | 统一填 `A` |
| 热门文章 | 统一填 `A` |
| 报告类文章 | 统一填 `A` |
| 快讯 | 使用 API 原始 level 字段值（`A` / `B` / `C`） |

### 3.3 报告类识别规则

标题匹配正则（宽匹配，不限前缀）：

```python
REPORT_PATTERN = re.compile(r'早报|午报|晚报|周报|周末要闻|新闻精选')
```

适用范围：深度文章（depth_list）、热门文章（hot/list）、快讯（telegraphList）**三个来源均适用**。

### 3.4 提醒类识别规则

满足以下任一条件即追加 `提醒` 分类：

1. 标题含关键词：`投资日历`
2. API 返回的 `subjects` 字段中 `subject_name` = `提醒电报`

---

## 四、数据来源与采集逻辑

### 4.1 来源一：A 股频道深度文章

- **接口**：`GET https://www.cls.cn/v3/depth/home/assembled/1003`
- **参数**：`app=CailianpressWeb&os=web&sv=8.4.6&sign={动态获取}`
- **取字段**：`depth_list`
- **采集条数**：每次取前 20 条，再按时间窗口过滤（保留 `published_at` 在最近 3 小时内的）
- **默认分类**：`['A股']`，若触发报告/提醒规则则追加对应分类
- **URL 拼接**：`https://www.cls.cn/detail/{cls_id}`
- **去重字段**：`cls_id`

**字段映射：**

| API 字段 | 存入列 | 说明 |
|----------|--------|------|
| `id` | `cls_id` | 财联社文章 ID |
| `title` | `title` | 文章标题 |
| `brief` | `summary` | 文章摘要（可能为空） |
| `ctime` | `published_at` | Unix 秒 × 1000 → UTC 毫秒 |
| 拼接 | `url` | `https://www.cls.cn/detail/{id}` |

---

### 4.2 来源二：热门文章排行榜

- **接口**：`GET https://www.cls.cn/v2/article/hot/list`
- **参数**：`app=CailianpressWeb&os=web&sv=8.4.6&sign={动态获取}`
- **采集条数**：全量（当前约 13 条，无需过滤时间窗口）
- **默认分类**：`['热门']`，若触发报告/提醒规则则追加
- **URL 拼接**：`https://www.cls.cn/detail/{cls_id}`
- **去重字段**：`cls_id`

**字段映射：**

| API 字段 | 存入列 | 说明 |
|----------|--------|------|
| `id` | `cls_id` | 财联社文章 ID |
| `title` | `title` | 文章标题 |
| `brief` | `summary` | 文章摘要（可能为空） |
| `ctime` | `published_at` | Unix 秒 × 1000 → UTC 毫秒 |
| `readNum` | 不存 | 仅供调试参考 |

---

### 4.3 来源三：财联社快讯（电报）

- **接口**：`GET https://www.cls.cn/nodeapi/telegraphList`
- **参数**：`rn=50&app=CailianpressWeb&os=web&sv=8.4.6`（快讯接口**不需要 sign**）
- **采集条数**：`rn=50`，过滤最近 4 小时内发布的条目
- **默认分类**：`['快讯']`，若触发重点/报告/提醒规则则追加
- **去重字段**：`cls_id`（快讯也有 `id` 字段，统一使用）

> 注：快讯 `id` 字段同样为财联社文章 ID，可使用 `cls_id` 唯一索引去重，与深度/热榜共用同一索引。

**字段映射：**

| API 字段 | 存入列 | 说明 |
|----------|--------|------|
| `id` | `cls_id` | 财联社快讯 ID |
| `title` 或内容提取 | `title` | 见标题处理逻辑 |
| 内容提取 | `summary` | 见摘要处理逻辑 |
| `level` | `level` | 原始值 A / B / C |
| `ctime` | `published_at` | Unix 秒 × 1000 → UTC 毫秒 |
| `shareurl` | `url` | 快讯分享链接 |
| `subjects` | 用于分类判断 | 不单独存储 |

**快讯标题处理逻辑：**

```
if title 字段不为空:
    直接使用 title 字段

else（title 为空）:
    取 content 字段
    → 清洗无效前缀（顺序执行）：
        1. 去除 "财联社X月X日电，"（正则：财联社\d+月\d+日电[，,]\s*）
        2. 去除 "据报道，" / "据悉，" / "消息称，" 等
        3. 去除 "【...】" 格式的标签前缀（正则：^【[^】]*】）
    → 清洗后若不足 1 个汉字：跳过此条，不写入
    → 截取前 30 个中文字符作为 title
```

**快讯摘要处理逻辑：**

```
summary = content 字段完整内容（不截断，不清洗）
```

---

## 五、写入优先级与去重策略

### 5.1 写入顺序

同一次运行中，按以下顺序采集写入：

```
Step 1：热门文章（hot/list）        ← 优先级最高
Step 2：A 股深度文章（depth_list）  ← 次之
Step 3：快讯（telegraphList）       ← 优先级最低
```

### 5.2 去重逻辑

由于三个来源均使用 `cls_id`（财联社文章 ID）去重：

- **Step 1 写入热门**：直接 INSERT，`cls_id` 冲突则捕获 23505 静默跳过
- **Step 2 写入 A股深度**：同上，`cls_id` 已存在（热门已写）则跳过，**不覆盖**
- **Step 3 写入快讯**：同上，`cls_id` 已存在则跳过

**首次写入定终身，不追加 categories，不更新已有记录。**

### 5.3 跨次运行去重

依赖数据库唯一索引自然去重，INSERT 失败捕获 23505 错误静默跳过，不影响其他条目写入。

---

## 六、sign 动态获取

### 6.1 获取逻辑

```
每次脚本启动时执行：

1. 请求 https://www.cls.cn/depth?id=1003 页面 HTML
2. 正则提取 sign 值（匹配 sign=[a-f0-9]{32}）
3. 提取成功 → 使用新 sign，写入本地缓存文件（scripts/zaobao/python/.cls_sign_cache）
4. 提取失败 → 读取缓存文件中上次成功的 sign
5. 缓存也不存在 → 触发预警，脚本退出
```

### 6.2 sign 验证

获取 sign 后，用 sign 调用 hot/list 接口验证：

```
if errno == 0 and data 不为空 → sign 有效，继续执行
if errno != 0 or data 为空  → sign 无效，触发预警，脚本退出
```

### 6.3 注意

- 快讯接口（`telegraphList`）**不需要 sign**，不受此逻辑影响
- 缓存文件不提交到 Git（加入 .gitignore）

---

## 七、预警机制

### 7.1 触发条件

| 条件 | 级别 |
|------|------|
| sign 动态获取失败且缓存不存在 | 高 |
| sign 验证失败（errno ≠ 0） | 高 |
| Supabase 连接失败重试 3 次后仍失败 | 高 |
| 某一来源连续采集结果为空（非节假日/凌晨） | 中（仅记录日志，不退出） |

### 7.2 预警方式

**双保险：**

1. `exit(1)` → GitHub Actions job 失败 → GitHub 自动发邮件
2. Bark 推送（环境变量 `BARK_KEY`）→ 手机实时通知

```python
def send_alert(msg: str):
    # Bark 推送
    if BARK_KEY:
        requests.get(f'https://api.day.app/{BARK_KEY}/财联社采集预警/{msg}', timeout=5)
    # 日志输出（GitHub Actions 会记录）
    print(f'[ALERT] {msg}', file=sys.stderr)
```

---

## 八、数据清理

- 保留最近 **7 天**数据（与原 `newsItems` 保持一致）
- 每次脚本运行结束后执行清理
- 清理失败只记录 warning，**不阻断采集流程**

```sql
DELETE FROM "newsItems_cls" WHERE published_at < {7天前UTC毫秒}
```

---

## 九、定时任务配置

### 9.1 新建：`cls-news-collector.yml`

```yaml
name: 财联社新闻采集
on:
  schedule:
    - cron: '17 */3 * * *'    # 每3小时第17分钟，北京时间 02:17/05:17/08:17...
  workflow_dispatch:            # 支持手动触发

concurrency:
  group: cls-news-collector
  cancel-in-progress: false     # 不取消进行中的任务，等待完成

jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r scripts/zaobao/python/requirements.txt
      - run: python scripts/zaobao/python/cls_news_collector.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          BARK_KEY: ${{ secrets.BARK_KEY }}
```

### 9.2 停止旧任务：`news-collector.yml`

将现有 `news-collector.yml` 中的 `schedule` 触发器注释掉，保留 `workflow_dispatch` 以便手动调试：

```yaml
on:
  # schedule:
  #   - cron: '7 * * * *'   # 已停用，由 cls-news-collector.yml 替代
  workflow_dispatch:
```

---

## 十、脚本文件

### 文件路径

```
scripts/zaobao/python/cls_news_collector.py   ← 新建采集脚本
scripts/zaobao/python/.cls_sign_cache         ← sign 缓存文件（加入 .gitignore）
.github/workflows/cls-news-collector.yml      ← 新建定时任务
.github/workflows/news-collector.yml          ← 修改：注释掉 schedule
```

### 脚本整体结构

```
cls_news_collector.py
├── 环境变量检查（缺失则 exit(1)）
├── fetch_sign()              动态获取并验证 sign
├── collect_hot()             采集热门文章
├── collect_depth_ashare()    采集 A股深度文章
├── collect_flash()           采集快讯
├── clean_flash_title()       快讯标题清洗
├── detect_categories()       分类规则判断
├── upsert_news()             去重写入
├── cleanup_old_news()        清理 7 天前旧数据
├── send_alert()              预警推送
└── run()                     主流程编排
```

---

## 十一、边界场景处理

| 场景 | 处理方式 |
|------|---------|
| 某一采集来源网络超时 | 单独 try/catch，记录日志，其余来源继续执行 |
| depth_list / hot/list 返回空列表 | 记录 warning，不触发预警（非交易时段正常） |
| 快讯清洗后标题为空 | 跳过该条，不写入 |
| 文章 cls_id 相同但 title 不同（文章被修改） | 保持首次写入内容，不更新 |
| 同一 cls_id 同时出现在多个来源 | 按写入顺序（热门>A股>快讯）首次写入，后续跳过 |
| 早报等报告类同时在热榜出现 | 热榜先写入，categories 含 `['热门', '报告']` |
| Supabase 连接失败 | 重试 3 次，间隔 5 秒，仍失败则预警 + exit(1) |
| 去重冲突（23505 错误） | 静默跳过，不记录为错误 |
| 旧数据清理失败 | 记录 warning，不影响采集流程 |
| GitHub Actions 并发 | concurrency 配置等待，不取消进行中的任务 |

---

## 十二、早报生成时传给 Claude 的新闻规则

新闻数据从 `newsItems_cls` 表按时间窗口读取后，按 **level 等级** 拆分为两层传入：

| 层级 | 条件 | 传入内容 |
|------|------|---------|
| 优先层 | `level = 'A'` | 时间 + 等级标签 + 标题 + 摘要 |
| 普通层 | `level != 'A'`（B/C） | 时间 + 等级标签 + 标题 |

**排序规则**：两层均按 level 升序（A→B→C）、同等级按发布时间降序排列。

**新闻时间窗口：**
- 交易日早报：昨日 12:00 BJ → 今日 08:00 BJ
- 周末/节假日周报：周五 15:00 BJ → 当日 18:00 BJ

---

## 十三、环境变量依赖

| 变量名 | 来源 | 必须 | 说明 |
|--------|------|------|------|
| `SUPABASE_URL` | GitHub Secrets | ✅ | Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | GitHub Secrets | ✅ | Supabase anon key |
| `BARK_KEY` | GitHub Secrets | ❌ | Bark 推送 key，缺失时只 exit(1) |
