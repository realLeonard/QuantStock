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
  sortOrder?: number;        // 主题列表前15条的排序序号
  titleColor?: 'red' | null; // 主题名称颜色（red 或 null）
}

export interface ExistingThemeInfo {
  updatedAt: number;
  sortOrder: number | null;
  titleColor: string | null;
}

// 从 DB 拉取所有已有主题，返回 Map<id, ExistingThemeInfo>，用于增量比对
export async function fetchExistingThemes(): Promise<Map<string, ExistingThemeInfo>> {
  const { data, error } = await getDb()
    .from('themeConcept')
    .select('id, updated_at, sort_order, title_color');
  if (error) throw new Error('查询已有主题失败: ' + error.message);
  return new Map((data ?? []).map((r: { id: string; updated_at: number; sort_order: number | null; title_color: string | null }) =>
    [r.id, { updatedAt: r.updated_at, sortOrder: r.sort_order, titleColor: r.title_color }]
  ));
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

  // 2. 更新主题元数据（updated_at + overview + sort_order/title_color，保留 name/created_at 不变）
  const metaUpdate: Record<string, unknown> = { updated_at: theme.updatedAt, overview: theme.overview };
  if (theme.sortOrder !== undefined) metaUpdate.sort_order = theme.sortOrder;
  if (theme.titleColor !== undefined) metaUpdate.title_color = theme.titleColor;
  const { error: ue } = await getDb()
    .from('themeConcept')
    .update(metaUpdate)
    .eq('id', theme.id);
  if (ue) throw new Error('更新主题元数据失败: ' + ue.message);

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

// 仅更新主题的元数据字段（sort_order/title_color/overview），不触碰股票数据
// 用于：主题仍在前15但排位或标色变化、update_time 未推进无需重抓图片的场景
export async function updateThemeMeta(
  id: string,
  overview: string,
  sortOrder: number,
  titleColor: 'red' | null,
): Promise<void> {
  const { error } = await getDb()
    .from('themeConcept')
    .update({ overview, sort_order: sortOrder, title_color: titleColor })
    .eq('id', id);
  if (error) throw new Error('更新主题元数据失败: ' + error.message);
}

// 清空不再位于前15条的主题的 sort_order 和 title_color（每次增量同步后执行）
// 返回被清空的主题数量
export async function clearStaleTopFields(currentTop15Ids: string[]): Promise<number> {
  if (currentTop15Ids.length === 0) return 0;
  // 查出有 sort_order 或 title_color 但不在前15中的主题
  const { data, error: qe } = await getDb()
    .from('themeConcept')
    .select('id')
    .or('sort_order.not.is.null,title_color.not.is.null');
  if (qe) throw new Error('查询排序/标识字段失败: ' + qe.message);
  const staleIds = (data ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !currentTop15Ids.includes(id));
  if (staleIds.length === 0) return 0;
  const { error } = await getDb()
    .from('themeConcept')
    .update({ sort_order: null, title_color: null })
    .in('id', staleIds);
  if (error) throw new Error('清空历史排序/标识字段失败: ' + error.message);
  return staleIds.length;
}

export async function importTheme(theme: ProcessedTheme): Promise<void> {
  // upsert 主题：已存在则更新，不存在则插入（幂等，重试安全）
  // sortOrder/titleColor 仅在明确传入时才写入（undefined = 不更新该字段）
  const upsertData: Record<string, unknown> = {
    id: theme.id,
    name: theme.name,
    overview: theme.overview,
    created_at: theme.createdAt,
    updated_at: theme.updatedAt,
  };
  if (theme.sortOrder !== undefined) upsertData.sort_order = theme.sortOrder;
  if (theme.titleColor !== undefined) upsertData.title_color = theme.titleColor;

  const { error: te } = await getDb().from('themeConcept').upsert(upsertData, { onConflict: 'id' });
  if (te) throw new Error('主题插入失败: ' + te.message);

  // 先删旧股票再插入新股票，保证幂等（重试时不产生重复数据）
  const { error: de } = await getDb().from('themeStocks').delete().eq('theme_id', theme.id);
  if (de) throw new Error('删除旧股票失败: ' + de.message);

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
