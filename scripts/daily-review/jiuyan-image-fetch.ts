/**
 * 韭研公社涨停简图 - 图片版结构化提取
 *
 * 用法：tsx jiuyan-image-fetch.ts [YYYY-MM-DD]
 * 输出：JSON 到 stdout，格式见文件末尾
 *
 * 步骤：
 *   1. 调 /api/v1/action/diagram-url 拿到当天涨停简图 PNG 的 OSS URL
 *   2. 下载图片
 *   3. 调 Claude Opus 4.6 Vision 解析成结构化 JSON（按板块分组）
 *
 * 依赖环境变量：
 *   - JIUYAN_SESSION         韭研 SESSION cookie（登录态）
 *   - ANTHROPIC_AUTH_TOKEN   Claude API token（代理）
 *   - ANTHROPIC_BASE_URL     Claude 代理地址
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as https from 'node:https';
import { spawnSync } from 'node:child_process';

const SIGN_SECRET = 'Uu0KfOB8iUP69d3c';
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
  data: string; // 图片 URL
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

async function downloadImage(url: string): Promise<{ buffer: Buffer; mediaType: 'image/png' | 'image/jpeg' }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`图片下载失败 HTTP ${resp.status}`);
  let buf = Buffer.from(await resp.arrayBuffer());
  const head = new Uint8Array(buf.slice(0, 4));
  const isJpeg = head[0] === 0xff && head[1] === 0xd8;
  let mediaType: 'image/png' | 'image/jpeg' = isJpeg ? 'image/jpeg' : 'image/png';

  // 大图压缩：>2MB 时缩到 1200px 宽 JPEG，避免 base64 超出代理限制
  if (buf.byteLength > 2 * 1024 * 1024) {
    try {
      const sharp = (await import('sharp')).default;
      const compressed = await sharp(buf)
        .resize({ width: 1200 })
        .jpeg({ quality: 85 })
        .toBuffer();
      console.error(`     → 压缩: ${(buf.byteLength / 1024).toFixed(0)}KB → ${(compressed.byteLength / 1024).toFixed(0)}KB`);
      buf = compressed;
      mediaType = 'image/jpeg';
    } catch (e) {
      console.error(`     → 压缩失败，使用原图: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { buffer: buf, mediaType };
}

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
 * 策略：在 JSON 字符串内部，遇到 " 后面不是 ,}]: 则判定为内嵌引号，替换为中文引号。
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

    // 在字符串内
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
      // 判断是字符串结束还是内嵌引号
      let j = i + 1;
      while (j < s.length && ' \t\n\r'.includes(s[j])) j++;
      if (j >= s.length || ',}]:'.includes(s[j])) {
        // 正常字符串结束
        result.push(ch);
        inStr = false;
      } else {
        // 内嵌引号 → 替换为中文左引号
        result.push('\u201c');
      }
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

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

async function parseWithVision(imageUrl: string): Promise<LimitUpThemeOut[]> {
  // 下载原图到本地临时文件，让 CLI 用 Read 工具读取（避免 base64 超限和网络超时）
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`图片下载失败 HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const tmpPath = '/tmp/limit-up-diagram.png';
  fs.writeFileSync(tmpPath, buf);
  console.error(`     → 图片已保存到 ${tmpPath} (${(buf.byteLength / 1024).toFixed(0)}KB)`);

  const fullPrompt = `请用 Read 工具读取图片文件 ${tmpPath}，然后根据图片内容完成以下任务：\n\n${PROMPT}`;

  const result = spawnSync(
    'claude',
    ['-p', '--no-session-persistence', '--dangerously-skip-permissions', '--model', 'claude-opus-4-6'],
    {
      timeout: 300_000,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      input: fullPrompt,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    },
  );
  if (result.status !== 0) {
    const errDetail = result.stderr || result.stdout || '';
    throw new Error(`CLI 退出码 ${result.status}: ${errDetail.slice(-500)}`);
  }
  const rawText = result.stdout;

  const text = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const startIdx = text.indexOf('{');
  if (startIdx === -1) throw new Error(`Vision 未返回 JSON：${text.slice(0, 200)}`);
  let jsonStr = fixInnerQuotes(text.slice(startIdx));
  jsonStr = trimToJsonEnd(jsonStr);
  jsonStr = repairTruncatedJson(jsonStr);

  const parsed = JSON.parse(jsonStr) as { themes?: LimitUpThemeOut[] };
  return parsed.themes ?? [];
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const session = process.env.JIUYAN_SESSION;
  if (!session) throw new Error('缺少 JIUYAN_SESSION 环境变量');
  if (!process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('缺少 ANTHROPIC_AUTH_TOKEN 环境变量');

  console.error(`[1/3] 拉取 ${date} 涨停简图 URL...`);
  const imageUrl = await fetchDiagramUrl(date, session);
  console.error(`     → ${imageUrl}`);

  console.error(`[2/3] 下载图片...`);
  console.error(`[3/3] Claude Opus 4.6 Vision 解析（本地文件 + Read 工具）...`);
  const themes = await parseWithVision(imageUrl);

  // 规范化 count = stocks.length
  for (const t of themes) t.count = t.stocks.length;
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
