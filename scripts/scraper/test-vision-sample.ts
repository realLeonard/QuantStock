import 'dotenv/config';
import { fetchList } from './fetcher.js';
import { parseTableImage } from './vision.js';

// 取前 3 个有图片的主题，试解析，验证 Vision 现在是否正常
async function main() {
  const data = await fetchList(1, 10);
  let tested = 0;
  for (const item of data.result) {
    if (tested >= 3) break;
    let urls: string[] = [];
    try { urls = JSON.parse(item.imgs || '[]'); } catch { continue; }
    if (urls.length === 0) continue;

    console.log(`\n[${item.title}] 图片数: ${urls.length}`);
    try {
      const rows = await parseTableImage(urls[0]);
      const total = rows.reduce((s, r) => s + r.stocks.length, 0);
      console.log(`  ✅ Vision 解析成功：${rows.length} 行分类，${total} 支股票`);
      if (total > 0) {
        const sample = rows[0].stocks.slice(0, 2);
        console.log(`  示例: ${sample.map(s => s.name).join('、')}`);
      }
    } catch (e) {
      console.log(`  ❌ Vision 失败: ${(e as Error).message}`);
    }
    tested++;
  }
}
main().catch(console.error);
