/**
 * Bark 推送工具（用于异常告警）
 * 环境变量：BARK_KEY（与 python 侧 cls_news_collector.py 共用）
 */

export async function sendBarkAlert(title: string, body: string): Promise<void> {
  const key = (process.env.BARK_KEY ?? '').trim();
  if (!key) return;

  const url = `https://api.day.app/${key}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
  } catch {
    // bark 推送失败不影响主流程
  }
}
