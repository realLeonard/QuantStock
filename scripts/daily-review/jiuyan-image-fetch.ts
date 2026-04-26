/**
 * 韭研公社涨停简图 - 通义千问 Vision 结构化提取
 *
 * 用法：tsx jiuyan-image-fetch.ts [YYYY-MM-DD]
 * 输出：JSON 到 stdout
 *
 * 步骤：
 *   1. 调 /api/v1/action/diagram-url 拿到当天涨停简图 PNG 的 OSS URL
 *   2. 调通义千问 qwen3-vl-plus 解析成结构化 JSON（按板块分组）
 *
 * 依赖环境变量：
 *   - JIUYAN_SESSION       韭研 SESSION cookie（登录态）
 *   - DASHSCOPE_API_KEY    通义千问 API 密钥
 */

import * as crypto from 'node:crypto';
import * as https from 'node:https';

const SIGN_SECRET = process.env.JIUYAN_SIGN_SECRET || '';
const API_HOST = 'app.jiuyangongshe.com';
const DIAGRAM_PATH = '/jystock-app/api/v1/action/diagram-url';

interface LimitUpStockOut {
  board: string;
  code: string;
  name: string;
  time: string;
  float_mv: number | null;
  turnover_amt: number | null;
  keyword: string;
}

interface LimitUpThemeOut {
  name: string;
  count: number;
  stocks: LimitUpStockOut[];
}

interface DiagramUrlResp {
  msg: string;
  errCode: string;
  data: string;
}

function computeToken(ts: number): string {
  return crypto.createHash('md5').update(`${SIGN_SECRET}:${ts}`).digest('hex');
}

function fetchDiagramUrl(date: string, session: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const time = Date.now();
    const token = computeToken(time);
    const body = JSON.stringify({ date, pc: 1 });

    const req = https.request(
      {
        hostname: API_HOST,
        path: DIAGRAM_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          timestamp: String(time),
          token,
          platform: '3',
          version: '1.8.7',
          Cookie: `SESSION=${session}`,
          Origin: 'https://www.jiuyangongshe.com',
          Referer: 'https://www.jiuyangongshe.com/',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DiagramUrlResp;
            if (String(parsed.errCode) !== '0' || !parsed.data) {
              reject(new Error(`diagram-url 异常 errCode=${parsed.errCode} msg=${parsed.msg}`));
              return;
            }
            resolve(parsed.data);
          } catch (e) {
            reject(e);
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── JSON 修复工具 ───────────────────────────────────────────────────────────

function trimToJsonEnd(str: string): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return str.slice(0, i + 1);
    }
  }
  return str;
}

function repairTruncatedJson(str: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) str += '"';
  return str + stack.reverse().join('');
}

/**
 * 修复 JSON 字符串值中未转义的双引号。
 * Vision 常返回如 "keyword":"投资"凌空天行"" — 内嵌中文引号导致解析失败。
 */
function fixInnerQuotes(s: string): string {
  const result: string[] = [];
  let i = 0;
  let inStr = false;

  while (i < s.length) {
    const ch = s[i];

    if (!inStr) {
      result.push(ch);
      if (ch === '"') inStr = true;
      i++;
      continue;
    }

    if (ch === '\\') {
      result.push(ch);
      if (i + 1 < s.length) {
        result.push(s[i + 1]);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && ' \t\n\r'.includes(s[j])) j++;
      if (j >= s.length || ',}]:'.includes(s[j])) {
        result.push(ch);
        inStr = false;
      } else {
        result.push('“');
      }
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

// ─── Vision Prompt ───────────────────────────────────────────────────────────

const PROMPT = `这是一张"韭研公社今天涨停复盘简图"的表格图片。表格列依次为：
  1. 板数（如"首板"、"5天4板"、"4连板"；当 "X天Y板" 中 X===Y 时图片会直接显示为 "Y连板"，请原样记录）
  2. 代码（6位数字）
  3. 个股（股票名）
  4. 涨停时间（HH:MM）
  5. 流通市值（单位：亿元）
  6. 成交额（单位：亿元）
  7. 涨停关键词（文字描述）

表格里穿插着"板块分隔行"，形如 "算力*11"（板块名 + "*" + 该板块涨停数），占据整行。板块分隔行下方所有股票都归属于该板块，直到遇到下一个分隔行。

任务：按板块分组输出 JSON，不要任何说明文字或 markdown 代码块，严格按以下结构：

{"themes":[{"name":"板块名","count":11,"stocks":[{"board":"首板","code":"301606","name":"XXX","time":"09:31","float_mv":23.45,"turnover_amt":8.12,"keyword":"AI算力"}]}]}

规则：
- 保持图片原始顺序
- "板数"里的 "X天Y板"、"Y连板"、"首板" 原样放到 board 字段
- float_mv / turnover_amt 用数字（亿元），识别不清时填 null，不要填字符串
- code 必须是 6 位数字字符串，保留前导零
- time 格式 "HH:MM"
- 忽略水印、页眉、标题、二维码、风险提示区域
- 若某板块内没有股票，丢弃该板块
- 输出 JSON 的 themes[i].count 必须等于其 stocks 数组长度（以图片分隔行的 *N 为准时，若实际行数不一致以实际行数为准）`;

// ─── 通义千问 Vision 解析 ────────────────────────────────────────────────────

async function parseWithQwen(imageUrl: string): Promise<LimitUpThemeOut[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  const body = JSON.stringify({
    model: 'qwen3-vl-plus',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 8192,
  });

  console.error(`     → 调用通义千问 qwen3-vl-plus...`);
  const resp = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(300_000),
    },
  );
  if (!resp.ok) throw new Error(`Qwen API 错误 HTTP ${resp.status}: ${await resp.text()}`);

  const result = await resp.json() as {
    choices?: { message?: { content?: string } }[];
  };
  const rawText = result.choices?.[0]?.message?.content ?? '';

  console.error(`     → Qwen 返回 ${rawText.length} 字符`);
  const text = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const startIdx = text.indexOf('{');
  if (startIdx === -1) throw new Error(`Qwen 未返回 JSON：${text.slice(0, 200)}`);
  let jsonStr = fixInnerQuotes(text.slice(startIdx));
  jsonStr = trimToJsonEnd(jsonStr);
  jsonStr = repairTruncatedJson(jsonStr);

  const parsed = JSON.parse(jsonStr) as { themes?: LimitUpThemeOut[] };
  return parsed.themes ?? [];
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const session = process.env.JIUYAN_SESSION;
  if (!session) throw new Error('缺少 JIUYAN_SESSION 环境变量');
  if (!process.env.DASHSCOPE_API_KEY) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  console.error(`[1/2] 拉取 ${date} 涨停简图 URL...`);
  const imageUrl = await fetchDiagramUrl(date, session);
  console.error(`     → ${imageUrl}`);

  console.error(`[2/2] 通义千问 VL 解析...`);
  const themes = await parseWithQwen(imageUrl);

  for (const t of themes) {
    t.count = t.stocks.length;
    for (const s of t.stocks) {
      s.code = s.code.replace(/\.\w+$/, '');
    }
  }
  const totalStocks = themes.reduce((s, t) => s + t.count, 0);
  console.error(`     → ${themes.length} 板块 / ${totalStocks} 股票`);

  const output = {
    pick_date: date,
    raw_image_url: imageUrl,
    theme_count: themes.length,
    stock_count: totalStocks,
    themes,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('[jiuyan-image-fetch] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
