import 'dotenv/config';

const BASE = 'https://app.jiuyangongshe.com/jystock-app/api/v1';
function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'token': process.env.JY_TOKEN ?? '',
    'timestamp': String(Date.now()),
    'platform': '3',
    'referer': 'https://www.jiuyangongshe.com/',
  };
}
async function fetchPage(start: number, limit = 50) {
  const res = await fetch(`${BASE}/industry/list`, { method: 'POST', headers: headers(), body: JSON.stringify({ keyword: '', start, limit }), signal: AbortSignal.timeout(15_000) });
  const json = await res.json() as any;
  return json.data;
}
async function main() {
  const all: any[] = [];
  let start = 1;
  while (true) {
    const data = await fetchPage(start, 50);
    all.push(...data.result);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await new Promise(r => setTimeout(r, 400));
  }

  // 分组：null 单独一组，非 null 按 author 值分组
  const groups: Record<string, any[]> = {};
  for (const item of all) {
    const key = item.author === null ? '(null)' : `"${item.author}"`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  // 按数量降序，每组取前3条
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  for (const [author, items] of sorted) {
    console.log(`\nauthor=${author}  (共 ${items.length} 条)`);
    for (const item of items.slice(0, 3)) {
      console.log(`  [${item.industry_id}]  ${item.title}`);
    }
  }
}
main().catch(console.error);
