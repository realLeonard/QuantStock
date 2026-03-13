import 'dotenv/config';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { fetchExistingThemes, importTheme, updateThemeStocks } from './importer.js';

const isTest = process.argv.includes('--test');

async function main() {
  console.log(`[韭研公社爬虫] ${isTest ? '测试模式（只处理 1 条新主题）' : '全量同步模式'}`);
  console.log('---');

  const [existingThemes, allItems] = await Promise.all([
    fetchExistingThemes(),
    fetchAllItems(),
  ]);

  // 新增：id 不在 DB
  const filteredNew = allItems.filter(i => !existingThemes.has(i.industry_id));
  const newItems = isTest ? filteredNew.slice(0, 1) : filteredNew;

  // 更新：id 存在但线上 update_time > DB updated_at
  const filteredUpdated = allItems.filter(i => {
    if (!existingThemes.has(i.industry_id)) return false;
    if (!i.update_time) return false;
    const onlineUpdatedAt = new Date(i.update_time).getTime();
    const dbUpdatedAt = existingThemes.get(i.industry_id)!;
    return onlineUpdatedAt > dbUpdatedAt;
  });
  const updatedItems = isTest ? [] : filteredUpdated;

  console.log(
    `线上 ${allItems.length} 个主题，DB 已有 ${existingThemes.size} 个，` +
    `新增 ${newItems.length} 个，内容更新 ${updatedItems.length} 个`
  );

  if (newItems.length === 0 && updatedItems.length === 0) {
    console.log('无新主题，退出。');
    return;
  }

  // 第一轮：处理所有待处理主题，失败的记录下来
  const failed: Array<{ item: ThemeItem; mode: 'insert' | 'update'; reason: string }> = [];
  let imported = 0;

  for (const item of newItems) {
    const ok = await processItem(item, 'insert');
    if (ok) imported++;
    else failed.push({ item, mode: 'insert', reason: '第一次处理失败' });
    await sleep(1200);
  }

  for (const item of updatedItems) {
    const ok = await processItem(item, 'update');
    if (ok) imported++;
    else failed.push({ item, mode: 'update', reason: '第一次处理失败' });
    await sleep(1200);
  }

  // 第二轮：重试失败项（间隔加倍，避免连续出错）
  if (failed.length > 0) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`重试 ${failed.length} 个失败主题...`);
    await sleep(3000);

    const stillFailed: typeof failed = [];
    for (const { item, mode } of failed) {
      const ok = await processItem(item, mode);
      if (ok) {
        imported++;
      } else {
        stillFailed.push({ item, mode, reason: '重试仍失败' });
      }
      await sleep(2400);
    }

    if (stillFailed.length > 0) {
      console.log(`\n以下主题重试后仍失败（共 ${stillFailed.length} 个）：`);
      for (const { item } of stillFailed) {
        console.log(`  - [${item.industry_id}] ${item.title}`);
      }
    }
  }

  console.log(`\n${'='.repeat(40)}`);
  const finalFailed = failed.filter(f => f.reason === '重试仍失败').length;
  console.log(`完成！成功 ${imported} 个，最终失败 ${finalFailed} 个`);
}

async function processItem(item: ThemeItem, mode: 'insert' | 'update'): Promise<boolean> {
  const modeLabel = mode === 'update' ? '[更新]' : '[新增]';
  console.log(`\n${modeLabel} [${item.title}]`);
  try {
    let imgUrls: string[] = [];
    try {
      imgUrls = JSON.parse(item.imgs || '[]') as string[];
    } catch {
      // imgs 字段不是 JSON 数组时，尝试逗号分割
      imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (imgUrls.length > 0) console.warn(`  imgs 非 JSON，逗号分割得到 ${imgUrls.length} 个 URL`);
    }

    const rows: StockRow[] = [];
    for (let imgIdx = 0; imgIdx < imgUrls.length; imgIdx++) {
      console.log(`  解析图片 ${imgIdx + 1}/${imgUrls.length}...`);
      try {
        const partial = await parseTableImage(imgUrls[imgIdx]);
        rows.push(...partial);
        console.log(`    提取到 ${partial.length} 个分类行`);
      } catch (e) {
        console.warn(`    图片 ${imgIdx + 1} 解析失败: ${(e as Error).message}`);
      }
      if (imgIdx < imgUrls.length - 1) await sleep(600);
    }

    const cleanTitle = item.title.replace(/[（(].*/u, '').trim();
    const stocks = rows.flatMap(r =>
      r.stocks.map(s => ({
        name: s.name,
        // 防止 Vision 把主题名或无关文字误填入分类字段：
        // 若某个分类值与主题标题相同，或超过 20 字（分类名不会这么长），则置空
        cat1: sanitizeCat(r.cat1, cleanTitle),
        cat2: sanitizeCat(r.cat2, cleanTitle),
        cat3: sanitizeCat(r.cat3, cleanTitle),
        highlight: s.highlight,
        relation: s.relation,
      }))
    );

    const processedTheme = {
      id: item.industry_id,
      name: cleanTitle,
      overview: item.content || '',
      createdAt: item.create_time ? new Date(item.create_time).getTime() : Date.now(),
      updatedAt: item.update_time
        ? new Date(item.update_time).getTime()
        : (item.create_time ? new Date(item.create_time).getTime() : Date.now()),
      stocks,
    };

    if (mode === 'update') {
      await updateThemeStocks(processedTheme);
      console.log(`  ✅ 更新成功，共 ${stocks.length} 支股票`);
    } else {
      await importTheme(processedTheme);
      console.log(`  ✅ 导入成功，共 ${stocks.length} 支股票`);
    }
    return true;
  } catch (e) {
    console.error(`  ❌ 失败: ${(e as Error).message}`);
    return false;
  }
}

async function fetchAllItems(): Promise<ThemeItem[]> {
  const all: ThemeItem[] = [];
  let start = 1;
  const limit = 50;
  while (true) {
    const data = await fetchList(start, limit);
    all.push(...data.result);
    console.log(`  拉取列表 start=${start}，已获取 ${all.length}/${data.totalCount}`);
    if (!data.hasNext || data.result.length === 0) break;
    start = data.nextPage;
    await sleep(500);
  }
  return all;
}

// 分类名校验：防止 Vision 把主题标题或长文本误填入 cat 字段
function sanitizeCat(value: string, themeTitle: string): string {
  if (!value) return '';
  // 与主题标题相同则置空
  if (value.trim() === themeTitle.trim()) return '';
  // 超过 20 字认为是误识别（分类名通常很短）
  if (value.length > 20) return '';
  return value.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
