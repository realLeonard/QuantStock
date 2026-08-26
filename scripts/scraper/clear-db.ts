import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);

async function main() {
  console.log('删除 themeStocks...');
  const { error: e1, count: c1 } = await sb.from('themeStocks').delete().neq('id', '').select('id', { count: 'exact', head: true });
  if (e1) throw new Error('删除 themeStocks 失败: ' + e1.message);
  console.log(`  themeStocks 删除完成`);

  console.log('删除 themeConcept...');
  const { error: e2, count: c2 } = await sb.from('themeConcept').delete().neq('id', '').select('id', { count: 'exact', head: true });
  if (e2) throw new Error('删除 themeConcept 失败: ' + e2.message);
  console.log(`  themeConcept 删除完成`);

  // 验证
  const { count: remaining } = await sb.from('themeConcept').select('*', { count: 'exact', head: true });
  console.log(`\n验证：themeConcept 剩余 ${remaining} 条`);
}

main().catch(e => { console.error(e); process.exit(1); });
