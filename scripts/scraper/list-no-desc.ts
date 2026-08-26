import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY)!);

async function main() {
  const { data, error } = await db
    .from('themeConcept')
    .select('id, name, overview')
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const noDesc = (data ?? []).filter(t => !t.overview?.trim());
  console.log(`无描述主题共 ${noDesc.length} 个：\n`);
  for (const t of noDesc) {
    console.log(`${t.id}  ${t.name}`);
  }
}
main().catch(console.error);
