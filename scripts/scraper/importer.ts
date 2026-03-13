import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// 懒初始化：首次调用时才创建客户端，确保 dotenv 已加载完毕
let _sb: ReturnType<typeof createClient> | null = null;
function getDb() {
  if (!_sb) _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  return _sb;
}

export interface StockEntry {
  name: string;
  cat1: string;
  cat2: string;
  cat3: string;
  highlight: '' | 'red' | 'orange';
  relation: string;
}

export interface ProcessedTheme {
  id: string;
  name: string;
  overview: string;
  createdAt: number;
  updatedAt: number;  // 有 create_time 时与 createdAt 相同，否则为当前时间
  stocks: StockEntry[];
}

// 从 DB 拉取所有已有主题 ID，用于增量比对
export async function fetchExistingIds(): Promise<Set<string>> {
  const { data, error } = await getDb().from('themeConcept').select('id');
  if (error) throw new Error('查询已有主题失败: ' + error.message);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

export async function importTheme(theme: ProcessedTheme): Promise<void> {
  // 插入主题
  const { error: te } = await getDb().from('themeConcept').insert({
    id: theme.id,
    name: theme.name,
    overview: theme.overview,
    created_at: theme.createdAt,
    updated_at: theme.updatedAt,
  });
  if (te) throw new Error('主题插入失败: ' + te.message);

  if (theme.stocks.length === 0) return;

  // 批量插入股票，按图片顺序赋 sort_order（0, 1, 2…）
  const rows = theme.stocks.map((s, idx) => ({
    id: randomUUID(),
    theme_id: theme.id,
    code: '',
    name: s.name,
    cat1: s.cat1,
    cat2: s.cat2,
    cat3: s.cat3 || '',
    relation: s.relation || '',
    stars: 3,
    highlight: s.highlight,
    sort_order: idx,
  }));
  const { error: se } = await getDb().from('themeStocks').insert(rows);
  if (se) throw new Error('股票批量插入失败: ' + se.message);
}
