const BASE = 'https://app.jiuyangongshe.com/jystock-app/api/v1';

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'token': process.env.JY_TOKEN ?? '',
    'timestamp': String(Date.now()),
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
}

interface ListData {
  result: ThemeItem[];
  totalCount: number;
  hasNext: boolean;
  nextPage: number;
}

// 返回单页主题列表（start 从 1 开始，limit 每页数量）
export async function fetchList(start: number, limit = 50): Promise<ListData> {
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
  if (json.errCode !== '0') throw new Error(`fetchList 接口错误: ${json.msg}`);
  return json.data;
}
