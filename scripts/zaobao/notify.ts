/**
 * WxPusher 微信推送
 * 文档：https://wxpusher.zjiecode.com/docs/
 *
 * 环境变量：
 *   WXPUSHER_TOKEN  — 应用 appToken
 *   WXPUSHER_UID    — 用户 UID（逗号分隔，支持多人）
 */

import axios from 'axios';

const WXPUSHER_API = 'https://wxpusher.zjiecode.com/api/send/message';

interface WxPusherPayload {
  appToken: string;
  content: string;
  summary: string;
  contentType: number; // 1=文字, 2=HTML, 3=Markdown
  uids: string[];
  url?: string;
}

interface WxPusherResponse {
  code: number;
  msg: string;
  success: boolean;
  data: {
    uid: string;
    messageId: number;
    code: number;
    status: string;
  }[];
}

/**
 * 发送 WxPusher 推送
 * @param date 报告日期（YYYY-MM-DD）
 * @param content 完整报告 Markdown
 * @param summary 今日一句话（推送摘要）
 */
export async function sendWxPush(date: string, content: string, summary: string): Promise<void> {
  const token = process.env.WXPUSHER_TOKEN;
  const uidsRaw = process.env.WXPUSHER_UID;

  if (!token || !uidsRaw) {
    console.warn('  [notify] 未配置 WXPUSHER_TOKEN / WXPUSHER_UID，跳过推送');
    return;
  }

  const uids = uidsRaw.split(',').map(u => u.trim()).filter(Boolean);

  // WxPusher 对 Markdown 内容有长度限制（约 3000 字），截断处理
  const MAX_LEN = 2800;
  const pushContent = content.length > MAX_LEN
    ? content.slice(0, MAX_LEN) + '\n\n...(内容已截断，请查看完整版)'
    : content;

  const payload: WxPusherPayload = {
    appToken: token,
    content: pushContent,
    summary: `📰 ${date} 投资早报 | ${summary.slice(0, 50)}`,
    contentType: 3, // Markdown
    uids,
  };

  console.log(`  [notify] 推送到 ${uids.length} 位用户...`);

  const res = await axios.post<WxPusherResponse>(WXPUSHER_API, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  if (res.data.success) {
    const successCount = res.data.data?.filter(d => d.code === 1000).length ?? 0;
    console.log(`  [notify] 推送成功，${successCount}/${uids.length} 位用户收到`);
  } else {
    console.error(`  [notify] 推送失败: ${res.data.msg}`);
  }
}
