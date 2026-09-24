/**
 * 韭研公社涨停简图 - 通义千问 Vision 结构化提取
 *
 * 用法：tsx jiuyan-image-fetch.ts [YYYY-MM-DD]
 * 输出：JSON 到 stdout
 *
 * 步骤：
 *   1. 调 /api/v1/action/diagram-url 拿到当天涨停简图 PNG 的 OSS URL
 *   2. 调通义千问 qwen3.7-plus 解析成结构化 JSON（按板块分组）
 *
 * SESSION 失效时会用账号密码自动重新登录，新 SESSION 缓存到 appConfig 表，
 * 因此正常情况下几十天才登录一次（见 resolveImageUrl）。
 *
 * 依赖环境变量：
 *   - JIUYAN_SESSION       韭研 SESSION cookie（登录态，appConfig 无缓存时的兜底）
 *   - JIUYAN_PHONE         韭研账号手机号（自动重登用）
 *   - JIUYAN_PASSWORD      韭研账号密码（自动重登用）
 *   - SUPABASE_URL / SUPABASE_SERVICE_KEY   SESSION 缓存读写（缺失则降级为只读环境变量）
 *   - DASHSCOPE_API_KEY    通义千问 API 密钥
 */

import * as crypto from 'node:crypto';
import * as https from 'node:https';
import { fixInnerQuotes, trimToJsonEnd, repairTruncatedJson } from './json-repair';

const SIGN_SECRET = process.env.JIUYAN_SIGN_SECRET || '';
const API_HOST = 'app.jiuyangongshe.com';
const DIAGRAM_PATH = '/jystock-app/api/v1/action/diagram-url';
const LOGIN_PATH = '/jystock-app/api/v1/user/login';
const SESSION_CONFIG_KEY = 'jiuyan_session';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

/* 登录态失效，可通过重新登录自愈；与网络错误、解析失败区分开，避免无谓的登录请求 */
class SessionExpiredError extends Error {}

function signHeaders(ts: number): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    timestamp: String(ts),
    token: computeToken(ts),
    platform: '3',
    version: '1.8.7',
    Origin: 'https://www.jiuyangongshe.com',
    Referer: 'https://www.jiuyangongshe.com/',
    'User-Agent': USER_AGENT,
  };
}

function fetchDiagramUrl(date: string, session: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const time = Date.now();
    const body = JSON.stringify({ date, pc: 1 });

    const req = https.request(
      {
        hostname: API_HOST,
        path: DIAGRAM_PATH,
        method: 'POST',
        headers: {
          ...signHeaders(time),
          Cookie: `SESSION=${session}`,
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
              const detail = `errCode=${parsed.errCode} msg=${parsed.msg}`;
              const expired =
                String(parsed.errCode) === '1' || (parsed.msg || '').includes('登录失效');
              reject(
                expired
                  ? new SessionExpiredError(`diagram-url 登录失效 ${detail}`)
                  : new Error(`diagram-url 异常 ${detail}`),
              );
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
    /* 韭研接口收盘高峰期可能挂起，不设超时会卡满外层 360s 无明确报错 */
    req.setTimeout(30_000, () => req.destroy(new Error('diagram-url 请求超时(30s)')));
    req.write(body);
    req.end();
  });
}

// ─── SESSION 自愈（缓存 + 密码重登） ─────────────────────────────────────────

interface LoginResp {
  errCode: string;
  msg: string;
  data?: { sessionToken?: string };
}

interface RestConfig {
  url: string;
  headers: Record<string, string>;
}

/*
 * 直接调 PostgREST 而不用 supabase-js：快讯 workflow 不装 npm 依赖，
 * 本脚本必须保持只依赖 Node 内置模块，否则 npx tsx 会 ERR_MODULE_NOT_FOUND。
 * 缺少凭证时返回 null（本地补采场景），调用方降级为只用环境变量的 SESSION。
 */
function getRestConfig(): RestConfig | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    url: `${url.replace(/\/$/, '')}/rest/v1/appConfig`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

async function readCachedSession(rest: RestConfig | null): Promise<string | null> {
  if (!rest) return null;
  try {
    const query = `select=value&key=eq.${encodeURIComponent(SESSION_CONFIG_KEY)}`;
    const resp = await fetch(`${rest.url}?${query}`, {
      headers: rest.headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${await resp.text()}`);
    const rows = (await resp.json()) as Array<{ value: unknown }>;
    return typeof rows[0]?.value === 'string' && rows[0].value ? rows[0].value : null;
  } catch (e) {
    console.error(`     ⚠️ 读取 SESSION 缓存失败，回退环境变量: ${(e as Error).message}`);
    return null;
  }
}

async function writeCachedSession(rest: RestConfig | null, session: string): Promise<void> {
  if (!rest) return;
  try {
    const resp = await fetch(`${rest.url}?on_conflict=key`, {
      method: 'POST',
      headers: { ...rest.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key: SESSION_CONFIG_KEY, value: session, updated_at: Date.now() }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${await resp.text()}`);
  } catch (e) {
    console.error(`     ⚠️ SESSION 缓存写入失败（本次仍可用）: ${(e as Error).message}`);
  }
}

async function login(): Promise<string> {
  const phone = process.env.JIUYAN_PHONE;
  const password = process.env.JIUYAN_PASSWORD;
  if (!phone || !password) {
    throw new Error('SESSION 已失效，但未配置 JIUYAN_PHONE / JIUYAN_PASSWORD，无法自动重登');
  }

  const resp = await fetch(`https://${API_HOST}${LOGIN_PATH}`, {
    method: 'POST',
    headers: signHeaders(Date.now()),
    body: JSON.stringify({ phone, password }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!resp.ok) throw new Error(`韭研登录 HTTP ${resp.status}`);

  const json = (await resp.json()) as LoginResp;
  const sessionToken = json.data?.sessionToken;
  if (String(json.errCode) !== '0' || !sessionToken) {
    throw new Error(`韭研登录失败 errCode=${json.errCode} msg=${json.msg}`);
  }
  return sessionToken;
}

/* SESSION 优先用 appConfig 缓存，失效时重登一次并回写缓存，保证登录频率 ≈ 每个有效期一次 */
async function resolveImageUrl(date: string): Promise<string> {
  const rest = getRestConfig();
  const session = (await readCachedSession(rest)) || process.env.JIUYAN_SESSION;
  if (!session) throw new Error('缺少 JIUYAN_SESSION 环境变量');

  try {
    return await fetchDiagramUrl(date, session);
  } catch (e) {
    if (!(e instanceof SessionExpiredError)) throw e;
    console.error(`     ⚠️ ${e.message}，尝试账号密码重新登录...`);
    const fresh = await login();
    await writeCachedSession(rest, fresh);
    console.error('     → 重登成功，重试 diagram-url（仅一次）');
    return fetchDiagramUrl(date, fresh);
  }
}

// JSON 修复工具已提取到 json-repair.ts

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
    model: 'qwen3.7-plus',
    enable_thinking: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    max_tokens: 30000,
  });

  console.error(`     → 调用通义千问 qwen3.7-plus...`);
  /*
   * 单次给足 320s、不做脚本内重试：涨停多的交易日 Qwen 输出上万 token，生成常超 120s，
   * 短超时+重试对慢生成无意义（重试同样超时，2026-09-18 三轮全灭教训）。
   * 每小时的采集窗口（17:00-20:00）本身就是重试机制；30s 取图 + 320s 解析 < 外层 360s。
   */
  const resp = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(320_000),
    },
  );
  if (!resp.ok) throw new Error(`Qwen API 错误 HTTP ${resp.status}: ${await resp.text()}`);

  const result = await resp.json() as {
    choices?: { message?: { content?: string; finish_reason?: string } }[];
  };
  const choice = result.choices?.[0];
  const rawText = choice?.message?.content ?? '';
  const finishReason = (choice as { finish_reason?: string } | undefined)?.finish_reason
    ?? (choice?.message as { finish_reason?: string } | undefined)?.finish_reason;

  console.error(`     → Qwen 返回 ${rawText.length} 字符`);
  if (finishReason === 'length') {
    console.error(`     ⚠️ 输出被 max_tokens 截断，将尝试修复 JSON`);
  }
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
  /* 可选第 3 参数：已知简图 URL 时直接解析，跳过韭研接口（本地补采无 SIGN_SECRET 时用） */
  const urlArg = process.argv[3];
  if (!process.env.DASHSCOPE_API_KEY) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  let imageUrl: string;
  if (urlArg) {
    console.error(`[1/2] 使用传入的简图 URL（跳过韭研接口）`);
    imageUrl = urlArg;
  } else {
    console.error(`[1/2] 拉取 ${date} 涨停简图 URL...`);
    imageUrl = await resolveImageUrl(date);
  }
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
