import { createHash } from 'crypto';

const BASE = 'https://app.jiuyangongshe.com/jystock-app/api/v1';
const SIGN_KEY = 'Uu0KfOB8iUP69d3c';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 可重试的网络/服务端错误（不重试业务逻辑错误）
function isRetryableFetchError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    err.name === 'TimeoutError' ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('http 5') // 5xx 服务端错误
  );
}

function headers(): Record<string, string> {
  const ts = String(Date.now());
  const token = createHash('md5').update(`${SIGN_KEY}:${ts}`).digest('hex');
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'token': token,
    'timestamp': ts,
    'platform': '3',
    'referer': 'https://www.jiuyangongshe.com/',
  };
}

// list 接口已包含全部所需字段，无需再调 detail
export interface ThemeItem {
  industry_id: string;
  title: string;
  content: string;
  imgs: string;        // JSON 字符串，如 '["https://...png"]'
  create_time: string;
  update_time: string; // 最后修改时间，内容更新后变化
  author: string | null; // null 或空字符串为官方内容，非空为用户贡献
  title_red: number;      // 1 = 主题名称标红
  sort_no: number | null; // 主题列表排序序号
}

interface ListData {
  result: ThemeItem[];
  totalCount: number;
  hasNext: boolean;
  nextPage: number;
}

// 返回单页主题列表（start 从 1 开始，limit 每页数量），网络失败自动重试
export async function fetchList(start: number, limit = 50): Promise<ListData> {
  let lastErr!: Error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/industry/list`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ keyword: '', start, limit }),
        signal: AbortSignal.timeout(15_000),
      }).catch(e => {
        if ((e as Error).name === 'TimeoutError') throw new Error('韭研公社 API 请求超时（15s），网络或服务异常');
        throw e;
      });
      if (!res.ok) throw new Error(`fetchList HTTP ${res.status}`);
      const json = await res.json() as { data: ListData; errCode: string; msg: string };
      // 业务级错误（如 token 失效）不重试，直接抛出
      if (json.errCode !== '0') throw new Error(`fetchList 接口错误: ${json.msg}`);
      return json.data;
    } catch (e) {
      lastErr = e as Error;
      // 业务错误直接抛出，不重试
      if (lastErr.message.startsWith('fetchList 接口错误')) throw lastErr;
      if (attempt < 3 && isRetryableFetchError(lastErr)) {
        const delay = 3_000 * (2 ** (attempt - 1));
        console.warn(`  fetchList start=${start} 第${attempt}次失败，${delay / 1000}s 后重试: ${lastErr.message}`);
        await sleep(delay);
      } else {
        throw lastErr;
      }
    }
  }
  throw lastErr;
}
