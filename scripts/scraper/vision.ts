import sharp from 'sharp';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = 'qwen3.7-plus';
// 红字 OCR 任务简单（读几个裁剪出的股票名），用便宜的 flash 即可
const QWEN_OCR_MODEL = 'qwen3.7-flash';

export interface StockRow {
  cat1: string;
  cat2: string;
  cat3: string;
  stocks: Array<{ name: string; highlight: '' | 'red' | 'orange'; relation: string }>;
}

// ─── 重试工具 ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 判断是否为可重试的网络/图片下载错误
// 不重试 HTTP 4xx（图片不存在/权限问题），只重试网络层故障和服务端错误
function isRetryableDownloadError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (msg.includes('http 4')) return false; // 4xx 不重试
  return (
    err.name === 'TimeoutError' ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('fetch failed') || // Node.js 通用网络层错误
    msg.includes('http 5') // 5xx 服务端错误
  );
}

// 判断是否为可重试的 Claude API 错误
// 不重试鉴权错误、请求格式错误，只重试超时/限流/过载/服务端错误
function isRetryableApiError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (
    msg.includes('authentication') ||
    msg.includes('invalid_request') ||
    msg.includes('permission')
  ) return false;
  return (
    err.name === 'TimeoutError' ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('overloaded') ||
    msg.includes('rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('529') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('network') ||
    msg.includes('socket')
  );
}

async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (e: Error) => boolean,
  maxAttempts: number,
  baseDelayMs: number,
  label: string,
): Promise<T> {
  let lastErr!: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e as Error;
      if (attempt < maxAttempts && isRetryable(lastErr)) {
        const delay = baseDelayMs * (2 ** (attempt - 1));
        console.warn(`    ${label} 第${attempt}次失败，${(delay / 1000).toFixed(0)}s 后重试: ${lastErr.message}`);
        await sleep(delay);
      } else {
        throw lastErr;
      }
    }
  }
  throw lastErr;
}

// ─── JSON 修复工具 ───────────────────────────────────────────────────────────

// 找到 JSON 根括号实际闭合的位置，截断其后多余字符（处理模型在 JSON 后追加引号等异常输出）
function trimToJsonEnd(str: string): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return str.slice(0, i + 1);
    }
  }
  return str;
}

// 修复 JSON 字符串值中的未转义双引号
function fixUnescapedQuotes(str: string): string {
  let result = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escape) { result += ch; escape = false; continue; }
    if (ch === '\\') { result += ch; escape = true; continue; }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        result += ch;
      } else {
        let j = i + 1;
        while (j < str.length && ' \t\n\r'.includes(str[j])) j++;
        const next = str[j];
        if (next === ':' || next === ',' || next === '}' || next === ']' || j >= str.length) {
          inString = false;
          result += ch;
        } else {
          result += '\\"';
        }
      }
      continue;
    }
    result += ch;
  }
  return result;
}

// 修复被 max_tokens 截断的 JSON：补齐缺失的关闭符
function repairTruncatedJson(str: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); }
    else if (ch === '}' || ch === ']') { stack.pop(); }
  }
  if (inString) str += '"';
  return str + stack.reverse().join('');
}

// 兜底：当 JSON.parse 失败时，用正则直接从文本中提取行数据
function extractRowsByRegex(text: string): StockRow[] {
  const rows: StockRow[] = [];
  const rowHead = /"cat1"\s*:\s*"([^"]*)"\s*,\s*"cat2"\s*:\s*"([^"]*)"\s*,\s*"cat3"\s*:\s*"([^"]*)"\s*,\s*"stocks"\s*:\s*\[/g;
  const positions: Array<{ cat1: string; cat2: string; cat3: string; from: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowHead.exec(text)) !== null) {
    positions.push({ cat1: m[1], cat2: m[2], cat3: m[3], from: m.index + m[0].length });
  }
  if (positions.length === 0) return [];
  const stockRe = /"name"\s*:\s*"([^"]+)"\s*,\s*"highlight"\s*:\s*"(red|orange|)"\s*,\s*"relation"\s*:\s*"([^"]*)"/g;
  for (let i = 0; i < positions.length; i++) {
    const { cat1, cat2, cat3, from } = positions[i];
    const to = i + 1 < positions.length ? positions[i + 1].from : text.length;
    const slice = text.slice(from, to);
    const stocks: StockRow['stocks'] = [];
    stockRe.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = stockRe.exec(slice)) !== null) {
      stocks.push({ name: s[1], highlight: s[2] as '' | 'red' | 'orange', relation: s[3] });
    }
    if (stocks.length > 0) rows.push({ cat1, cat2, cat3, stocks });
  }
  return rows;
}

// ─── 图片下载（带重试）───────────────────────────────────────────────────────

async function downloadImage(imgUrl: string): Promise<{ buffer: Buffer; mediaType: 'image/jpeg' | 'image/png'; rawBuffer: Buffer }> {
  const imgBuffer = await withRetry(
    async () => {
      const response = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) }).catch(e => {
        if ((e as Error).name === 'TimeoutError') throw new Error(`图片下载超时（20s）: ${imgUrl}`);
        throw e;
      });
      if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}: ${imgUrl}`);
      return Buffer.from(await response.arrayBuffer());
    },
    isRetryableDownloadError,
    3,       // 最多3次
    3_000,   // 基础延迟 3s，指数增长：3s → 6s → 12s
    '图片下载',
  );

  // Claude API base64 限制 5MB，base64 膨胀 4/3，因此原始图片需 ≤ 3.7MB
  const MAX_BYTES = 3.5 * 1024 * 1024;
  if (imgBuffer.byteLength > MAX_BYTES) {
    console.warn(`  图片 ${(imgBuffer.byteLength / 1024 / 1024).toFixed(1)}MB，压缩中...`);
    const compressed = await sharp(imgBuffer)
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    console.warn(`  压缩后 ${(compressed.byteLength / 1024 / 1024).toFixed(1)}MB`);
    // rawBuffer 保留原图：红字像素扫描要用无损色彩
    return { buffer: compressed, mediaType: 'image/jpeg', rawBuffer: imgBuffer };
  }

  const bytes = new Uint8Array(imgBuffer.slice(0, 4));
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  return { buffer: imgBuffer, mediaType: isJpeg ? 'image/jpeg' : 'image/png', rawBuffer: imgBuffer };
}

// ─── 红字股票识别（本地像素扫描 + 轻量 OCR）──────────────────────────────────
// 大模型对"哪些股票名是红色"判别很不稳定（黑色加粗常被误判），改为：
// 1) 本地扫描像素定位红色文字行（硬阈值，确定性结果）
// 2) 裁剪红字区域拼成一张小图，用 flash 模型只做"读出名字"这一简单 OCR
// 3) 按名字回填 highlight='red'；任何一步失败只警告，不影响主流程

interface RedBand { top: number; height: number; left: number; width: number }

// 只认纯正大红（红色股票名实测为 rgb(255,0,0)）。
// 阈值放宽到 g/b<90 会漏进暗红相关性文字(176,80,0)和深棕红加粗名(128,48,0)，
// 后者正是大模型频繁把黑名误判为红的原因，实测数据见 2026-09-20 调参记录
function isRedPixel(r: number, g: number, b: number): boolean {
  return r > 200 && g < 60 && b < 60;
}

async function detectRedTextBands(imgBuffer: Buffer): Promise<RedBand[]> {
  const { data, info } = await sharp(imgBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const rowCount = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (isRedPixel(data[i], data[i + 1], data[i + 2])) rowCount[y]++;
    }
  }

  // 连续红像素行聚类成 y 区间
  const yBands: Array<{ top: number; height: number }> = [];
  let start = -1;
  for (let y = 0; y <= height; y++) {
    const active = y < height && rowCount[y] >= 4;
    if (active && start === -1) start = y;
    if (!active && start !== -1) {
      const bandH = y - start;
      if (bandH >= 8 && bandH <= 60) yBands.push({ top: start, height: bandH });
      start = -1;
    }
  }

  // 每个 y 区间内再按 x 方向聚类：股票名列和相关性列的红字同处一行，
  // 不拆开会并成超宽区间被误滤（首版实测 17 个红名只剩 2 个的教训）
  const bands: RedBand[] = [];
  const X_GAP = 14; // 列间空隙阈值（同一个词内字间距远小于此）
  for (const { top, height: bandH } of yBands) {
    const colCount = new Array<number>(width).fill(0);
    for (let yy = top; yy < top + bandH; yy++) {
      for (let x = 0; x < width; x++) {
        const i = (yy * width + x) * channels;
        if (isRedPixel(data[i], data[i + 1], data[i + 2])) colCount[x]++;
      }
    }
    let cStart = -1;
    let lastX = -1;
    const flush = (endX: number) => {
      if (cStart === -1) return;
      const w = endX - cStart + 1;
      // 股票名是短文本；过宽的是红色相关性长句，过窄的是杂点
      if (w >= 25 && w <= Math.max(220, width * 0.2)) {
        bands.push({ top, height: bandH, left: cStart, width: w });
      }
      cStart = -1;
    };
    for (let x = 0; x < width; x++) {
      if (colCount[x] > 0) {
        if (cStart === -1) cStart = x;
        else if (x - lastX > X_GAP) { flush(lastX); cStart = x; }
        lastX = x;
      }
    }
    flush(lastX);
  }
  return bands;
}

async function ocrRedNames(imgBuffer: Buffer, bands: RedBand[], apiKey: string): Promise<string[]> {
  const PAD = 6;
  const GAP = 12;
  const meta = await sharp(imgBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;
  const CANVAS_W = 320;

  const crops: { input: Buffer; left: number; top: number }[] = [];
  let offsetY = 0;
  for (const b of bands) {
    const left = Math.max(0, b.left - PAD);
    const top = Math.max(0, b.top - PAD);
    const w = Math.min(b.width + PAD * 2, imgW - left, CANVAS_W);
    const h = Math.min(b.height + PAD * 2, imgH - top);
    const crop = await sharp(imgBuffer).extract({ left, top, width: w, height: h }).png().toBuffer();
    crops.push({ input: crop, left: 0, top: offsetY });
    offsetY += h + GAP;
  }

  const composite = await sharp({
    create: { width: CANVAS_W, height: offsetY - GAP, channels: 3, background: 'white' },
  })
    .composite(crops)
    .png()
    .toBuffer();

  const resp = await withRetry(
    async () => {
      const r = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: QWEN_OCR_MODEL,
          max_tokens: 1024,
          enable_thinking: false,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: '图片中从上到下有若干段红色中文文字（多为股票名）。请从上到下逐段原样输出，每段一行，只输出文字本身，不要编号、不要任何其他说明。',
              },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${composite.toString('base64')}` } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`红字 OCR HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      return r.json() as Promise<{ choices?: { message?: { content?: string } }[] }>;
    },
    isRetryableApiError,
    2,
    3_000,
    '红字 OCR',
  );

  const text = resp.choices?.[0]?.message?.content ?? '';
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

function applyRedHighlights(rows: StockRow[], redNames: string[]): number {
  // 同一行相邻的两个红名可能被裁进同一块、OCR 连成一行输出，先按分隔符拆开
  const nameSet = new Set(redNames.flatMap(n => n.split(/[\s,，、/|]+/)).filter(Boolean));
  const matched = new Set<string>();
  let count = 0;
  for (const row of rows) {
    for (const s of row.stocks) {
      if (nameSet.has(s.name)) {
        s.highlight = 'red';
        matched.add(s.name);
        count++;
      }
    }
  }
  for (const n of nameSet) {
    // 长句是被裁进来的红色相关性文字，静默跳过；短名匹配不上才值得警告（多为结构解析认错字）
    if (!matched.has(n) && n.length <= 8) {
      console.warn(`    红字「${n}」未匹配到解析出的股票名（可能结构解析认错了字）`);
    }
  }
  return count;
}

async function annotateRedStocks(imgBuffer: Buffer, rows: StockRow[], apiKey: string): Promise<void> {
  const bands = await detectRedTextBands(imgBuffer);
  if (bands.length === 0) return;
  const redNames = await ocrRedNames(imgBuffer, bands, apiKey);
  const count = applyRedHighlights(rows, redNames);
  console.log(`    红字识别: 像素定位 ${bands.length} 处 → OCR 读出 ${redNames.length} 个 → 匹配标红 ${count} 只`);
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────

export const VISION_PROMPT = `这是一张中国股市产业链表格图片。表格通常有"分类"（大类/子类/细分，最多三级）、"个股"（股票名）、"相关性"（描述文字）列。

【第一步：分析分类结构】
如果表格有分类列，请先从上到下找出所有可见的分类标签，确定每个分类标签在表格中覆盖哪些行（合并单元格的起止行）。分类标签通常位于合并单元格区域的顶部，其下方所有行直到下一个分类标签出现前，都属于同一分类。

【第二步：提取数据】
按照第一步确定的分类边界，为每行股票填写正确的 cat1/cat2/cat3，然后仅返回如下格式 JSON，不要任何说明文字、不要用 markdown 代码块包裹：
{"rows":[{"cat1":"大类名","cat2":"子类名","cat3":"细分名","stocks":[{"name":"股票名","highlight":"","relation":"相关性文字"}]}]}

提取规则：
- 保持图片中的原始顺序，不要重新排序
- highlight 统一填 ""，不做颜色识别（红字由本地像素扫描单独处理）
- 【股票名逐字准确】name 字段必须与图片中的文字逐字一致，不要脑补成你熟悉的相似股票名；遇到生僻字或看不清的字，宁可按字形原样输出，也不要替换成别的公司名
- 合并单元格（rowspan）中分类文字出现在顶部，请严格按照视觉边界确定每个合并单元格覆盖的行范围，不要提前或延后切换分类
- 忽略水印文字、风险提示行、表头行
- 【重要：忽略"信源"列】如果表格中有"信源"列，直接跳过该列，不要将其内容填入任何字段。在判断表格列结构时也不要把"信源"列计入
- 如果没有子类列，cat2 填 ""；如果没有细分列，cat3 填 ""
- 如果表格根本没有分类列（只有股票名），cat1/cat2/cat3 全部填 ""，不要用主题名或其他文字代替
- "相关性"列是该股票与主题的关联描述（通常在股票名旁边或下方），如无内容填 ""
- 【重要：无"个股"列的情况】如果表格没有"个股"列，只有"分类"和"相关性"（或类似的两列结构），则"相关性"列的内容就是股票名，应填入 name 字段，relation 填 ""
- 【重要：多列股票名的情况】如果分类列之后有多列，且各列内容都是短文本股票名称（2-5个字，不是描述性语句），则每个股票名都是独立的 stock 条目，全部填入 name 字段，relation 填 ""。不要把一列股票名填入 name、另一列填入 relation
- 【重要：只有"分类"列的情况】如果表格只有"分类"表头，没有"个股"和"相关性"表头，则除"分类"列外的其余列内容全部归入 relation 字段（多列内容用空格拼接），name 从 relation 中无法区分时填 ""
- 【重要：无表头或表头不可识别】如果表格完全没有表头行，或表头无法识别为"分类""个股""相关性"等关键词，则按列的位置顺序默认映射：第1列→分类（cat1），第2列→个股（name），第3列→相关性（relation）；只有两列时：第1列→分类，第2列→个股，relation 填 ""；只有一列时：该列→个股，cat1/cat2/cat3 和 relation 全部填 ""
- relation 字段保留完整内容，不要截断
- 每行对应一个 stocks 数组，包含该行所有股票及其相关性`;

// 类别后缀，不是股票名
const CATEGORY_SUFFIXES = /[链端侧层]$/;

// 信源/来源标签，不是股票名
const SOURCE_LABELS = new Set([
  '网传', '公告', '互动', '工商', '官网', '媒体', '研报',
  '公开信息', '机构纪要', '公众号', '调研纪要', '券商研报',
  '参股', '控股', '自有产品', '股权相关', '参股或关联',
]);

// 去掉股票名尾部的"等"字
function stripTrailingEtc(name: string): string {
  return name.replace(/等$/, '');
}

// 判断文本是否像股票名称（2-7个汉字，可带 *ST/ST 前缀和 A/B 后缀）
function isLikelyStockName(text: string): boolean {
  if (!text) return false;
  const t = stripTrailingEtc(text.trim());
  if (!t) return false;
  if (CATEGORY_SUFFIXES.test(t)) return false;
  if (SOURCE_LABELS.has(t)) return false;
  return /^(\*?ST)?[一-龥]{2,7}[AB]?$/.test(t);
}

// 去掉股票名后面的括号注释，如 "七匹狼（控股股东持股）" → "七匹狼"
function stripParenthetical(name: string): string {
  return name.replace(/[（(][^）)]*[）)]?$/, '').trim();
}

// 尝试将空格/逗号分隔的文本拆成多个股票名
function splitStockNames(text: string): string[] {
  const parts = text.split(/[\s,，、]+/)
    .map(s => stripTrailingEtc(stripParenthetical(s.trim())))
    .filter(Boolean);
  if (parts.length > 1 && parts.every(p => isLikelyStockName(p))) return parts;
  return [];
}

// relation 去掉标点符号后不足 2 个字视为无效值
function sanitizeRelation(rel: string): string {
  if (!rel) return '';
  const clean = rel.replace(/[\s\-—─―~、，。；：！？()（）""\"'+*/\\]/g, '');
  return clean.length < 2 ? '' : rel;
}

// 后处理：修正字段映射
function normalizeRows(rows: StockRow[]): StockRow[] {
  return rows.map(row => {
    // 规则三：cat2 像股票名，且 name 都不像股票名 → cat2 才是真正的股票名
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
      // relation 里有多个股票名 → name 是分类标签，拆 relation 为独立股票
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

export async function parseTableImage(imgUrl: string): Promise<StockRow[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  const { buffer, mediaType, rawBuffer } = await downloadImage(imgUrl);
  const base64 = buffer.toString('base64');

  const resp = await withRetry(
    async () => {
      const r = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: QWEN_MODEL,
          max_tokens: 8192,
          enable_thinking: false,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
            ],
          }],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`Qwen API HTTP ${r.status}: ${body.slice(0, 300)}`);
      }
      return r.json() as Promise<{ choices?: { message?: { content?: string } }[] }>;
    },
    isRetryableApiError,
    3,
    5_000,
    'Qwen API',
  );

  const rawText = resp.choices?.[0]?.message?.content ?? '';
  const text = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  const startIdx = text.indexOf('{');
  if (startIdx === -1) {
    console.warn('  Vision 未返回有效 JSON，原始响应:', text.slice(0, 200));
    return [];
  }
  let jsonStr = fixUnescapedQuotes(text.slice(startIdx));
  jsonStr = trimToJsonEnd(jsonStr);
  jsonStr = repairTruncatedJson(jsonStr);
  let rows: StockRow[];
  try {
    const parsed = JSON.parse(jsonStr) as { rows?: StockRow[] };
    rows = normalizeRows(parsed.rows ?? []);
  } catch {
    console.warn('  Vision JSON 解析失败，尝试正则兜底...');
    const fallback = extractRowsByRegex(text);
    if (fallback.length === 0) {
      console.warn('  正则兜底也失败，原始响应:', text.slice(0, 200));
      return [];
    }
    console.warn(`  正则兜底成功，提取 ${fallback.length} 行`);
    rows = normalizeRows(fallback);
  }

  try {
    await annotateRedStocks(rawBuffer, rows, apiKey);
  } catch (e) {
    console.warn('  红字识别失败（不影响主流程）:', (e as Error).message);
  }
  return rows;
}
