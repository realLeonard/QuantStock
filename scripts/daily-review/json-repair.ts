/**
 * JSON 修复工具集 — 处理 AI（Claude / Qwen）返回的不完整或格式错误 JSON
 */

/** 找到第一个平衡闭合的 JSON 对象/数组，截断后续垃圾字符 */
export function trimToJsonEnd(str: string): string {
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

/** 补全被截断的 JSON（闭合未关闭的字符串、数组、对象） */
export function repairTruncatedJson(str: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (const ch of str) {
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (inString) str += '"';
  // 清理截断产生的尾部逗号
  str = str.replace(/,\s*$/, '');
  return str + stack.reverse().join('');
}

/**
 * 修复 JSON 字符串值中未转义的双引号。
 * AI 常返回如 "keyword":"投资"凌空天行"" — 内嵌引号导致解析失败。
 */
export function fixInnerQuotes(s: string): string {
  const result: string[] = [];
  let i = 0;
  let inStr = false;

  while (i < s.length) {
    const ch = s[i];

    if (!inStr) {
      result.push(ch);
      if (ch === '"') inStr = true;
      i++;
      continue;
    }

    if (ch === '\\') {
      result.push(ch);
      if (i + 1 < s.length) {
        result.push(s[i + 1]);
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && ' \t\n\r'.includes(s[j])) j++;
      if (j >= s.length || ',}]:'.includes(s[j])) {
        result.push(ch);
        inStr = false;
      } else {
        result.push('\\"');
      }
      i++;
      continue;
    }

    result.push(ch);
    i++;
  }

  return result.join('');
}

/**
 * 从 AI 原始输出中提取并修复 JSON。
 * 处理流程：去代码块 → 定位首个 { → fixInnerQuotes → trimToJsonEnd → repairTruncatedJson
 */
export function extractAndRepairJson(rawText: string): string {
  let text = rawText.trim();

  // 去掉 markdown 代码块包裹
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 定位首个 JSON 对象
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) {
    throw new Error(`AI 未返回 JSON：${text.slice(0, 200)}`);
  }
  text = text.slice(firstBrace);

  // 三步修复
  text = fixInnerQuotes(text);
  text = trimToJsonEnd(text);
  text = repairTruncatedJson(text);

  return text;
}
