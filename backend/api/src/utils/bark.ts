/**
 * Bark 推送工具（iOS 通知）
 * 环境变量：BARK_KEY（服务器 .env.server 配置；缺失时静默跳过，不影响业务）
 */

export async function sendBark(title: string, body: string): Promise<void> {
  const key = (process.env.BARK_KEY ?? '').trim();
  if (!key) return;

  const url =
    `https://api.day.app/${key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}` +
    `?group=${encodeURIComponent('观弈')}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    // 推送失败不影响主流程
  }
}
