import 'dotenv/config';

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

async function fetchPage(start: number, limit = 50) {
  const res = await fetch(`${BASE}/industry/list`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ keyword: '', start, limit }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as any;
  if (json.errCode !== '0') throw new Error(json.msg);
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
  console.log(`总计：${all.length} 条\n`);

  // author 字段非 null 即为用户贡献类
  const contributed = all.filter((i: any) => i.author !== null && i.author !== undefined);

  // 统计 author 值分布
  const authorDist: Record<string, number> = {};
  for (const i of contributed) {
    authorDist[i.author] = (authorDist[i.author] ?? 0) + 1;
  }
  console.log('author 值分布：');
  for (const [k, v] of Object.entries(authorDist)) {
    console.log(`  "${k}" × ${v}`);
  }

  console.log(`\n共 ${contributed.length} 个"用户贡献"主题：`);
  console.log('─'.repeat(80));
  for (const i of contributed) {
    console.log(`[${i.industry_id}] author="${i.author}"  ${i.title}`);
  }
}

main().catch(console.error);
