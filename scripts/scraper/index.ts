import 'dotenv/config';
import { fetchList, type ThemeItem } from './fetcher.js';
import { parseTableImage, type StockRow } from './vision.js';
import { fetchExistingThemes, importTheme, updateThemeStocks, updateThemeMeta, clearStaleTopFields } from './importer.js';

const isTest = process.argv.includes('--test');

// 判断是否为每日末次运行（23:15 BJ）— 末次运行才对已有主题执行 Vision 解析更新股票池
// 非末次运行：已有主题只刷元数据（overview/sort_order/title_color），节省 Vision token
const isLastRun = (() => {
  const bjHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
  return bjHour >= 23;
})();

// 永久跳过的主题 ID（与 smart-sync.ts 保持一致）
const SKIP_IDS = new Set([
  '7df6369f82f34e15ae1f7f6d6342efa3', // 北交所(251029)：股票过多，手动排除
]);

// ─── 结果类型 ────────────────────────────────────────────────────────────────

type ResultStatus =
  | 'success'           // 成功写入 DB（有股票）
  | 'success_no_img'    // 成功写入 DB（主题本身无图片，股票为空属正常）
  | 'skipped_empty'     // 有图片但 Vision 解析为空 → 不写 DB，下次自动重试
  | 'failed';           // 出错（DB 异常、不可重试的 API 错误等）

interface ItemResult {
  id: string;
  name: string;
  mode: 'insert' | 'update';
  status: ResultStatus;
  stockCount: number;
  reason?: string;      // 仅 failed / skipped_empty 时填写
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const modeDesc = isTest
    ? '测试模式（只处理 1 条新主题）'
    : isLastRun
      ? '完整同步模式（末次运行，含 Vision 图片解析）'
      : '轻量同步模式（非末次，已有主题仅刷元数据）';
  console.log(`[韭研公社爬虫] ${modeDesc}`);
  console.log('---');

  // 启动时检查环境变量，快速定位配置缺失问题
  console.log('环境检查:');
  console.log(`  SUPABASE_URL      : ${process.env.SUPABASE_URL ? '✅' : '❌ 未设置'}`);
  console.log(`  SUPABASE_ANON_KEY : ${process.env.SUPABASE_ANON_KEY ? '✅' : '❌ 未设置'}`);
  console.log(`  DASHSCOPE_API_KEY : ${process.env.DASHSCOPE_API_KEY ? '✅' : '❌ 未设置'}`);
  console.log(`  JY_TOKEN          : ${process.env.JY_TOKEN ? '✅' : '❌ 未设置'}`);
  console.log('---');

  const [existingThemes, allItems] = await Promise.all([
    fetchExistingThemes(),
    fetchAllItems(),
  ]);

  // API 顺序前15条 + 位置映射（1-indexed）
  const top15 = allItems.slice(0, 15);
  const posMap = new Map(allItems.map((i, idx) => [i.industry_id, idx + 1]));

  // 新增：id 不在 DB（fetchAllItems 已限制为第一页 50 条，故新增最多 ~50 条）
  const filteredNew = allItems.filter(i => !existingThemes.has(i.industry_id));
  const newItems = isTest ? filteredNew.slice(0, 1) : filteredNew;

  // 更新检测：只在前15条中进行
  // - fullUpdateItems：update_time 日期推进 → 重新抓取图片 + 同步元数据
  // - metaOnlyItems  ：update_time 未变但 sort_order/title_color 与当前 API 不符 → 只刷元数据
  const fullUpdateItems: ThemeItem[] = [];
  const metaOnlyItems: ThemeItem[] = [];
  for (const item of top15) {
    const existing = existingThemes.get(item.industry_id);
    if (!existing) continue; // 新主题，走 newItems 路径

    if (item.update_time) {
      const onlineDate = item.update_time.slice(0, 10); // "YYYY-MM-DD"（北京时间日期）
      const dbDate = toBeijingDate(existing.updatedAt);
      if (onlineDate > dbDate) {
        fullUpdateItems.push(item);
        continue;
      }
    }

    // update_time 未推进：检查排位或标色是否变化
    const pos = posMap.get(item.industry_id)!;
    const currentSortOrder = pos;
    const currentTitleColor: 'red' | null = item.title_red === 1 ? 'red' : null;
    if (existing.sortOrder !== currentSortOrder || existing.titleColor !== currentTitleColor) {
      metaOnlyItems.push(item);
    }
  }

  const fullUpdateItemsToProcess = isTest ? [] : fullUpdateItems;
  const metaOnlyToProcess = isTest ? [] : metaOnlyItems;

  console.log(
    `线上 ${allItems.length} 个主题，DB 已有 ${existingThemes.size} 个，` +
    `新增 ${newItems.length} 个，` +
    `前15更新 ${fullUpdateItemsToProcess.length} 个，` +
    `前15排序变化 ${metaOnlyToProcess.length} 个`
  );

  if (newItems.length === 0 && fullUpdateItemsToProcess.length === 0 && metaOnlyToProcess.length === 0) {
    console.log('无待处理主题，退出。');
  } else {
    const results: ItemResult[] = [];

    // 排序变化（排位/标色变化，无需 Vision）
    if (metaOnlyToProcess.length > 0) {
      console.log(`\n处理 ${metaOnlyToProcess.length} 个排序变化...`);
      for (const item of metaOnlyToProcess) {
        const pos = posMap.get(item.industry_id)!;
        try {
          await updateThemeMeta(
            item.industry_id,
            item.content || '',
            pos,
            item.title_red === 1 ? 'red' : null,
          );
          console.log(`  [排序] ${item.title}`);
        } catch (e) {
          console.error(`  [排序失败] ${item.title}: ${(e as Error).message}`);
        }
        await sleep(200);
      }
    }

    // 第一轮：新增主题始终走完整 Vision 流程
    for (const item of newItems) {
      const pos = posMap.get(item.industry_id) ?? 9999;
      results.push(await processItem(item, 'insert', pos));
      await sleep(1200);
    }

    // 已有主题更新：末次运行走 Vision 重抓股票池，非末次仅刷元数据
    if (isLastRun) {
      for (const item of fullUpdateItemsToProcess) {
        const pos = posMap.get(item.industry_id)!;
        results.push(await processItem(item, 'update', pos));
        await sleep(1200);
      }
    } else if (fullUpdateItemsToProcess.length > 0) {
      console.log(`\n非末次运行，${fullUpdateItemsToProcess.length} 个已有主题仅刷元数据（跳过 Vision）`);
      for (const item of fullUpdateItemsToProcess) {
        const pos = posMap.get(item.industry_id)!;
        try {
          await updateThemeMeta(
            item.industry_id,
            item.content || '',
            pos,
            item.title_red === 1 ? 'red' : null,
          );
          console.log(`  [元数据] ${item.title}`);
        } catch (e) {
          console.error(`  [元数据失败] ${item.title}: ${(e as Error).message}`);
        }
        await sleep(200);
      }
    }

    // 第二轮：重试真正失败的（排除 skipped_empty，它们依靠下次运行自然重试）
    const toRetry = results.filter(r => r.status === 'failed');
    if (toRetry.length > 0) {
      console.log(`\n${'─'.repeat(40)}`);
      console.log(`重试 ${toRetry.length} 个失败主题...`);
      await sleep(5_000);

      const retryPool = isLastRun ? [...newItems, ...fullUpdateItemsToProcess] : [...newItems];
      const itemMap = new Map(retryPool.map(i => [i.industry_id, i]));
      for (const r of toRetry) {
        const item = itemMap.get(r.id);
        if (!item) continue;
        const pos = posMap.get(r.id) ?? 9999;
        const retryResult = await processItem(item, r.mode, pos);
        const idx = results.findIndex(x => x.id === r.id);
        if (idx !== -1) results[idx] = retryResult;
        await sleep(2400);
      }
    }

    printSummary(results);
  }

  // 每次运行结束都清空不在前15的 sort_order/title_color（前15顺序随时可能变化）
  const top15Ids = top15.map(i => i.industry_id);
  try {
    const cleared = await clearStaleTopFields(top15Ids);
    if (cleared > 0) console.log(`\n已清空 ${cleared} 个主题的历史排序/标识字段`);
  } catch (e) {
    console.error(`清空历史字段失败: ${(e as Error).message}`);
  }
}

// ─── 处理单个主题 ─────────────────────────────────────────────────────────────

async function processItem(item: ThemeItem, mode: 'insert' | 'update', globalPos: number): Promise<ItemResult> {
  const modeLabel = mode === 'update' ? '[更新]' : '[新增]';
  console.log(`\n${modeLabel} [${item.title}]`);

  const base: Omit<ItemResult, 'status' | 'stockCount' | 'reason'> = {
    id: item.industry_id,
    name: item.title,
    mode,
  };

  // 解析图片 URL
  let imgUrls: string[] = [];
  try {
    imgUrls = JSON.parse(item.imgs || '[]') as string[];
  } catch {
    imgUrls = item.imgs ? item.imgs.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (imgUrls.length > 0) console.warn(`  imgs 非 JSON，逗号分割得到 ${imgUrls.length} 个 URL`);
  }

  const hasImages = imgUrls.length > 0;

  // 逐张解析图片
  const rows: StockRow[] = [];
  for (let imgIdx = 0; imgIdx < imgUrls.length; imgIdx++) {
    console.log(`  解析图片 ${imgIdx + 1}/${imgUrls.length}...`);
    try {
      const partial = await parseTableImage(imgUrls[imgIdx]);
      rows.push(...partial);
      console.log(`    提取到 ${partial.length} 个分类行`);
    } catch (e) {
      console.warn(`    图片 ${imgIdx + 1} 最终失败: ${(e as Error).message}`);
    }
    if (imgIdx < imgUrls.length - 1) await sleep(600);
  }

  const cleanTitle = item.title.replace(/[（(].*/u, '').trim();
  const stocks = rows.flatMap(r =>
    r.stocks.map(s => ({
      name: s.name,
      cat1: sanitizeCat(r.cat1, cleanTitle),
      cat2: sanitizeCat(r.cat2, cleanTitle),
      cat3: sanitizeCat(r.cat3, cleanTitle),
      highlight: s.highlight,
      relation: s.relation,
    }))
  );

  // ── 关键保护：有图片但解析结果为空 ──────────────────────────────────────────
  // 可能原因：Vision 超时/限流、图片无股票表格、图片格式异常等
  // 策略：不写入 DB，保持原状（新主题不插入 → 下次仍视为新主题；更新主题不修改 → 下次仍触发更新）
  if (hasImages && stocks.length === 0) {
    console.warn(`  ⚠️  有 ${imgUrls.length} 张图片但解析结果为空，跳过写入（下次自动重试）`);
    return { ...base, status: 'skipped_empty', stockCount: 0, reason: '有图片但 Vision 解析结果为空' };
  }

  const processedTheme = {
    id: item.industry_id,
    name: cleanTitle,
    overview: item.content || '',
    createdAt: item.create_time ? parseBeijingTime(item.create_time) : Date.now(),
    updatedAt: item.update_time
      ? parseBeijingTime(item.update_time)
      : (item.create_time ? parseBeijingTime(item.create_time) : Date.now()),
    stocks,
    // 前15条写入 sort_order/title_color（update 必在前15；insert 按实际位置判断）
    ...(globalPos <= 15 ? {
      sortOrder: globalPos,
      titleColor: (item.title_red === 1 ? 'red' : null) as 'red' | null,
    } : {}),
  };

  try {
    if (mode === 'update') {
      await updateThemeStocks(processedTheme);
      console.log(`  ✅ 更新成功，共 ${stocks.length} 支股票`);
    } else {
      await importTheme(processedTheme);
      console.log(`  ✅ 导入成功，共 ${stocks.length} 支股票`);
    }
    const status: ResultStatus = stocks.length > 0 ? 'success' : 'success_no_img';
    return { ...base, status, stockCount: stocks.length };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`  ❌ 失败: ${reason}`);
    return { ...base, status: 'failed', stockCount: 0, reason };
  }
}

// ─── 汇总打印 ────────────────────────────────────────────────────────────────

function printSummary(results: ItemResult[]) {
  console.log(`\n${'='.repeat(50)}`);
  console.log('运行汇总');
  console.log('='.repeat(50));

  const success     = results.filter(r => r.status === 'success');
  const successNoImg = results.filter(r => r.status === 'success_no_img');
  const skipped     = results.filter(r => r.status === 'skipped_empty');
  const failed      = results.filter(r => r.status === 'failed');

  console.log(`✅ 成功（有股票）  : ${success.length} 个`);
  console.log(`✅ 成功（无图片）  : ${successNoImg.length} 个（主题本身无股票表格，正常）`);
  console.log(`🔁 跳过待重试     : ${skipped.length} 个（有图片但 Vision 解析为空，下次自动重试）`);
  console.log(`❌ 失败           : ${failed.length} 个`);

  if (skipped.length > 0) {
    console.log('\n── 待重试主题（下次运行将自动处理）──');
    for (const r of skipped) {
      console.log(`  [${r.mode}] ${r.name}`);
    }
  }

  if (failed.length > 0) {
    console.log('\n── 失败主题（需关注）──');
    // 按错误原因分组
    const byReason = new Map<string, ItemResult[]>();
    for (const r of failed) {
      const key = classifyError(r.reason ?? '');
      const arr = byReason.get(key) ?? [];
      arr.push(r);
      byReason.set(key, arr);
    }
    for (const [reason, items] of byReason) {
      console.log(`  [${reason}] × ${items.length} 个`);
      for (const r of items) {
        console.log(`    - [${r.mode}] ${r.name}${r.reason ? `（${r.reason.slice(0, 60)}）` : ''}`);
      }
    }
  }

  console.log('\n' + '='.repeat(50));
}

// 将错误信息归类为可读标签
function classifyError(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('timeout') || r.includes('timed out')) return '超时';
  if (r.includes('rate_limit') || r.includes('rate limit')) return 'API限流';
  if (r.includes('overloaded')) return '模型过载';
  if (r.includes('authentication') || r.includes('auth')) return '鉴权失败';
  if (r.includes('http 4')) return '图片不存在(4xx)';
  if (r.includes('http 5') || r.includes('503') || r.includes('502')) return '服务端错误(5xx)';
  if (r.includes('econnreset') || r.includes('econnrefused') || r.includes('enotfound')) return '网络连接失败';
  if (r.includes('supabase') || r.includes('db') || r.includes('insert') || r.includes('update')) return 'DB写入失败';
  return '其他错误';
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

// 只拉第一页 50 条，降低被源站风控的概率：
// - 前15 sort_order 必在第一页
// - 新增/有更新的主题因 update_time 变化，源站大概率会重排到靠前位置
// - 漏掉的长尾新增可通过观察 Actions 日志「新增 N 个」是否归零来判断风险
async function fetchAllItems(): Promise<ThemeItem[]> {
  const data = await fetchList(1, 50);
  // 过滤用户贡献主题（author 非 null 且非空字符串），只保留官方内容
  const official = data.result.filter((i: ThemeItem) => i.author === null || i.author === '');
  console.log(`  拉取列表 start=1，本页 ${data.result.length} 条，官方 ${official.length} 条`);
  const filtered = official.filter(i => !SKIP_IDS.has(i.industry_id));
  if (filtered.length < official.length) {
    console.log(`  跳过 ${official.length - filtered.length} 个永久排除主题（SKIP_IDS）`);
  }
  return filtered;
}

// 分类名校验：防止 Vision 把主题标题或长文本误填入 cat 字段
function sanitizeCat(value: string, themeTitle: string): string {
  if (!value) return '';
  if (value.trim() === themeTitle.trim()) return '';
  if (value.length > 20) return '';
  return value.trim();
}

// API 返回的时间字符串是北京时间（UTC+8），无时区标识
// 必须显式加 +08:00，否则在 GitHub Actions（UTC 环境）会被当作 UTC 解析，导致差 8 小时
function parseBeijingTime(str: string): number {
  return new Date(str.replace(' ', 'T') + '+08:00').getTime();
}

// 将 UTC 毫秒转为北京日期字符串（YYYY-MM-DD），用于日期级别比对
function toBeijingDate(utcMs: number): string {
  return new Date(utcMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(e => {
  console.error('致命错误:', e);
  process.exit(1);
});
