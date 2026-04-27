/**
 * 从 Vision 缓存文件入库：跳过 API 调用，直接用缓存的解析结果写入 DB
 * 用法：npx tsx import-from-cache.ts <cache-file> <theme_id>
 */
import 'dotenv/config';
import fs from 'fs';
import { fetchList, type ThemeItem } from './fetcher.js';
import { type StockRow } from './vision.js';
import { fetchExistingThemes, importTheme, updateThemeStocks } from './importer.js';

// ─── 从 vision.ts 复制 normalizeRows 逻辑 ──────────────────────────────────

const CATEGORY_SUFFIXES = /[链端侧层]$/;

const SOURCE_LABELS = new Set([
  '网传', '公告', '互动', '工商', '官网', '媒体', '研报',
  '公开信息', '机构纪要', '公众号', '调研纪要', '券商研报',
  '参股', '控股', '自有产品', '股权相关', '参股或关联',
]);

function stripTrailingEtc(name: string): string {
  return name.replace(/等$/, '');
}

function stripParenthetical(name: string): string {
  return name.replace(/[（(][^）)]*[）)]?$/, '').trim();
}

function isLikelyStockName(text: string): boolean {
  if (!text) return false;
  const t = stripTrailingEtc(text.trim());
  if (!t) return false;
  if (CATEGORY_SUFFIXES.test(t)) return false;
  if (SOURCE_LABELS.has(t)) return false;
  return /^(\*?ST)?[一-龥]{2,7}[AB]?$/.test(t);
}

function splitStockNames(text: string): string[] {
  const parts = text.split(/[\s,，、]+/)
    .map(s => stripTrailingEtc(stripParenthetical(s.trim())))
    .filter(Boolean);
  if (parts.length > 1 && parts.every(p => isLikelyStockName(p))) return parts;
  return [];
}

function sanitizeRelation(rel: string): string {
  if (!rel) return '';
  const clean = rel.replace(/[\s\-—─―~、，。；：！？()（）""\"'+*/\\]/g, '');
  return clean.length < 2 ? '' : rel;
}

function normalizeRows(rows: StockRow[]): StockRow[] {
  return rows.map(row => {
    if (row.cat2 && isLikelyStockName(row.cat2) && row.stocks.length > 0
      && row.stocks.every(s => !isLikelyStockName(s.name))) {
      return {
        ...row,
        cat2: '',
        stocks: row.stocks.map(s => ({
          name: row.cat2,
          highlight: s.highlight,
          relation: sanitizeRelation([s.name, s.relation].filter(Boolean).join(' ')),
        })),
      };
    }

    const normalized: StockRow['stocks'] = [];
    for (const s of row.stocks) {
      if (s.relation) {
        const relNames = splitStockNames(s.relation);
        if (relNames.length > 1) {
          if (!row.cat2 && s.name) row = { ...row, cat2: s.name };
          for (const n of relNames) {
            normalized.push({ name: n, highlight: '', relation: '' });
          }
          continue;
        }
      }

      const splitNames = splitStockNames(s.name);
      if (splitNames.length > 1) {
        for (const n of splitNames) {
          normalized.push({ name: n, highlight: '', relation: '' });
        }
        continue;
      }

      if (s.relation && isLikelyStockName(s.relation) && s.relation !== s.name) {
        normalized.push({ name: s.name, highlight: s.highlight, relation: '' });
        normalized.push({ name: s.relation, highlight: '', relation: '' });
      } else {
        normalized.push({
          ...s,
          name: stripTrailingEtc(s.name),
          relation: sanitizeRelation(s.relation === s.name ? '' : s.relation),
        });
      }
    }
    return { ...row, stocks: normalized };
  });
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

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

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const cacheFile = process.argv[2];
  const themeId = process.argv[3];
  if (!cacheFile || !themeId) {
    console.error('用法: npx tsx import-from-cache.ts <cache-file> <theme_id>');
    process.exit(1);
  }

  console.log(`[缓存入库] ID: ${themeId}`);
  console.log(`  缓存文件: ${cacheFile}`);

  // 读取缓存
  const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as { rows: StockRow[] };
  const rows = normalizeRows(raw.rows);
  console.log(`  缓存行数: ${raw.rows.length} → normalize 后: ${rows.length}`);

  // 从 API 获取主题元数据
  console.log('  查找主题元数据...');
  const item = await findThemeById(themeId);
  if (!item) {
    console.error(`  ✗ 未找到 ID=${themeId}`);
    process.exit(1);
  }
  console.log(`  ✓ ${item.title}`);

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

  console.log(`  股票总数: ${stocks.length}`);

  const existingThemes = await fetchExistingThemes();
  const isUpdate = existingThemes.has(themeId);

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
