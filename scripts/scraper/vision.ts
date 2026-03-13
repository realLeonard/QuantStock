import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

// 自动读取环境变量：ANTHROPIC_AUTH_TOKEN + ANTHROPIC_BASE_URL（与 Claude Code 共用同一代理配置）
const claude = new Anthropic();

export interface StockRow {
  cat1: string;
  cat2: string;
  cat3: string;
  stocks: Array<{ name: string; highlight: '' | 'red' | 'orange'; relation: string }>;
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
        relation: s[3].slice(0, 15),
      });
    }
    if (stocks.length > 0) rows.push({ cat1, cat2, cat3, stocks });
  }
  return rows;
}

export async function parseTableImage(imgUrl: string): Promise<StockRow[]> {
  // 下载图片转 base64
  const response = await fetch(imgUrl);
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
    model: 'claude-haiku-4-5-20251001',
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
请严格按照图片中从上到下的顺序提取所有行，仅返回如下格式 JSON，不要任何说明文字：
{"rows":[{"cat1":"大类名","cat2":"子类名","cat3":"细分名","stocks":[{"name":"股票名","highlight":"","relation":"相关性文字"}]}]}
提取规则：
- 保持图片中的原始顺序，不要重新排序
- 表格中红色/深红色字体的股票 highlight 填 "red"，普通黑色字体填 ""
- cat1、cat2、cat3 有合并单元格（rowspan）时，向下的行沿用同一个值
- 忽略水印文字、风险提示行、表头行
- 如果没有子类列，cat2 填 ""；如果没有细分列，cat3 填 ""
- 如果表格根本没有分类列（只有股票名），cat1/cat2/cat3 全部填 ""，不要用主题名或其他文字代替
- "相关性"列是该股票与主题的关联描述（通常在股票名旁边或下方），如无内容填 ""
- relation 字段严格限制在15字以内，超出部分直接截断，不加省略号
- 每行对应一个 stocks 数组，包含该行所有股票及其相关性`,
        },
      ],
    }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  // 找到 JSON 起始 {，取其后所有内容交给 repairTruncatedJson 修复
  // 不用贪婪正则截到最后一个 }，避免截掉截断点后面的有效内容
  const startIdx = text.indexOf('{');
  if (startIdx === -1) {
    console.warn('  Vision 未返回有效 JSON，原始响应:', text.slice(0, 200));
    return [];
  }
  let jsonStr = text.slice(startIdx);
  // 修复 JSON 被 max_tokens 截断的情况：补齐缺失的括号使其可解析
  jsonStr = repairTruncatedJson(jsonStr);
  try {
    const parsed = JSON.parse(jsonStr) as { rows?: StockRow[] };
    const rows = parsed.rows ?? [];
    // 代码层强制截断 relation，不依赖模型遵守提示词
    for (const row of rows) {
      for (const s of row.stocks) {
        if (s.relation && s.relation.length > 15) {
          s.relation = s.relation.slice(0, 15);
        }
      }
    }
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
