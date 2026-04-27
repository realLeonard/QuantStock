/**
 * 本地测试 normalizeRows，从缓存文件读取 Vision 原始输出
 * 用法：npx tsx test-normalize.ts vision-cache-4c9e6694.json
 */
import fs from 'fs';

// 从 vision.ts 复制核心逻辑，方便本地迭代
const CATEGORY_SUFFIXES = /[链端侧层]$/;

const SOURCE_LABELS = new Set([
  '网传', '公告', '互动', '工商', '官网', '媒体', '研报',
  '公开信息', '机构纪要', '公众号', '调研纪要', '券商研报',
  '参股', '控股', '自有产品', '股权相关', '参股或关联',
]);

function stripTrailingEtc(name: string): string {
  return name.replace(/等$/, '');
}

function isLikelyStockName(text: string): boolean {
  if (!text) return false;
  const t = stripTrailingEtc(text.trim());
  if (!t) return false;
  if (CATEGORY_SUFFIXES.test(t)) return false;
  if (SOURCE_LABELS.has(t)) return false;
  return /^(\*?ST)?[一-龥]{2,7}[AB]?$/.test(t);
}

function stripParenthetical(name: string): string {
  return name.replace(/[（(][^）)]*[）)]?$/, '').trim();
}

function splitStockNames(text: string): string[] {
  const parts = text.split(/[\s,，、]+/)
    .map(s => stripTrailingEtc(stripParenthetical(s.trim())))
    .filter(Boolean);
  if (parts.length > 1 && parts.every(p => isLikelyStockName(p))) return parts;
  return [];
}

interface Stock { name: string; highlight: string; relation: string }
interface Row { cat1: string; cat2: string; cat3: string; stocks: Stock[] }

function sanitizeRelation(rel: string): string {
  if (!rel) return '';
  const clean = rel.replace(/[\s\-—─―~、，。；：！？()（）""\"'+*/\\]/g, '');
  return clean.length < 2 ? '' : rel;
}

function normalizeRows(rows: Row[]): Row[] {
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

    const normalized: Stock[] = [];
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
          relation: sanitizeRelation(s.relation === s.name ? '' : s.relation),
        });
      }
    }
    return { ...row, stocks: normalized };
  });
}

// 主逻辑
const file = process.argv[2];
if (!file) { console.error('用法: npx tsx test-normalize.ts <cache-file>'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { rows: Row[] };
const before = raw.rows;
const after = normalizeRows(before);

const totalBefore = before.reduce((n, r) => n + r.stocks.length, 0);
const totalAfter = after.reduce((n, r) => n + r.stocks.length, 0);
console.log(`原始: ${totalBefore} 支 → 处理后: ${totalAfter} 支\n`);

for (const row of after) {
  for (const s of row.stocks) {
    const rel = s.relation ? s.relation.slice(0, 40) + (s.relation.length > 40 ? '…' : '') : '';
    console.log(`[${row.cat1} | ${row.cat2}] ${s.name}${rel ? ' → ' + rel : ''}`);
  }
}
