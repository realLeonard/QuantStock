import type { NewsArticleBlock } from '@quantstock/types';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// 只放行财联社自有图床，防止正文里夹带任意外链图片
const IMAGE_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*cls\.cn\//i;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–',
  hellip: '…', middot: '·', times: '×', yen: '¥',
};

export class ClsArticleError extends Error {
  constructor(message: string, public status: 404 | 502) {
    super(message);
  }
}

const cache = new Map<string, { blocks: NewsArticleBlock[]; expires: number }>();

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

function htmlToText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** 把财联社正文 HTML 转成纯文本/图片块，前端直接渲染，不注入任何 HTML */
export function parseArticleHtml(html: string): NewsArticleBlock[] {
  const blocks: NewsArticleBlock[] = [];
  const segments = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) ?? [html];

  for (const seg of segments) {
    const text = htmlToText(seg);
    if (text) blocks.push({ type: 'text', text });
    for (const m of seg.matchAll(/<img[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
      const src = decodeEntities(m[1]);
      if (IMAGE_HOST_RE.test(src)) blocks.push({ type: 'image', src });
    }
  }
  return blocks;
}

/** 返回正文 HTML；页面结构无法识别时返回 null，文章不存在时返回空串 */
export function extractArticleContent(pageHtml: string): string | null {
  const m = pageHtml.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data: unknown = JSON.parse(m[1]);
    const pageProps = (data as { props?: { pageProps?: { articleDetail?: { content?: unknown } } } })
      ?.props?.pageProps;
    if (!pageProps) return null;
    const content = pageProps.articleDetail?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return null;
  }
}

export async function fetchClsArticle(id: string): Promise<NewsArticleBlock[]> {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.blocks;

  let resp: Response;
  try {
    resp = await fetch(`https://www.cls.cn/detail/${id}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new ClsArticleError('财联社连接超时，请稍后重试', 502);
  }
  if (resp.status === 404) throw new ClsArticleError('原文不存在或已删除', 404);
  if (!resp.ok) throw new ClsArticleError(`财联社返回异常（HTTP ${resp.status}）`, 502);

  const content = extractArticleContent(await resp.text());
  if (content === null) throw new ClsArticleError('未能解析原文，可能页面结构已变更', 502);
  if (content === '') throw new ClsArticleError('原文不存在或已删除', 404);

  const blocks = parseArticleHtml(content);
  if (blocks.length === 0) throw new ClsArticleError('原文正文为空', 404);

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, { blocks, expires: Date.now() + CACHE_TTL_MS });
  return blocks;
}
