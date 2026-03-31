import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { sendWxPush } from './notify.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../apps/web/.env.local') });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createClient(url, key);

  const { data } = await sb.from('dailyReport').select('content, summary').eq('report_date', '2026-03-27').single();
  if (!data) { console.error('找不到今天的报告'); process.exit(1); }

  console.log(`报告长度: ${data.content.length} 字符`);
  await sendWxPush('2026-03-27', data.content, data.summary);
}

main();
