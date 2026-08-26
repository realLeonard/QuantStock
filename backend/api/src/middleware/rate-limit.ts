// 内存频率限制（单实例 PM2 可接受，进程重启即清零）

/** 记录一次命中并判断窗口内是否超限：true=放行，false=超限 */
export function hitAndCheck(
  map: Map<string, number[]>,
  key: string,
  windowMs: number,
  max: number
): boolean {
  const now = Date.now();
  const list = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    map.set(key, list);
    return false;
  }
  list.push(now);
  map.set(key, list);
  return true;
}

/**
 * 从请求头解析客户端 IP。
 * 取 x-forwarded-for 末段：Nginx proxy_add_x_forwarded_for 追加的真实 IP 在最后，
 * 客户端伪造的条目只会排在前面。3001 端口防火墙收紧后（仅允许 Nginx 访问）即完全可信。
 */
export function clientIp(xForwardedFor: string | undefined): string {
  const parts = (xForwardedFor ?? '').split(',');
  return parts[parts.length - 1].trim() || 'unknown';
}
