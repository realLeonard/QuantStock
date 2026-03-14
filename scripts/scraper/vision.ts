import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

// 自动读取环境变量：ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL（与 Claude Code 共用同一代理配置）
const claude = new Anthropic({ timeout: 60_000 });

export interface StockRow {
  cat1: string;
  cat2: string;
  cat3: string;
  stocks: Array<{ name: string; highlight: '' | 'red' | 'orange'; relation: string }>;
}

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
      if (depth === 0) return str.slice(0, i + 1); // 根括号已闭合，截断后续内容
    }
  }
  return str; // 未闭合（被截断），返回全部内容交给 repairTruncatedJson 处理
}

// 修复 JSON 字符串值中的未转义双引号
// 判断依据：字符串内遇到 " 后，若其后紧跟 : , } ]（忽略空白）则为合法闭合引号，否则为需转义的内容引号
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
        // 向前跳过空白，判断后续字符是否为合法 JSON 分隔符
        let j = i + 1;
        while (j < str.length && ' \t\n\r'.includes(str[j])) j++;
        const next = str[j];
        if (next === ':' || next === ',' || next === '}' || next === ']' || j >= str.length) {
          inString = false;
          result += ch; // 合法闭合引号
        } else {
          result += '\\"'; // 内容里的未转义引号，补转义
        }
      }
      continue;
    }
    result += ch;
  }
  return result;
}

// 修复被 max_tokens 截断的 JSON：逐字符追踪括号/引号栈，补齐缺失的关闭符
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
// 只匹配结构完整的 cat + stocks 块，不依赖 JSON 合法性
function extractRowsByRegex(text: string): StockRow[] {
  const rows: StockRow[] = [];

  // 找到所有行头（cat1/cat2/cat3 + stocks 数组开头位置）
  const rowHead = /"cat1"\s*:\s*"([^"]*)"\s*,\s*"cat2"\s*:\s*"([^"]*)"\s*,\s*"cat3"\s*:\s*"([^"]*)"\s*,\s*"stocks"\s*:\s*\[/g;
  const positions: Array<{ cat1: string; cat2: string; cat3: string; from: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = rowHead.exec(text)) !== null) {
    positions.push({ cat1: m[1], cat2: m[2], cat3: m[3], from: m.index + m[0].length });
  }
  if (positions.length === 0) return [];

  // 逐行提取股票对象
  const stockRe = /"name"\s*:\s*"([^"]+)"\s*,\s*"highlight"\s*:\s*"(red|orange|)"\s*,\s*"relation"\s*:\s*"([^"]*)"/g;
  for (let i = 0; i < positions.length; i++) {
    const { cat1, cat2, cat3, from } = positions[i];
    const to = i + 1 < positions.length ? positions[i + 1].from : text.length;
    const slice = text.slice(from, to);
    const stocks: StockRow['stocks'] = [];
    stockRe.lastIndex = 0;
    let s: RegExpExecArray | null;
    while ((s = stockRe.exec(slice)) !== null) {
      stocks.push({
        name: s[1],
        highlight: s[2] as '' | 'red' | 'orange',
        relation: s[3],
      });
    }
    if (stocks.length > 0) rows.push({ cat1, cat2, cat3, stocks });
  }
  return rows;
}

export async function parseTableImage(imgUrl: string): Promise<StockRow[]> {
  // 下载图片转 base64
  const response = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) }).catch(e => {
    if ((e as Error).name === 'TimeoutError') throw new Error(`图片下载超时（20s）: ${imgUrl}`);
    throw e;
  });
  if (!response.ok) throw new Error(`图片下载失败 HTTP ${response.status}: ${imgUrl}`);
  let imgBuffer = Buffer.from(await response.arrayBuffer());

  // Claude API base64 限制 5MB，base64 膨胀 4/3，因此原始图片需 ≤ 3.7MB
  // 阈值设 3.5MB，超出则压缩为 JPEG（比 PNG 小得多）
  const MAX_BYTES = 3.5 * 1024 * 1024;
  let mediaType: 'image/jpeg' | 'image/png';
  if (imgBuffer.byteLength > MAX_BYTES) {
    console.warn(`  图片 ${(imgBuffer.byteLength / 1024 / 1024).toFixed(1)}MB，压缩中...`);
    imgBuffer = await sharp(imgBuffer)
      .resize({ width: 2000, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    mediaType = 'image/jpeg';
    console.warn(`  压缩后 ${(imgBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`);
  } else {
    // 用魔术字节判断图片类型（比 Content-Type 头更可靠）
    const bytes = new Uint8Array(imgBuffer.slice(0, 4));
    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    mediaType = isJpeg ? 'image/jpeg' : 'image/png';
  }

  const base64 = imgBuffer.toString('base64');

  const message = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: base64 },
        },
        {
          type: 'text',
          text: `这是一张中国股市产业链表格图片。表格通常有"分类"（大类/子类/细分，最多三级）、"个股"（股票名）、"相关性"（描述文字）列。

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
- 每行对应一个 stocks 数组，包含该行所有股票及其相关性`,
        },
      ],
    }],
  });

  const rawText = message.content[0].type === 'text' ? message.content[0].text : '';
  // 剥除模型可能输出的 markdown 代码块包裹（```json ... ``` 或 ``` ... ```）
  const text = rawText.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '');
  // 找到 JSON 起始 {，取其后所有内容交给 repairTruncatedJson 修复
  // 不用贪婪正则截到最后一个 }，避免截掉截断点后面的有效内容
  const startIdx = text.indexOf('{');
  if (startIdx === -1) {
    console.warn('  Vision 未返回有效 JSON，原始响应:', text.slice(0, 200));
    return [];
  }
  // 1. 修复字符串值中的未转义双引号（模型引用术语时常用 "xxx" 而不转义）
  // 2. 截断根括号闭合后的多余字符
  // 3. 补齐因 max_tokens 截断导致的缺失括号
  let jsonStr = fixUnescapedQuotes(text.slice(startIdx));
  jsonStr = trimToJsonEnd(jsonStr);
  jsonStr = repairTruncatedJson(jsonStr);
  try {
    const parsed = JSON.parse(jsonStr) as { rows?: StockRow[] };
    const rows = parsed.rows ?? [];
    // relation 不做截断，保留完整内容
    return rows;
  } catch {
    // JSON.parse 失败，用正则兜底提取
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
