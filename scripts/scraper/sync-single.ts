/**
 * 单概念主题同步：根据 ID 从韭研 API 拉取 → Qwen Vision 解析图片 → 写入/更新 DB
 *
 * 用法：npx tsx sync-single.ts --id <theme_id>
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { fetchExistingThemes, importTheme, updateThemeStocks } from './importer.js';

// ─── 参数解析 ────────────────────────────────────────────────────────────────

function parseArgs(): string {
  const idx = process.argv.indexOf('--id');
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error('用法: npx tsx sync-single.ts --id <theme_id>');
    process.exit(1);
  }
  return process.argv[idx + 1];
}

// ─── 工具函数（复用 index.ts 逻辑）─────────────────────────────────────────

function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

function sanitizeCat(value: string, themeTitle: string): string {
  if (!value) return '';
  if (value.trim() === themeTitle.trim()) return '';
  if (value.length > 20) return '';
  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── 从 API 查找主题（分页遍历）────────────────────────────────────────────

async function findThemeById(id: string): Promise<ThemeItem | null> {
  const MAX_PAGES = 5;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchList(page, 50);
    const found = data.result.find(i => i.industry_id === id);
    if (found) return found;
    if (!data.hasNext) break;
    await sleep(500);
  }
  return null;
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const themeId = parseArgs();
  console.log(`[单主题同步] ID: ${themeId}`);
  console.log('---');

  console.log('环境检查:');
  console.log(`  SUPABASE_URL      : ${process.env.SUPABASE_URL ? '✅' : '❌ 未设置'}`);
  console.log(`  SUPABASE_ANON_KEY : ${process.env.SUPABASE_ANON_KEY ? '✅' : '❌ 未设置'}`);
  console.log(`  DASHSCOPE_API_KEY : ${process.env.DASHSCOPE_API_KEY ? '✅' : '❌ 未设置'}`);
  console.log(`  JY_TOKEN          : ${process.env.JY_TOKEN ? '✅' : '❌ 未设置'}`);
  console.log('---');

  // 1. 从 API 查找主题
  console.log('[1/3] 从韭研 API 查找主题...');
  const item = await findThemeById(themeId);
  if (!item) {
    console.error(`  ✗ 未找到 ID=${themeId} 的主题（已搜索前 250 条）`);
    process.exit(1);
  }
  console.log(`  ✓ 找到: ${item.title}`);

  // 2. 检查 DB 是否已有
  const existingThemes = await fetchExistingThemes();
  const isUpdate = existingThemes.has(themeId);
  console.log(`  模式: ${isUpdate ? '更新' : '新增'}`);

  // 3. 解析图片
  console.log('[2/3] Vision 解析图片...');
  let imgUrls: string[] = [];
  try {
    imgUrls = JSON.parse(item.imgs || '[]') as string[];
  } catch {
    imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : [];
  }

  if (imgUrls.length === 0) {
    console.log('  主题无图片，股票列表为空');
  } else {
    console.log(`  共 ${imgUrls.length} 张图片`);
  }

  const rows: StockRow[] = [];
  for (let i = 0; i < imgUrls.length; i++) {
    console.log(`  解析图片 ${i + 1}/${imgUrls.length}...`);
    try {
      const partial = await parseTableImage(imgUrls[i]);
      rows.push(...partial);
      console.log(`    提取到 ${partial.length} 个分类行`);
    } catch (e) {
      console.warn(`    图片 ${i + 1} 失败: ${(e as Error).message}`);
    }
    if (i < imgUrls.length - 1) await sleep(600);
  }

  // 保存 Vision 原始解析结果（供调试用）
  const cacheFile = `vision-cache-${themeId.slice(0, 8)}.json`;
  writeFileSync(cacheFile, JSON.stringify({ rows }, null, 2));
  console.log(`  缓存已保存: ${cacheFile}`);

  const cleanTitle = item.title.replace(/[（(].*/u, '').trim();
  const stocks = rows.flatMap(r =>
    r.stocks.map(s => ({
      name: s.name,
      cat1: sanitizeCat(r.cat1, cleanTitle),
      cat2: sanitizeCat(r.cat2, cleanTitle),
      cat3: sanitizeCat(r.cat3, cleanTitle),
      highlight: s.highlight,
      relation: s.relation === s.name ? '' : s.relation,
    }))
  );

  if (imgUrls.length > 0 && stocks.length === 0) {
    console.error('  ⚠️ 有图片但 Vision 解析结果为空，跳过写入');
    process.exit(1);
  }

  // 4. 写入 DB
  console.log('[3/3] 写入数据库...');
  const theme = {
    id: themeId,
    name: cleanTitle,
    overview: item.content || '',
    createdAt: item.create_time ? parseBeijingTime(item.create_time) : Date.now(),
    updatedAt: item.update_time
      ? parseBeijingTime(item.update_time)
      : (item.create_time ? parseBeijingTime(item.create_time) : Date.now()),
    stocks,
  };

  if (isUpdate) {
    await updateThemeStocks(theme);
    console.log(`  ✅ 更新成功: ${cleanTitle}，共 ${stocks.length} 支股票`);
  } else {
    await importTheme(theme);
    console.log(`  ✅ 新增成功: ${cleanTitle}，共 ${stocks.length} 支股票`);
  }
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
