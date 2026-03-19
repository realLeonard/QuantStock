import 'dotenv/config';
import { fetchList } from './fetcher.js';

async function main() {
  const data = await fetchList(1, 3);
  for (const item of data.result.slice(0, 3)) {
    console.log('---');
    console.log('id     :', item.industry_id);
    console.log('title  :', item.title);
    console.log('author :', item.author);
    console.log('imgs   :', JSON.stringify(item.imgs));
    console.log('content:', item.content?.slice(0, 80) ?? '(null)');
    // 打印原始字段列表，看看 API 返回了哪些 key
    console.log('all keys:', Object.keys(item as any).join(', '));
  }
}
main().catch(console.error);
