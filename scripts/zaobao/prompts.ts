/**
 * Claude 提示词模板
 * 早报生成 prompt — 两层结构：关键新闻 + 分析
 */

export const SYSTEM_PROMPT = `你是一位专业的 A 股投资顾问，擅长从宏观到微观分析市场，帮助投资者把握每日机会。

你的任务是根据提供的市场数据和新闻，生成一份结构清晰、观点鲜明的每日投资早报。

**核心原则：**
- 开头一句话：2-3句，涵盖市场基调、核心驱动因素、操作方向，不可过于简短
- 新闻层：从原始新闻中精选 10-15 条最重要的，附上一句话影响说明，让用户看到你判断的依据
- 分析层：基于数据和新闻，给出你的综合判断，不是简单摘抄
- 重要程度标注：🔴（高影响）🟡（中影响）⚪（低影响）
- 简洁有力，每条结论要有依据，不废话

**新闻优先级规则（从高到低）：**
1. cls_focus（财联社重点）— 编辑精选，最高优先级
2. cls_flash（财联社快讯）— 主力信源
3. cls_notice（财联社公告）— A股公告类
4. em_flash / ths_flash — 辅助印证
5. cctv — 政策权威信号

**如果同一事件被多个来源重复报道，视为热点，优先选入。**

**输出语言：** 中文`;


// ===== 格式化新闻为紧凑文本 =====
function formatNews(
  items: Array<Record<string, unknown>>,
  sourceLabel: string
): string {
  if (!items || items.length === 0) return '';
  return items
    .map(item => {
      const pubMs = Number(item.published_at ?? 0);
      const dt = pubMs > 0
        ? new Date(pubMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '--:--';
      const title = String(item.title ?? '').trim();
      return `${dt} ${title}`;
    })
    .join('\n');
}

// ===== 生成 ASCII 涨跌趋势图 =====
function buildAsciiTrend(breadthHistory: Array<Record<string, unknown>>): string {
  if (!breadthHistory || breadthHistory.length === 0) return '（暂无数据）';

  const maxRise = Math.max(...breadthHistory.map(r => Number(r.rise ?? 0)));
  const BAR_MAX = 12;

  const lines = breadthHistory.map(row => {
    const date = String(row.trade_date ?? '').slice(5); // MM-DD
    const rise = Number(row.rise ?? 0);
    const fall = Number(row.fall ?? 0);
    const limitUp = Number(row.limit_up ?? 0);
    const barLen = maxRise > 0 ? Math.round((rise / maxRise) * BAR_MAX) : 0;
    const bar = '█'.repeat(barLen);
    return `${date}  ${bar.padEnd(BAR_MAX)} ${String(rise).padStart(4)} 涨 / ${String(fall).padStart(4)} 跌 / 涨停${limitUp}`;
  });

  return lines.join('\n');
}

// ===== 格式化宏观数据为紧凑文本 =====
function formatMacro(macroData: Record<string, unknown>): string {
  const lines: string[] = [];

  const pushLatest = (key: string, label: string, valueField: string, unit = '') => {
    const item = macroData[key] as Record<string, unknown> | undefined;
    if (!item?.success) return;
    const data = item.data as Array<Record<string, unknown>> | undefined;
    if (!data || data.length === 0) return;
    const latest = data[data.length - 1];
    const val = latest[valueField] ?? latest['value'] ?? latest['数值'] ?? '?';
    const period = latest['date'] ?? latest['月份'] ?? latest['时间'] ?? '';
    lines.push(`${label}：${period} ${val}${unit}`);
  };

  pushLatest('cpi', 'CPI', '今值', '%');
  pushLatest('ppi', 'PPI', '今值', '%');
  pushLatest('pmi_manufacturing', '制造业PMI', '今值');
  pushLatest('pmi_non_manufacturing', '非制造业PMI', '今值');
  pushLatest('m2', 'M2增速', '今值', '%');
  pushLatest('social_financing', '社融增量', '社融规模增量', '亿');
  pushLatest('reserve_ratio', '存准率', '存款准备金率大型金融机构', '%');

  // 国债收益率取最新一行的10年期
  const bondItem = macroData['bond_yield'] as Record<string, unknown> | undefined;
  if (bondItem?.success) {
    const data = bondItem.data as Array<Record<string, unknown>> | undefined;
    if (data && data.length > 0) {
      const latest = data[data.length - 1];
      const y10 = latest['10年'] ?? latest['中债国债收益率:10年'] ?? '';
      if (y10) lines.push(`10年期国债收益率：${y10}%`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '（暂无宏观数据）';
}

// ===== 构建用户 Prompt =====
export function buildUserPrompt(params: {
  date: string;
  reportType: 'trading' | 'weekly';
  aShareData: Record<string, unknown>;
  intlData: Record<string, unknown>;
  macroData: Record<string, unknown>;
  newsItems: Record<string, Array<Record<string, unknown>>>;
  breadthHistory: Array<Record<string, unknown>>;
  previousSummary?: string;
}): string {
  const { date, reportType, aShareData, intlData, macroData, newsItems, breadthHistory, previousSummary } = params;

  // 新闻紧凑格式
  const newsSection = `
## 新闻数据（按来源分层）

### 财联社重点（最高优先级，编辑精选）
${formatNews(newsItems.cls_focus, 'cls_focus') || '（无数据）'}

### 财联社快讯（主力信源）
${formatNews(newsItems.cls_flash, 'cls_flash') || '（无数据）'}

### 财联社公告精选
${formatNews(newsItems.cls_notice, 'cls_notice') || '（无数据）'}

### 东方财富快讯（辅助）
${formatNews(newsItems.em_flash, 'em_flash') || '（无数据）'}

### 同花顺快讯（辅助）
${formatNews(newsItems.ths_flash, 'ths_flash') || '（无数据）'}

### 央视新闻联播（政策权威）
${formatNews(newsItems.cctv, 'cctv') || '（无数据）'}
`.trim();

  // 市场行情紧凑格式
  const marketSection = `
## 市场行情数据

### A股（akshare）
\`\`\`json
${JSON.stringify(aShareData, null, 2).slice(0, 5000)}
\`\`\`

### 国际市场（yfinance）
\`\`\`json
${JSON.stringify(intlData, null, 2).slice(0, 3000)}
\`\`\`
`.trim();

  // 宏观数据
  const macroSection = `
## 宏观经济数据
${formatMacro(macroData)}
`.trim();

  // 近7日涨跌趋势
  const trendSection = `
## 近7日 A 股涨跌家数趋势（上涨家数越高情绪越好）
${buildAsciiTrend(breadthHistory)}
`.trim();

  const prevSection = previousSummary
    ? `\n## 昨日预判（用于验证）\n${previousSummary}\n`
    : '';

  const typeInstruction = reportType === 'weekly'
    ? '今日为非交易日（周末/节假日），请生成「本周回顾与下周展望」版本。'
    : '今日为 A 股交易日，请生成标准早报。';

  return `请根据以下 ${date} 的数据，生成投资早报。

${typeInstruction}
${prevSection}

${newsSection}

${marketSection}

${macroSection}

${trendSection}

---

请按以下格式输出：

📰 投资早报  ${date}  08:00

━━━ 今日一句话 ━━━
（2-3句话概括：①今日市场整体基调（涨跌/情绪）②最重要的1个宏观或新闻驱动因素 ③今日操作方向建议）

━━━ 今日关键新闻 ━━━
（从所有新闻源中精选 10-15 条最重要的，格式：🔴/🟡/⚪ HH:MM [标题] → 一句话影响说明）
（相同话题多源报道的视为热点，优先选入；全球重大动向也纳入）

━━━ 市场全景 ━━━
（美股/港股隔夜表现 → 重点板块表现（如科技/能源/金融等） → A股三大指数走势 → 北向资金 → 全市场涨跌家数简述）

━━━ 近7日情绪趋势 ━━━
（直接复制下方 ASCII 趋势图，并加 1-2 句判断：情绪改善/恶化/横盘，与昨日对比）

━━━ 宏观与政策 ━━━
（最新宏观数据有无变化？货币政策信号？有重要变化则重点说，无变化则一行带过）

━━━ 板块与资金 ━━━
（今日资金流入/流出 TOP 板块，热点主线判断，涨停板结构）

━━━ 昨日预判验证 ━━━
（如有昨日预判则验证准确性，否则略去此节）

━━━ 今日操作指引 ━━━
🎯 重点关注板块：
⚠️ 回避或谨慎：
📌 开盘注意：

---
注意：新闻层要让用户看到你选取的原始信号，分析层要给出你的综合判断，两者都不可省略。`;
}
