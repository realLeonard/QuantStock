/**
 * 调试脚本：下载主题图片 + 打印 Vision 原始返回
 * 用法：npx tsx debug-vision.ts --id <theme_id>
 */
import 'dotenv/config';
import { fetchList, type ThemeItem } from './fetcher.js';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = 'qwen3.6-plus';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findThemeById(id: string): Promise<ThemeItem | null> {
  for (let page = 1; page <= 5; page++) {
    const data = await fetchList(page, 50);
    const found = data.result.find(i => i.industry_id === id);
    if (found) return found;
    if (!data.hasNext) break;
    await sleep(500);
  }
  return null;
}

async function main() {
  const idx = process.argv.indexOf('--id');
  const themeId = process.argv[idx + 1];
  if (!themeId) { console.error('需要 --id 参数'); process.exit(1); }

  const item = await findThemeById(themeId);
  if (!item) { console.error('未找到主题'); process.exit(1); }
  console.log(`主题: ${item.title}\n`);

  let imgUrls: string[] = [];
  try { imgUrls = JSON.parse(item.imgs || '[]'); } catch { imgUrls = []; }
  if (imgUrls.length === 0) { console.log('无图片'); return; }

  const imgUrl = imgUrls[0];
  console.log(`图片 URL: ${imgUrl}\n`);

  // 下载图片并保存到本地
  const resp = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) });
  const buf = Buffer.from(await resp.arrayBuffer());
  const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
  const localPath = `debug-${themeId.slice(0, 8)}.${ext}`;
  const fs = await import('fs');
  fs.writeFileSync(localPath, buf);
  console.log(`图片已保存: ${localPath} (${(buf.byteLength / 1024).toFixed(0)}KB)\n`);

  // 调用 Vision，打印原始返回
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const base64 = buf.toString('base64');
  const bytes = new Uint8Array(buf.slice(0, 4));
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  const mediaType = isJpeg ? 'image/jpeg' : 'image/png';

  const { VISION_PROMPT } = await import('./vision.js');

  console.log('调用 Qwen Vision...\n');
  const r = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: QWEN_MODEL,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const json = await r.json() as { choices?: { message?: { content?: string } }[] };
  const raw = json.choices?.[0]?.message?.content ?? '';
  console.log('===== Vision 原始返回 =====');
  console.log(raw);
  console.log('===========================\n');

  // 解析出 highlight 统计
  const highlights = { red: 0, orange: 0, empty: 0 };
  const nameColorPairs: Array<{ name: string; highlight: string }> = [];
  const stockRe = /"name"\s*:\s*"([^"]+)"\s*,\s*"highlight"\s*:\s*"(red|orange|)"/g;
  let m: RegExpExecArray | null;
  while ((m = stockRe.exec(raw)) !== null) {
    const hl = m[2] as 'red' | 'orange' | '';
    if (hl === 'red') highlights.red++;
    else if (hl === 'orange') highlights.orange++;
    else highlights.empty++;
    if (hl) nameColorPairs.push({ name: m[1], highlight: hl });
  }
  console.log('颜色统计:', highlights);
  if (nameColorPairs.length > 0) {
    console.log('有颜色的股票:', nameColorPairs);
  } else {
    console.log('所有股票均为空 highlight');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
