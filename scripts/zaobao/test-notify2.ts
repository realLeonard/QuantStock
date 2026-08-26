import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { sendWxPush } from './notify.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../apps/web/.env.local') });

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!
  );

  const { data } = await sb.from('dailyReport').select('content, summary').eq('report_date', '2026-03-27').single();
  if (!data) { console.error('找不到今天的报告'); process.exit(1); }

  // 把 **粗体** 替换为 _斜体_，去除中间分隔线，保留最后一条，DB 不动
  const lastHr = data.content.lastIndexOf('\n---\n');
  const body = lastHr !== -1 ? data.content.slice(0, lastHr) : data.content;
  const tail = lastHr !== -1 ? data.content.slice(lastHr) : '';
  const converted = (body.replace(/\n---\n/g, '\n') + tail)
    .replace(/\*\*(.+?)\*\*/g, '_$1_');

  console.log(`原始长度: ${data.content.length}，转换后: ${converted.length}`);
  await sendWxPush('2026-03-27', converted, data.summary);
}
main();
