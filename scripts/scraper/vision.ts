import sharp from 'sharp';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = 'qwen3-vl-plus';

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

async function downloadImage(imgUrl: string): Promise<{ buffer: Buffer; mediaType: 'image/jpeg' | 'image/png' }> {
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
    return { buffer: compressed, mediaType: 'image/jpeg' };
  }

  const bytes = new Uint8Array(imgBuffer.slice(0, 4));
  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
  return { buffer: imgBuffer, mediaType: isJpeg ? 'image/jpeg' : 'image/png' };
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────

const VISION_PROMPT = `这是一张中国股市产业链表格图片。表格通常有"分类"（大类/子类/细分，最多三级）、"个股"（股票名）、"相关性"（描述文字）列。

【第一步：分析分类结构】
如果表格有分类列，请先从上到下找出所有可见的分类标签，确定每个分类标签在表格中覆盖哪些行（合并单元格的起止行）。分类标签通常位于合并单元格区域的顶部，其下方所有行直到下一个分类标签出现前，都属于同一分类。

【第二步：提取数据】
按照第一步确定的分类边界，为每行股票填写正确的 cat1/cat2/cat3，然后仅返回如下格式 JSON，不要任何说明文字、不要用 markdown 代码块包裹：
{"rows":[{"cat1":"大类名","cat2":"子类名","cat3":"细分名","stocks":[{"name":"股票名","highlight":"","relation":"相关性文字"}]}]}

提取规则：
- 保持图片中的原始顺序，不要重新排序
- 【重要】仔细观察每个股票名称的文字颜色：红色、深红色、朱红色字体的股票 highlight 填 "red"；橙色字体填 "orange"；普通黑色/深色字体填 ""
- 合并单元格（rowspan）中分类文字出现在顶部，请严格按照视觉边界确定每个合并单元格覆盖的行范围，不要提前或延后切换分类
- 忽略水印文字、风险提示行、表头行
- 如果没有子类列，cat2 填 ""；如果没有细分列，cat3 填 ""
- 如果表格根本没有分类列（只有股票名），cat1/cat2/cat3 全部填 ""，不要用主题名或其他文字代替
- "相关性"列是该股票与主题的关联描述（通常在股票名旁边或下方），如无内容填 ""
- relation 字段保留完整内容，不要截断
- 每行对应一个 stocks 数组，包含该行所有股票及其相关性`;

export async function parseTableImage(imgUrl: string): Promise<StockRow[]> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('缺少 DASHSCOPE_API_KEY 环境变量');

  const { buffer, mediaType } = await downloadImage(imgUrl);
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
  try {
    const parsed = JSON.parse(jsonStr) as { rows?: StockRow[] };
    return parsed.rows ?? [];
  } catch {
    console.warn('  Vision JSON 解析失败，尝试正则兜底...');
    const fallback = extractRowsByRegex(text);
    if (fallback.length > 0) {
      console.warn(`  正则兜底成功，提取 ${fallback.length} 行`);
      return fallback;
    }
    console.warn('  正则兜底也失败，原始响应:', text.slice(0, 200));
    return [];
  }
}
