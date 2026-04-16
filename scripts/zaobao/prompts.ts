/**
 * Claude 提示词模板
 * 早报生成 prompt — 两层结构：关键新闻 + 分析
 */

export const SYSTEM_PROMPT = `你是一位专业的 A 股投资顾问，擅长从宏观到微观分析市场，帮助投资者把握每日机会。

你的任务是根据提供的市场数据和新闻，生成一份结构清晰、观点鲜明的每日投资早报。

**核心原则：**
- 今日核心概述：分三点展开——①市场基调（有据可依）②核心驱动因素（1-3个，说明依据和影响方向）③今日操作方向（进攻/防守/观望，说明理由），不可泛泛而谈
- 新闻层：从原始新闻中精选 10-15 条最重要的，附上一句话影响说明，让用户看到你判断的依据
- 分析层：基于数据和新闻，给出你的综合判断，不是简单摘抄
- 重要程度标注：🔴（高影响）🟡（中影响）⚪（低影响）
- 简洁有力，每条结论要有依据，不废话

**新闻优先级规则（从高到低）：**
1. A 级新闻 — 重大事件，附有摘要，最高优先级
2. B/C 级新闻 — 仅标题，按重要程度选入
3. 等级标签 [A]=重大 [B]=重要 [C]=一般，优先选入 A/B 级新闻

**如果同一事件在重要资讯和快讯中都有出现，视为热点，必须选入。**

**关于昨日盘面数据的使用：**
- 盘面数据仅为"昨日客观事实背景"，不是今日预判的主导因素
- 新闻是最新变量，当新闻与昨日盘面矛盾时，以新闻为准
- 禁止直接复述昨日盘面数据，应将其作为推演今日方向的依据之一
- 连板天梯/涨停题材聚合/资金延续性 是判断主线延续 vs 衰减的关键线索
- 历史基线对比（涨停数/炸板率/晋级率）用于判断情绪"升温 or 退潮"
- 两融数据是 T-1 披露（看 trade_date），只作趋势参考，不可当日描述

**输出语言：** 中文
**报告末尾格式：** 以"*本报告仅供参考，不构成投资建议*"结尾，禁止添加数据来源注释（如"数据来源：财联社、AKShare、YFinance"等）。`;


// ===== 格式化新闻为紧凑文本 =====
function formatNews(
  items: Array<Record<string, unknown>>,
  withSummary = false
): string {
  if (!items || items.length === 0) return '';
  return items
    .map(item => {
      const pubMs = Number(item.published_at ?? 0);
      const dt = pubMs > 0
        ? new Date(pubMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '--:--';
      const level = String(item.level ?? '').trim();
      const title = String(item.title ?? '').trim();
      const levelTag = level ? `[${level}] ` : '';
      if (withSummary) {
        const summary = String(item.summary ?? '').trim();
        return summary
          ? `${dt} ${levelTag}${title}\n  ${summary}`
          : `${dt} ${levelTag}${title}`;
      }
      return `${dt} ${levelTag}${title}`;
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
  newsItems: { priority: Array<Record<string, unknown>>; flash: Array<Record<string, unknown>> };
  breadthHistory: Array<Record<string, unknown>>;
  previousSummary?: string;
  /** 昨日复盘结构化数据块（formatReviewForZaobao 输出），为空时回退到 aShareData */
  reviewMarkdown?: string;
  /** 历史基线（近5日对比） */
  historyBaseline?: string;
  /** 板块资金近3日延续性 */
  sectorContinuity?: string;
  /** 昨日板块回测结果块（代码硬注入，AI 不得篡改数字） */
  yesterdayReviewBlock?: string;
  /** 近7日板块命中率字符串 */
  recentHitRate?: string;
}): string {
  const {
    date, reportType, aShareData, intlData, macroData, newsItems,
    breadthHistory, previousSummary, reviewMarkdown, historyBaseline, sectorContinuity,
    yesterdayReviewBlock, recentHitRate,
  } = params;

  // 新闻紧凑格式
  const newsSection = `
## 新闻数据

### A 级新闻（重大事件，含摘要）
${formatNews(newsItems.priority, true) || '（无数据）'}

### B/C 级新闻（仅标题）
${formatNews(newsItems.flash, false) || '（无数据）'}
`.trim();

  // 市场行情紧凑格式：优先用复盘结构化数据块，无则回退到 akshare 原始 JSON
  const aShareBlock = reviewMarkdown
    ? reviewMarkdown
    : `### A股（akshare 兜底，复盘数据缺失）\n\`\`\`json\n${JSON.stringify(aShareData, null, 2).slice(0, 5000)}\n\`\`\``;

  const baselineBlock = historyBaseline
    ? `\n### 情绪趋势（近5日基线对比）\n${historyBaseline}\n`
    : '';
  const continuityBlock = sectorContinuity
    ? `\n### 板块延续性（近3日主力净流入）\n${sectorContinuity}\n`
    : '';

  const marketSection = `
## 市场行情数据

${aShareBlock}
${baselineBlock}${continuityBlock}
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
    ? `\n## 昨日预判摘要（参考）\n${previousSummary}\n`
    : '';

  // 昨日回测（板块 + 个股，代码硬注入，AI 不得改动数字）
  const reviewResultSection = yesterdayReviewBlock
    ? `\n## 昨日回测（板块 + 个股，代码硬注入，下方数字**必须原样引用**，禁止修改、美化或隐藏未命中项）\n\`\`\`\n${yesterdayReviewBlock}\n\`\`\`\n` +
      `> 命中口径说明：板块命中 = 超额收益（板块涨跌 - 沪300）≥ 0.3%（关注方向）或 ≤ -0.3%（规避方向），剔除大盘普涨/普跌的假阳性；个股命中 = 绝对涨跌幅 ≥ 1%（关注方向上涨 / 规避方向下跌）。\n`
    : '';

  // 近7日命中率
  const hitRateLine = recentHitRate
    ? `\n## 近7日滚动命中率\n${recentHitRate}\n`
    : '';

  const typeInstruction = reportType === 'weekly'
    ? '今日为非交易日（周末/节假日），请生成「本周回顾与下周展望」版本。'
    : '今日为 A 股交易日，请生成标准早报。';

  return `请根据以下 ${date} 的数据，生成投资早报。

${typeInstruction}
${prevSection}${reviewResultSection}${hitRateLine}

${newsSection}

${marketSection}

${macroSection}

${trendSection}

---

请按以下格式输出：

📰 投资早报  ${date}  08:00

━━━ 30秒速读 ━━━
⚡ 基调：（一句话概括今日市场预判，40 字以内，例："外盘强势提振但昨日资金分化，预计高开承压、结构分化加剧"）
🎯 主攻：（板块1 / 板块2 / 板块3，最多3个，不解释）
⚠️ 规避：（板块1 / 板块2，最多2个，不解释）
📊 仓位：（进攻 / 均衡 / 防守 / 观望 四选一 + 一句话理由，50 字以内）
🔑 关键变量：（今日盘中最需要盯的 1 个验证点，60 字以内，例："CPO 板块能否首日量价齐升站稳，若主力资金延续昨日流入则确认主线"）
📈 近7日命中率：（**原样引用上方"近7日滚动命中率"一行，无数据则留空**）

━━━ 今日核心概述 ━━━
①【市场基调】今日整体市场情绪与风险偏好判断，依据是什么（外盘表现/资金面/情绪指标等）
②【核心驱动因素】今日最重要的 1-3 个驱动因素，每个因素说明来源依据及对市场的影响方向
③【今日操作方向】基于以上判断，给出具体操作建议（进攻/防守/观望），操作板块方向有些哪，并说明理由

━━━ 今日关键新闻 ━━━
（从所有新闻源中精选 10-20 条最重要的，格式：🔴/🟡/⚪ MM-DD HH:MM [标题] → 一句话影响说明（如有关联板块请注明，如：涉及板块：半导体/新能源；涉及个股：中芯国际/北方华创））
（相同话题多源报道的视为热点，优先选入；全球重大动向也纳入）

━━━ 宏观与政策 ━━━
（最新宏观数据有无变化？货币政策信号？有重要变化则重点解读：数据含义是什么、对市场有何影响、受益或受损板块；无变化则一行带过）

━━━ 市场全景 ━━━
（美股/港股隔夜表现 → 重点板块表现（如科技/能源/金融等））

━━━ 昨日A股概况 ━━━
（A股三大指数涨跌 → 北向资金净流入/流出 → 资金流入/流出 TOP 板块 → 热点主线判断 → 涨停板数量与结构 → 全市场涨跌家数）

━━━ 近7日情绪趋势 ━━━
（直接复制下方 ASCII 趋势图，并加 1-2 句判断：情绪改善/恶化/横盘，与昨日对比）

━━━ 昨日命中回顾 ━━━
（**必须原样复制上方"昨日回测（板块 + 个股）"数据块的全部内容（包括每个板块下的"个股："明细行），不得改动数字、不得省略未命中项、不得删除个股明细行**。
之后用 2-3 句做简短归因，聚焦"误判原因"和"超预期原因"，可同时点出"板块对了但选股错了"或反之的偏差，不得美化结果。
若无昨日回测数据，略去此节。）

━━━ 今日操作指引 ━━━
🎯 重点关注板块：（列出板块，如有代表性个股可列出 2-3 只）
⚠️ 回避或谨慎：（列出需回避的板块或个股）
📌 开盘注意：

| 类　　型 | 板　　块 | 重点个股（2-3只） | 消息面 | 数据面(辅助) |
|---------|---------|-----------------|--------|--------------|
| 🎯 关注 | | | | |
| 🎯 关注 | | | | |
| 🎯 关注 | | | | |
| ⚠️ 规避 | | | | |
| ⚠️ 规避 | | | | |

**两列填写规则：**
- **消息面（主导，核心）**：必填。引用具体新闻要点，说清催化逻辑，长度不做硬限制但保持精炼。新闻是早报的核心数据源，代表最新变量，是决策的主要依据。
- **数据面(辅助)**：尽量填。从昨日盘面客观数据中寻找验证信号，从以下类别任选：
  * 板块资金延续性（近3日净流入趋势：放大/衰减/流出转向）
  * 连板天梯高度（板块内最高板数、龙头名字）
  * 情绪基线对比（晋级率/炸板率 vs 5日均值）
  * 同花顺热度排名（TOP3/TOP10）
  * 龙虎榜/游资动向（谁在买、买了什么）
  * 两融杠杆水位（高位警示/低位企稳）

**重要原则（次序不可颠倒）：**
- **新闻优先**：若新闻足够强（A 级、政策、产业重磅催化），即使昨日数据未反应也保留该条，数据面可填 "—"、"首日待量能确认"、"昨日无沉淀" 等说明
- 数据缺失不等于证伪，只是说明该主线昨日未被资金消化；强新闻完全可以成为进攻方向，保留新闻的主导地位
- 数据与新闻相悖时（如资金持续流出但新闻利好），不强制降级，但必须在数据面里明确标出矛盾（如"资金净流出3日 → 谨慎高开低吸"）
- 规避方向可以"纯数据驱动"（消息面填 "—"），如"高位连板获利回吐、晋级率低于均值"

---
注意：
- 新闻层是早报的核心数据源，代表最新变量；昨日盘面数据是辅助验证，代表昨日客观状态
- 两者都展示让用户看到完整证据链，但决策主导权在新闻，不因数据缺失而删除强新闻主线`;
}
