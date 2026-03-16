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

// 从 DB 拉取所有已有主题，返回 Map<id, updated_at毫秒>，用于增量比对（含更新检测）
export async function fetchExistingThemes(): Promise<Map<string, number>> {
  const { data, error } = await getDb().from('themeConcept').select('id, updated_at');
  if (error) throw new Error('查询已有主题失败: ' + error.message);
  return new Map((data ?? []).map((r: { id: string; updated_at: number }) => [r.id, r.updated_at]));
}

// 更新已存在主题的股票池（保留 name/overview/created_at，只重建股票并刷新 updated_at）
export async function updateThemeStocks(theme: ProcessedTheme): Promise<void> {
  // 安全守卫：stocks 为 0 时拒绝执行，防止 Vision 解析失败时误删旧股票数据
  // 调用方应在 hasImages && stocks.length === 0 时跳过本函数而非传入空数组
  if (theme.stocks.length === 0) {
    throw new Error('stocks 为空，拒绝更新以保留旧数据（Vision 解析失败或图片无股票表格）');
  }

  // 1. 删除该主题所有旧股票
  const { error: de } = await getDb().from('themeStocks').delete().eq('theme_id', theme.id);
  if (de) throw new Error('删除旧股票失败: ' + de.message);

  // 2. 更新主题 updated_at（保留 name/overview/created_at 不变）
  const { error: ue } = await getDb()
    .from('themeConcept')
    .update({ updated_at: theme.updatedAt })
    .eq('id', theme.id);
  if (ue) throw new Error('更新主题时间失败: ' + ue.message);

  // 3. 重新插入股票
  if (theme.stocks.length === 0) return;
  const rows = theme.stocks.map((s, idx) => ({
    id: randomUUID(),
    theme_id: theme.id,
    code: '',
    name: s.name,
    cat1: s.cat1,
    cat2: s.cat2,
    cat3: s.cat3 || '',
    relation: s.relation || '',
    stars: s.highlight === 'red' ? 5 : s.highlight === 'orange' ? 4 : 3,
    highlight: s.highlight,
    sort_order: idx,
  }));
  const { error: se } = await getDb().from('themeStocks').insert(rows);
  if (se) throw new Error('股票重新插入失败: ' + se.message);
}

export async function importTheme(theme: ProcessedTheme): Promise<void> {
  // upsert：主题已存在时跳过（onConflict ignore），避免重试时重复插入报错
  const { error: te } = await getDb().from('themeConcept').upsert({
    id: theme.id,
    name: theme.name,
    overview: theme.overview,
    created_at: theme.createdAt,
    updated_at: theme.updatedAt,
  }, { onConflict: 'id', ignoreDuplicates: true });
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
    stars: s.highlight === 'red' ? 5 : s.highlight === 'orange' ? 4 : 3,
    highlight: s.highlight,
    sort_order: idx,
  }));
  const { error: se } = await getDb().from('themeStocks').insert(rows);
  if (se) throw new Error('股票批量插入失败: ' + se.message);
}
