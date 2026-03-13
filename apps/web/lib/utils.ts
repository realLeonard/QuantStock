// ===== 生成唯一 ID =====
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ===== HTML 转义（防 XSS） =====
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===== 时间戳格式化 =====
export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== 星级字符串 =====
export function starStr(stars: number, total = 5): string {
  return '★'.repeat(stars) + '☆'.repeat(total - stars);
}
