/**
 * 韭研公社涨停简图结构化提取
 *
 * 用法：tsx jiuyan-fetch.ts [YYYY-MM-DD]
 * 输出：JSON 到 stdout，格式见文件末尾
 *
 * 数据源：POST https://app.jiuyangongshe.com/jystock-app/api/v1/action/field
 *   - 请求头 token = MD5("Uu0KfOB8iUP69d3c:" + timestamp)
 *   - Cookie: SESSION=<env.JIUYAN_SESSION>
 *   - Body:   {"date":"YYYY-MM-DD","pc":1}
 *
 * 过滤规则（与网页"涨停简图"图片对齐）：
 *   - 排除 ST 板块（name 含 "ST"）
 *   - 排除表头占位项（name==='简图' 或无 action_field_id 或无股票数据）
 *   - shares_range 字段按 /100 归一化为百分比；price 按 /100 归一化为元
 */

import * as crypto from 'node:crypto';
import * as https from 'node:https';

const SIGN_SECRET = 'Uu0KfOB8iUP69d3c';
const API_HOST = 'app.jiuyangongshe.com';
const API_PATH = '/jystock-app/api/v1/action/field';

interface ActionInfo {
  day?: number; // 连板数
  time?: string; // 首次封板时间
  num?: number; // 炸板次数
  price?: number; // 涨停价
  shares_range?: number; // 换手率（原值 × 100）
  expound?: string; // 涨停原因
}

interface StockItem {
  code: string;
  name: string;
  article?: { action_info?: ActionInfo };
}

interface ThemeItem {
  name: string;
  count?: number;
  reason?: string;
  list?: StockItem[];
  action_field_id?: string;
}

interface StockOut {
  code: string;
  name: string;
  day: number | null;
  time: string | null;
  num: number | null;
  price: number | null;
  turnover: number | null; // 换手率 %
  expound: string;
}

interface ThemeOut {
  name: string;
  count: number;
  reason: string;
  stocks: StockOut[];
}

function computeToken(timestamp: number): string {
  return crypto.createHash('md5').update(`${SIGN_SECRET}:${timestamp}`).digest('hex');
}

interface ApiResponse {
  msg: string;
  errCode: string;
  data: ThemeItem[];
}

function fetchActionField(date: string, session: string): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const time = Date.now();
    const token = computeToken(time);
    const body = JSON.stringify({ date, pc: 1 });

    const req = https.request(
      {
        hostname: API_HOST,
        path: API_PATH,
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
            const text = Buffer.concat(chunks).toString('utf8');
            resolve(JSON.parse(text));
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

function isStName(name: string): boolean {
  const upper = name.toUpperCase();
  // ST / *ST / SST 等
  return /\bST\b/.test(upper) || upper.startsWith('*ST') || upper.startsWith('SST');
}

function extractThemes(list: ThemeItem[]): ThemeItem[] {
  return list.filter(
    (t) =>
      !!t.action_field_id &&
      t.name !== '简图' &&
      Array.isArray(t.list) &&
      t.list.length > 0 &&
      !!t.list[0]?.code,
  );
}

function normalizeStock(s: StockItem): StockOut | null {
  if (!s.code || !s.name) return null;
  if (isStName(s.name)) return null;
  const ai = s.article?.action_info || {};
  const sharesRange = typeof ai.shares_range === 'number' ? ai.shares_range / 100 : null;
  const price = typeof ai.price === 'number' ? ai.price / 100 : null;
  return {
    code: s.code,
    name: s.name,
    day: typeof ai.day === 'number' ? ai.day : null,
    time: typeof ai.time === 'string' ? ai.time : null,
    num: typeof ai.num === 'number' ? ai.num : null,
    price,
    turnover: sharesRange,
    expound: ai.expound || '',
  };
}

function normalizeTheme(t: ThemeItem): ThemeOut | null {
  if (!t.name) return null;
  if (isStName(t.name)) return null; // 排除 ST 板块本身
  const stocks = (t.list || [])
    .map(normalizeStock)
    .filter((s): s is StockOut => s !== null);
  if (stocks.length === 0) return null;
  return {
    name: t.name,
    count: stocks.length,
    reason: t.reason || '',
    stocks,
  };
}

async function main() {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10);
  const session = process.env.JIUYAN_SESSION;
  if (!session) {
    throw new Error('缺少 JIUYAN_SESSION 环境变量，请在 .env.local 中配置登录 SESSION cookie');
  }

  const resp = await fetchActionField(date, session);
  if (resp.errCode !== '0') {
    throw new Error(`韭研 API 返回异常 errCode=${resp.errCode} msg=${resp.msg}`);
  }

  const rawThemes = extractThemes(resp.data || []);
  const themes: ThemeOut[] = rawThemes
    .map(normalizeTheme)
    .filter((t): t is ThemeOut => t !== null);

  const totalStocks = themes.reduce((sum, t) => sum + t.count, 0);

  const output = {
    pick_date: date,
    source_url: `https://${API_HOST}${API_PATH}`,
    theme_count: themes.length,
    stock_count: totalStocks,
    themes,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error('[jiuyan-fetch] 失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
