'use client';

/**
 * 每日复盘 v3 全览面板（深色报告风格）
 *
 * 与 V2 数据源完全一致，只改展示方式：能用图形表达的不用文字。
 *
 * 结构（自上而下）：
 *   头部 → 一、情绪仪表盘（含指数）→ 二、资金画像 → 三、影响盘面的资讯
 *   → 四、主线分析 → 五、涨停梯队全景 → 六、明日作战计划（含风险提示）→ 七、昨日验证
 */

import { useState } from 'react';
import type {
  AiAnalysisV2,
  AiAnalysisV2ImportantNews,
  AiAnalysisV2MainTheme,
  DailyReview,
  HotMoneyMove,
  LimitUpReasons,
  MarginData,
} from '@quantstock/types';
import s from './FullReportV3.module.css';
import { InfoTip } from './DailyReviewView';

const TIPS: Record<string, string> = {
  炸板率:
    '炸板率 = 炸板数 ÷（炸板数 + 封板数）× 100%\n\n反映打板情绪的"成功率"：\n• < 20%：封板扎实，打板情绪好\n• 20-40%：中性，需看最高板能否带动\n• > 40%：情绪差，资金接力意愿弱',
  晋级率:
    '首板晋级率 = 昨日首板股中今日晋级 2 板的家数 ÷ 昨日首板总数 × 100%\n\n• > 30%：赚钱效应强，可积极打首板\n• 15-30%：中性\n• < 15%：首板难以晋级，避免接力',
  溢价率:
    '打板溢价率 = 次日高标接力股平均开盘涨幅 ÷ 10%（或 20%）× 100%\n\n• > 80%：资金情绪高涨，接力意愿强\n• 50-80%：中性\n• < 50%：溢价低迷，打板性价比差',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Props {
  ai: AiAnalysisV2;
  review: DailyReview;
  limitUpReasons?: LimitUpReasons | null;
}

export default function FullReportV3({ ai, review, limitUpReasons }: Props) {
  return (
    <div className={s.root}>
      <ReportHeader ai={ai} review={review} />
      <div className={s.inner}>
        <SentimentDashboard ai={ai} review={review} />
        <FundPicture ai={ai} review={review} />
        <NewsTimeline news={ai.important_news ?? []} />
        <MainThemes themes={ai.main_themes ?? []} />
        <LadderPanorama ai={ai} review={review} limitUpReasons={limitUpReasons} />
        <BattlePlan ai={ai} />
        <YesterdayVerify ai={ai} />
      </div>
    </div>
  );
}

// ===== 工具 =====

/** 交易日字符串按 UTC 解析取星期，避免浏览器本地时区把日期推前一天 */
function weekdayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : `周${WEEKDAYS[d.getUTCDay()]}`;
}

function fmt(v: unknown, digits = 2): string {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? '-' : n.toFixed(digits);
}

function signed(v: number | null | undefined, unit = '亿'): string {
  if (v == null) return '-';
  return `${v >= 0 ? '+' : ''}${fmt(v)}${unit}`;
}

function upDownCls(v: number | null | undefined): string {
  if (v == null) return '';
  return v >= 0 ? s.red : s.green;
}

/** 亿 → 万亿，成交额这类大数读起来更直观 */
function toTrillion(yi: number | null | undefined): string {
  if (yi == null) return '-';
  return yi >= 10000 ? `${(yi / 10000).toFixed(2)}万亿` : `${Math.round(yi)}亿`;
}

// ===== 头部 =====

function ReportHeader({ ai, review }: { ai: AiAnalysisV2; review: DailyReview }) {
  return (
    <div className={s.header}>
      <div className={s.headerTop}>
        <div className={s.headerTitle}>
          📊 每日<em>复盘</em>
        </div>
        <div className={s.headerBadge}>情绪 · {ai.sentiment.stage}</div>
      </div>
      <div className={s.headerSub}>
        {review.report_date} {weekdayOf(review.report_date)} · 收盘复盘 ｜ <b>{ai.headline}</b>
      </div>
    </div>
  );
}

// ===== 一、情绪仪表盘（含指数） =====

interface Gauge {
  label: string;
  value: React.ReactNode;
  /** 整体着色；涨跌分色的指标留空，由 value 内部自带 span 控制 */
  color?: string;
  note?: string;
  tip?: string;
}

function SentimentDashboard({ ai, review }: { ai: AiAnalysisV2; review: DailyReview }) {
  const sm = (review.market_sentiment ?? {}) as Record<string, number>;
  const ov = (review.market_overview ?? {}) as Record<string, unknown>;
  const la = (review.limit_analysis ?? {}) as Record<string, unknown>;
  const volume = (ov.volume ?? null) as Record<string, number> | null;
  const yw = (ov.yellow_white ?? null) as Record<string, string> | null;
  const indices = (ov.indices ?? []) as Record<string, unknown>[];
  const ps = (la.premium_summary ?? null) as Record<string, number> | null;
  const pm = (la.promotion ?? null) as Record<string, number> | null;
  const ss = (la.seal_stats ?? null) as Record<string, number> | null;
  const ladder = (review.limit_up_ladder ?? []) as Record<string, unknown>[];

  const maxLevel = ladder.reduce((m, it) => Math.max(m, (it.continuous_limit as number) ?? 1), 0);
  const leaders = ladder
    .filter(it => ((it.continuous_limit as number) ?? 1) === maxLevel)
    .map(it => it.name as string)
    .slice(0, 2)
    .join('、');

  const total = (sm.up_count ?? 0) + (sm.down_count ?? 0);
  const profitRate = total > 0 ? ((sm.up_count / total) * 100).toFixed(1) : null;

  const gauges: Gauge[] = [];

  gauges.push({
    label: '涨停 / 跌停',
    value: (
      <>
        <span className={s.red}>{sm.limit_up ?? '-'}</span>
        <span className={s.gaugeSep}>/</span>
        <span className={s.green}>{sm.limit_down ?? '-'}</span>
      </>
    ),
  });

  if (volume?.today != null) {
    gauges.push({
      label: '两市成交额',
      value: toTrillion(volume.today),
      color: s.white,
      note:
        volume.change_pct != null
          ? `${volume.change_pct >= 0 ? '放量' : '缩量'} ${fmt(Math.abs(volume.change_pct), 2)}%`
          : undefined,
    });
  }

  if (sm.up_count != null) {
    gauges.push({
      label: '涨跌家数',
      value: (
        <>
          <span className={s.red}>{sm.up_count}</span>
          <span className={s.gaugeSep}>:</span>
          <span className={s.green}>{sm.down_count ?? '-'}</span>
        </>
      ),
      note: profitRate ? `赚钱效应 ${profitRate}%` : undefined,
    });
  }

  if (maxLevel > 0) {
    gauges.push({
      label: '连板最高度',
      value: `${maxLevel}板`,
      color: maxLevel >= 6 ? s.gold : s.red,
      note: leaders || undefined,
    });
  }

  // 炸板家数与炸板率同源，合在一张卡里读起来才有参照
  if (sm.broken_rate != null || sm.broken_limit != null) {
    const brokenNotes = [
      sm.broken_limit != null ? `炸板 ${sm.broken_limit} 家` : null,
      ss?.total_seal_fund != null ? `封单合计 ${fmt(ss.total_seal_fund, 0)}亿` : null,
    ].filter((x): x is string => x != null);
    gauges.push({
      label: '炸板率',
      value: sm.broken_rate != null ? `${fmt(sm.broken_rate, 1)}%` : '-',
      color: (sm.broken_rate ?? 0) >= 40 ? s.green : s.gold,
      note: brokenNotes.join(' · ') || undefined,
      tip: TIPS.炸板率,
    });
  }

  if (pm?.rate != null || ps?.premium_rate != null) {
    gauges.push({
      label: '晋级率 / 溢价率',
      value: (
        <>
          {pm?.rate != null ? `${fmt(pm.rate, 1)}%` : '-'}
          <span className={s.gaugeSep}>/</span>
          {ps?.premium_rate != null ? `${fmt(ps.premium_rate, 1)}%` : '-'}
        </>
      ),
      color: s.gold,
      note: '首板晋级 / 昨日涨停有溢价比例',
      tip: `${TIPS.晋级率}\n\n————\n\n${TIPS.溢价率}`,
    });
  }

  const dims = [
    { label: '宽度', text: ai.sentiment.width_conclusion },
    { label: '高度', text: ai.sentiment.ladder_conclusion },
    { label: '赚钱效应', text: ai.sentiment.profit_conclusion },
    { label: '风格', text: ai.sentiment.style_conclusion },
  ].filter(d => d.text);

  // 温度条按 0-100 定位，AI 给的是 1-10 分
  const score = Math.max(0, Math.min(10, ai.sentiment.score ?? 0));
  const pointerPct = score * 10;

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>一、情绪仪表盘</h2>

      {indices.length > 0 && (
        <div className={s.indexGrid}>
          {indices.map((idx, i) => {
            const chg = idx.change_pct as number | null;
            return (
              <div key={i} className={s.indexCard}>
                <div>
                  <div className={s.indexName}>{idx.name as string}</div>
                  <div className={s.indexValue}>{fmt(idx.close)}</div>
                </div>
                <div className={`${s.indexChange} ${upDownCls(chg)}`}>
                  {chg == null ? '-' : `${chg >= 0 ? '+' : ''}${fmt(chg)}%`}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {yw?.style_bias && <div className={s.caption}>盘面风格：{yw.style_bias}</div>}

      {gauges.length > 0 && (
        <div className={s.gaugeGrid} style={{ marginTop: 12 }}>
          {gauges.map((g, i) => (
            <div key={i} className={s.gaugeCard}>
              <div className={s.gaugeLabel}>
                {g.label}
                {g.tip && <InfoTip text={g.tip} />}
              </div>
              <div className={`${s.gaugeValue} ${g.color ?? ''}`}>{g.value}</div>
              {g.note && <div className={s.gaugeNote}>{g.note}</div>}
            </div>
          ))}
        </div>
      )}

      <div className={s.tempBox}>
        <div className={s.tempHead}>
          <span>情绪温度：{score}/10</span>
          <b>当前判断：{ai.sentiment.stage}</b>
        </div>
        <div className={s.tempBar}>
          <div className={s.tempPointer} style={{ left: `${pointerPct}%` }}>
            {score}
          </div>
        </div>
        <div className={s.tempLabels}>
          <span>❄️ 冰点</span>
          <span>🌤 回暖</span>
          <span>🔥 主升</span>
          <span>🌋 高潮</span>
        </div>
      </div>

      {dims.length > 0 && (
        <>
          <div className={s.subTitle}>情绪结构</div>
          <div className={s.dimGrid}>
            {dims.map((d, i) => (
              <div key={i} className={s.dimCard}>
                <div className={s.dimLabel}>{d.label}</div>
                <div className={s.dimText}>{d.text}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {ai.sentiment.summary && <div className={s.summaryBox}>{ai.sentiment.summary}</div>}
    </section>
  );
}

// ===== 二、资金画像 =====

function FundPicture({ ai, review }: { ai: AiAnalysisV2; review: DailyReview }) {
  const fp = ai.fund_picture;
  const ov = (review.market_overview ?? {}) as Record<string, unknown>;
  const ff = (ov.fund_flow ?? null) as Record<string, number | null> | null;
  const flow = (review.sector_fund_flow ?? null) as Record<string, unknown> | null;
  const inflow = ((flow?.inflow ?? []) as Record<string, unknown>[]).slice(0, 6);
  const outflow = ((flow?.outflow ?? []) as Record<string, unknown>[]).slice(0, 6);
  const marginData = (review.margin_data ?? null) as MarginData | null;
  const hotMoney = (review.hot_money_moves ?? []) as HotMoneyMove[];

  if (!fp && !ff && !inflow.length) return null;

  const marginLabel = marginData?.trade_date
    ? `两融杠杆（截至 ${marginData.trade_date.slice(5)}）`
    : '两融杠杆';

  const reads = [
    { key: 'dashboard', icon: '📊', label: '大盘资金', text: fp?.dashboard_conclusion },
    { key: 'migration', icon: '🔄', label: '资金迁徙', text: fp?.migration },
    { key: 'inst', icon: '🏛', label: '机构动向', text: fp?.inst_summary },
    { key: 'hot_money', icon: '🔥', label: '游资动向', text: fp?.hot_money_summary },
    { key: 'margin', icon: '⚡', label: marginLabel, text: fp?.margin_summary },
  ].filter(r => r.text);

  const flowCells = [
    { label: '主力净流入', val: ff?.main_inflow },
    { label: '超大单(机构)', val: ff?.super_large_inflow },
    { label: '大单(主力)', val: ff?.large_inflow },
    { label: '中单(大户)', val: ff?.mid_inflow },
    { label: '小单(散户)', val: ff?.retail_inflow },
  ].filter(c => c.val != null);

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>二、资金画像</h2>

      {(inflow.length > 0 || outflow.length > 0) && (
        <div className={s.duoGrid}>
          {inflow.length > 0 && (
            <div className={s.panel}>
              <div className={s.panelTitle}>🔥 板块资金流入 TOP</div>
              <SectorBars items={inflow} />
            </div>
          )}
          {outflow.length > 0 && (
            <div className={s.panel}>
              <div className={`${s.panelTitle} ${s.panelTitleGreen}`}>❄️ 板块资金流出 TOP</div>
              <SectorBars items={outflow} green />
            </div>
          )}
        </div>
      )}

      {flowCells.length > 0 && (
        <div className={s.flowRow}>
          {flowCells.map((c, i) => (
            <div key={i} className={s.flowCell}>
              <div className={s.flowLabel}>{c.label}</div>
              <div className={`${s.flowVal} ${upDownCls(c.val)}`}>{signed(c.val)}</div>
            </div>
          ))}
        </div>
      )}

      {reads.length > 0 && (
        <div className={s.duoGrid} style={{ marginTop: 12 }}>
          {reads.map(r => (
            <div key={r.key} className={s.readCard}>
              <div className={s.readLabel}>
                <span>{r.icon}</span>
                {r.label}
              </div>
              {r.key === 'margin' && marginData && <MarginRow data={marginData} />}
              <div className={s.readText}>{r.text}</div>
              {r.key === 'hot_money' && hotMoney.length > 0 && (
                <div className={s.chipRow}>
                  {hotMoney.slice(0, 12).map((m, i) => (
                    <span
                      key={i}
                      className={`${s.chip} ${m.direction === 'sell' ? s.chipSell : ''}`}
                    >
                      {m.nickname} {m.direction === 'buy' ? '买' : '卖'} {m.stock_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SectorBars({ items, green }: { items: Record<string, unknown>[]; green?: boolean }) {
  const max = Math.max(...items.map(it => Math.abs((it.net_amount as number) ?? 0)), 1);
  return (
    <>
      {items.map((it, i) => {
        const amt = (it.net_amount as number) ?? 0;
        return (
          <div key={i} className={s.barItem}>
            <span className={s.barName}>{it.sector as string}</span>
            <div className={s.barTrack}>
              <div
                className={`${s.barFill} ${green ? s.barFillGreen : ''}`}
                style={{ width: `${(Math.abs(amt) / max) * 100}%` }}
              />
            </div>
            <span className={`${s.barVal} ${green ? s.barValGreen : ''}`}>{fmt(amt, 1)}亿</span>
          </div>
        );
      })}
    </>
  );
}

function MarginRow({ data }: { data: MarginData }) {
  // 展示 5 日累计而非日变化：两融 T-1 披露，单日数字容易被误读成当日情绪
  const sum5d = data.change_5d?.length
    ? Number(data.change_5d.reduce((a, b) => a + b, 0).toFixed(2))
    : null;
  const cd = data.consecutive_days;

  return (
    <div className={s.marginRow}>
      <div className={s.marginItem}>
        <span className={s.marginLabel}>余额</span>
        <b className={s.marginVal}>{toTrillion(data.total_balance)}</b>
        {data.balance_percentile_1y != null && (
          <span className={s.marginSub}>1Y分位 {data.balance_percentile_1y}%</span>
        )}
      </div>
      <div className={s.marginItem}>
        <span className={s.marginLabel}>5日累计</span>
        <b className={`${s.marginVal} ${upDownCls(sum5d)}`}>
          {sum5d == null ? '-' : `${sum5d >= 0 ? '+' : ''}${Math.round(sum5d)}亿`}
        </b>
        {cd !== 0 && <span className={s.marginSub}>连续 {cd > 0 ? '+' : ''}{cd} 日</span>}
      </div>
    </div>
  );
}

// ===== 三、影响盘面的资讯 =====

const SEGMENTS: Array<{
  key: AiAnalysisV2ImportantNews['segment'];
  label: string;
  cls: string;
}> = [
  { key: 'pre_market', label: '盘前', cls: s.segPre },
  { key: 'intraday', label: '盘中', cls: s.segIntra },
  { key: 'post_market', label: '盘后', cls: s.segPost },
];

function NewsTimeline({ news }: { news: AiAnalysisV2ImportantNews[] }) {
  // 资讯条数多且偏长，默认折叠，避免把主线、梯队这些核心模块挤到很下面
  const [open, setOpen] = useState(false);
  if (!news.length) return null;

  const groups = SEGMENTS.map(seg => ({
    seg,
    list: news.filter(n => n.segment === seg.key),
  })).filter(g => g.list.length > 0);

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>
        三、影响盘面的资讯
        <button
          type="button"
          className={s.secToggle}
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          {open ? '▾ 收起' : `▸ 展开 ${news.length} 条`}
        </button>
      </h2>

      {!open && (
        <div className={s.newsFolded}>
          {groups.map(g => (
            <span key={g.seg.key} className={s.newsFoldedItem}>
              <span className={`${s.segBadge} ${g.seg.cls}`}>{g.seg.label}</span>
              {g.list.length} 条
            </span>
          ))}
        </div>
      )}

      {open &&
        groups.map(({ seg, list }) => (
          <div key={seg.key} className={s.newsGroup}>
            <div className={s.newsGroupHead}>
              <span className={`${s.segBadge} ${seg.cls}`}>{seg.label}</span>
              <span>{list.length} 条</span>
            </div>
            {list.map((n, i) => (
              <div key={i} className={s.newsItem}>
                <div className={s.newsTime}>{n.time}</div>
                <div className={s.newsBody}>
                  <div className={s.newsHeadline}>{n.headline}</div>
                  {n.summary && <div className={s.newsSummary}>{n.summary}</div>}
                  {n.driven?.length > 0 && (
                    <div className={s.tagRow}>
                      {n.driven.map((d, j) => (
                        <span key={j} className={`${s.tag} ${s.tagBlue}`}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {(n.level === 'A' || n.level === 'B') && (
                  <span
                    className={`${s.levelFlag} ${n.level === 'A' ? s.levelA : s.levelB}`}
                  >
                    {n.level}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}

// ===== 四、主线分析 =====

function MainThemes({ themes }: { themes: AiAnalysisV2MainTheme[] }) {
  if (!themes.length) return null;
  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>四、主线分析</h2>
      {themes.map((t, i) => (
        <ThemeCard key={i} theme={t} />
      ))}
    </section>
  );
}

function ThemeCard({ theme }: { theme: AiAnalysisV2MainTheme }) {
  const strong = theme.strength?.includes('强');
  const weak = theme.strength?.includes('弱');
  const strengthPct = strong ? 100 : weak ? 34 : 67;
  const strengthColor = strong ? '#ff5252' : weak ? '#7fd4ff' : '#ffd166';
  const strengthTagCls = strong ? s.tag : weak ? `${s.tag} ${s.tagBlue}` : `${s.tag} ${s.tagGold}`;

  const label = theme.next_day_signals?.label ?? '';
  const nextCls = label.includes('延续')
    ? s.nextContinue
    : label.includes('分歧')
    ? s.nextDiverge
    : label.includes('退潮')
    ? s.nextExit
    : s.nextUnknown;

  const rows = [
    { label: '龙头梯队', text: theme.leader_ladder },
    { label: '核心催化', text: theme.catalyst },
    { label: '今日表现', text: theme.today_performance },
  ].filter(r => r.text);

  return (
    <div className={s.themeCard}>
      <div className={s.themeHead}>
        <span className={s.themeName}>{theme.name}</span>
        <div className={s.strengthTrack}>
          <div
            className={s.strengthFill}
            style={{ width: `${strengthPct}%`, background: strengthColor }}
          />
        </div>
        {theme.strength && <span className={strengthTagCls}>{theme.strength}</span>}
        {theme.stage && <span className={`${s.tag} ${s.tagGray}`}>{theme.stage}</span>}
        {theme.days != null && <span className={`${s.tag} ${s.tagGray}`}>D{theme.days}</span>}
      </div>

      {rows.map((r, i) => (
        <div key={i} className={s.themeRow}>
          <span className={s.themeRowLabel}>{r.label}：</span>
          {r.text}
        </div>
      ))}

      {theme.divergence_signals?.length > 0 && (
        <div className={s.divergeBox}>
          <div className={s.divergeTitle}>⚠ 分歧信号</div>
          <ul className={s.bullets}>
            {theme.divergence_signals.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {label && (
        <div className={`${s.nextBox} ${nextCls}`}>
          <div className={s.nextLabel}>→ 明日预判：{label}</div>
          {theme.next_day_signals.evidence?.length > 0 && (
            <ul className={s.bullets}>
              {theme.next_day_signals.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {theme.next_day_signals.suggestion && (
            <div className={s.nextSuggestion}>{theme.next_day_signals.suggestion}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 五、涨停梯队全景 =====

function LadderPanorama({
  ai,
  review,
  limitUpReasons,
}: {
  ai: AiAnalysisV2;
  review: DailyReview;
  limitUpReasons?: LimitUpReasons | null;
}) {
  const [showFirst, setShowFirst] = useState(false);
  const ladder = (review.limit_up_ladder ?? []) as Record<string, unknown>[];
  const lv = ai.ladder_view;

  const cells = [
    { label: '高度', val: lv?.height },
    { label: '晋级率', val: lv?.promotion },
    { label: '断板', val: lv?.broken },
    { label: '新晋级', val: lv?.new_promotions },
  ].filter(c => c.val);

  if (!ladder.length && !cells.length) return null;

  // code → 涨停关键词 / 所属题材
  const keywordMap = new Map<string, string>();
  const themeMap = new Map<string, string>();
  for (const t of limitUpReasons?.themes ?? []) {
    for (const st of t.stocks ?? []) {
      if (!st.code) continue;
      if (st.keyword) keywordMap.set(st.code, st.keyword);
      if (t.name) themeMap.set(st.code, t.name);
    }
  }

  const groups = new Map<number, Record<string, unknown>[]>();
  for (const it of ladder) {
    const n = (it.continuous_limit as number) ?? 1;
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n)!.push(it);
  }
  const levels = [...groups.keys()].sort((a, b) => b - a);
  const firstBoard = groups.get(1) ?? [];

  const heightCls = (n: number) => {
    if (n >= 6) return `${s.ladderHeight} ${s.ladderHeightSuper}`;
    if (n >= 4) return s.ladderHeight;
    return `${s.ladderHeight} ${s.ladderHeightLow}`;
  };

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>五、涨停梯队全景</h2>

      {cells.length > 0 && (
        <div className={s.gaugeGrid} style={{ marginBottom: 14 }}>
          {cells.map((c, i) => (
            <div key={i} className={s.gaugeCard}>
              <div className={s.gaugeLabel}>{c.label}</div>
              <div className={s.readText} style={{ marginTop: 4 }}>
                {c.val}
              </div>
            </div>
          ))}
        </div>
      )}

      {levels
        .filter(n => n > 1)
        .map(n => (
          <div key={n} className={s.ladderRow}>
            <div className={heightCls(n)}>
              <div className={s.ladderNum}>{n}</div>
              <div className={s.ladderTxt}>连板</div>
              <div className={s.ladderCount}>{groups.get(n)!.length} 只</div>
            </div>
            <div className={s.stockCards}>
              {groups.get(n)!.map((it, i) => (
                <StockCard key={i} item={it} keywordMap={keywordMap} themeMap={themeMap} />
              ))}
            </div>
          </div>
        ))}

      {firstBoard.length > 0 && (
        <div className={s.ladderRow}>
          <div className={`${s.ladderHeight} ${s.ladderHeightLow}`}>
            <div className={s.ladderNum}>1</div>
            <div className={s.ladderTxt}>首板</div>
            <div className={s.ladderCount}>{firstBoard.length} 只</div>
          </div>
          <div className={s.stockCards} style={{ flexDirection: 'column' }}>
            <button type="button" className={s.ladderToggle} onClick={() => setShowFirst(v => !v)}>
              <span className={s.gold}>{showFirst ? '▾' : '▸'}</span>
              <span className={s.stockName} style={{ fontSize: 13 }}>
                首板 {firstBoard.length} 只
              </span>
              <span className={s.ladderToggleHint}>{showFirst ? '点击收起' : '点击展开'}</span>
            </button>
            {showFirst && (
              <div className={s.stockCards}>
                {firstBoard.map((it, i) => (
                  <StockCard key={i} item={it} keywordMap={keywordMap} themeMap={themeMap} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StockCard({
  item,
  keywordMap,
  themeMap,
}: {
  item: Record<string, unknown>;
  keywordMap: Map<string, string>;
  themeMap: Map<string, string>;
}) {
  const code = String(item.code ?? '');
  const keyword = keywordMap.get(code);
  const themeName = themeMap.get(code);

  return (
    <div className={s.stockCard}>
      <div className={s.stockName}>
        <span>{item.name as string}</span>
        <span className={s.stockCode}>{code}</span>
        {themeName && <span className={`${s.tag} ${s.tagGold}`}>{themeName}</span>}
      </div>
      {keyword && <div className={s.stockReason}>{keyword}</div>}
    </div>
  );
}

// ===== 六、明日作战计划（含风险提示） =====

/**
 * 纯展示层拆分：把作战计划整句拆成卡片标题（标的）与正文（理由），不改动数据源。
 * 依次尝试三种 AI 实际产出的写法，都不匹配时整句作正文。
 */
function splitTitle(text: string): { title: string | null; body: string } {
  const src = text.trim();
  // 1. 名称（600276）—理由 / 名称(600276)：理由
  const withCode = src.match(/^([\s\S]{2,12}?[（(]\s*\d{6}\s*[)）])\s*[—–\-:：]*\s*([\s\S]+)$/);
  if (withCode) return { title: withCode[1], body: withCode[2] };
  // 2. 名称（理由全在括号里）
  const wrapped = src.match(/^([\s\S]{2,14}?)[（(]([\s\S]{4,})[)）]\s*$/);
  if (wrapped) return { title: wrapped[1], body: wrapped[2] };
  // 3. 名称 + 分隔符 + 理由
  const sep = src.match(/^([\s\S]{2,14}?)\s*[：:—–]{1,2}\s*([\s\S]+)$/);
  if (sep) return { title: sep[1], body: sep[2] };
  return { title: null, body: src };
}

function BattlePlan({ ai }: { ai: AiAnalysisV2 }) {
  const bp = ai.battle_plan;
  if (!bp) return null;

  const focus = bp.focus_stocks ?? [];
  const avoid = bp.avoid_list ?? [];
  const observations = bp.key_observations ?? [];
  const alerts = ai.risk_alerts ?? [];

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>六、明日作战计划</h2>

      {(bp.position_level || bp.mode) && (
        <div className={s.gaugeGrid} style={{ marginBottom: 14 }}>
          {bp.position_level && (
            <div className={s.gaugeCard}>
              <div className={s.gaugeLabel}>建议仓位</div>
              <div className={`${s.gaugeValue} ${s.gold}`}>{bp.position_level}</div>
            </div>
          )}
          {bp.mode && (
            <div className={s.gaugeCard}>
              <div className={s.gaugeLabel}>操作模式</div>
              <div className={`${s.gaugeValue} ${s.blue}`}>{bp.mode}</div>
            </div>
          )}
        </div>
      )}

      {focus.length > 0 && (
        <>
          <div className={s.subTitle}>🎯 重点关注</div>
          <div className={s.planGrid}>
            {focus.map((item, i) => {
              const { title, body } = splitTitle(item);
              return (
                <div key={i} className={`${s.planCard} ${s.planCardFocus}`}>
                  <div className={s.planHead}>
                    <div className={s.planName}>{title ?? `关注 ${i + 1}`}</div>
                    <span className={`${s.tag} ${s.tagGold}`}>关注</span>
                  </div>
                  <div className={s.planText}>{body}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {avoid.length > 0 && (
        <>
          <div className={s.subTitle}>🚫 规避清单</div>
          <div className={s.planGrid}>
            {avoid.map((item, i) => {
              const { title, body } = splitTitle(item);
              return (
                <div key={i} className={`${s.planCard} ${s.planCardAvoid}`}>
                  <div className={s.planHead}>
                    <div className={s.planName}>{title ?? `规避 ${i + 1}`}</div>
                    <span className={s.tag}>规避</span>
                  </div>
                  <div className={s.planText}>{body}</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {(observations.length > 0 || alerts.length > 0) && (
        <div className={s.observeBox}>
          {observations.length > 0 && (
            <>
              <div className={s.observeTitle}>👁 关键观察点</div>
              {observations.map((o, i) => (
                <div key={i} className={s.observeItem}>
                  {o}
                </div>
              ))}
            </>
          )}
          {alerts.length > 0 && (
            <div className={observations.length > 0 ? s.riskGroupDivided : undefined}>
              <div className={`${s.observeTitle} ${s.riskGroupTitle}`}>⚠ 风险提示</div>
              {alerts.map((r, i) => (
                <div key={i} className={s.riskItem}>
                  <span className={s.riskType}>· {r.type}</span>
                  {r.content}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ===== 七、昨日验证 =====

function YesterdayVerify({ ai }: { ai: AiAnalysisV2 }) {
  const yv = ai.yesterday_verify;
  if (!yv) return null;
  const hit = yv.hit_items ?? [];
  const miss = yv.miss_items ?? [];
  if (!yv.summary && !hit.length && !miss.length) return null;

  return (
    <section className={s.section}>
      <h2 className={s.secTitle}>七、昨日验证</h2>
      {yv.summary && <div className={s.verifySummary}>{yv.summary}</div>}
      {(hit.length > 0 || miss.length > 0) && (
        <div className={s.duoGrid}>
          {hit.length > 0 && (
            <div className={`${s.verifyCard} ${s.verifyHit}`}>
              <div className={`${s.verifyTitle} ${s.green}`}>✓ 已兑现 {hit.length} 项</div>
              <ul className={s.verifyList}>
                {hit.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}
          {miss.length > 0 && (
            <div className={`${s.verifyCard} ${s.verifyMiss}`}>
              <div className={`${s.verifyTitle} ${s.red}`}>✗ 未兑现 {miss.length} 项</div>
              <ul className={s.verifyList}>
                {miss.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
