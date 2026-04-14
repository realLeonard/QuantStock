'use client';

/**
 * 每日复盘 v2 全览面板
 *
 * 结构（自上而下）：
 *   1. HeadlineSection      — 标题 + 情绪温度计
 *   2. SentimentOverview    — 情绪四维度（宽度/高度/赚钱效应/风格）
 *   3. FundPicturePanel     — 资金画像（大盘/迁徙/机构/游资）
 *   4. ImportantNewsPanel   — 影响盘面的资讯（盘前/盘中/盘后分段）
 *   5. MainThemesV2Panel    — 主线分析 v2（含演绎天数 + 龙头梯队 + 次日预判）
 *   6. LadderViewPanel      — 连板梯队
 *   7. RiskAlertsPanel      — 风险提示
 *   8. BattlePlanPanel      — 明日作战计划
 *   9. YesterdayVerifyPanel — 昨日验证
 */

import { useState } from 'react';
import type {
  AiAnalysisV2,
  AiAnalysisV2MainTheme,
  AiAnalysisV2ImportantNews,
  DailyReview,
  HotMoneyMove,
  LimitUpReasons,
  MarginData,
} from '@quantstock/types';
import base from './DailyReviewView.module.css';
import s from './FullReportV2.module.css';
import { InfoTip } from './DailyReviewView';

const TIPS: Record<string, string> = {
  炸板率: '炸板率 = 炸板数 ÷（炸板数 + 封板数）× 100%\n\n反映打板情绪的"成功率"：\n• < 20%：封板扎实，打板情绪好\n• 20-40%：中性，需看最高板能否带动\n• > 40%：情绪差，资金接力意愿弱\n\n用途：盘中盘后判断高标梯队能否延续、是否适合打板。',
  溢价率: '打板溢价率 = 次日高标接力股平均开盘涨幅 ÷ 10%（或 20%）× 100%\n\n衡量"昨日涨停板在今日开盘时被市场愿意溢价接的幅度"：\n• > 80%：资金情绪高涨，接力意愿强\n• 50-80%：中性\n• < 50%：溢价低迷，打板性价比差\n\n用途：判断打板赚钱效应，是否适合日内连板战法。',
  晋级率: '首板晋级率 = 昨日首板股中今日晋级 2 板的家数 ÷ 昨日首板总数 × 100%\n\n衡量"涨停梯队能否向上延续"：\n• > 30%：赚钱效应强，可积极打首板\n• 15-30%：中性\n• < 15%：首板难以晋级，避免接力\n\n用途：次日开盘前评估低位首板的胜率。',
  封单: '封单总额 = 当日所有涨停股的封单金额合计\n\n衡量"打板资金的总体规模"：\n• 值大 → 涨停票多或单票封单厚，情绪热\n• 值小 → 涨停票少或封单薄，市场缩量\n\n用途：与涨停数量联动观察打板资金活跃度。',
  风格: '市场风格 = 当日盘中"权重股 vs 题材股"的表现对比，常见取值：\n• 大盘股强：权重红、题材弱 → 防御资金在场\n• 题材股强：题材红、权重弱 → 活跃资金在场\n• 均衡/震荡：两端差异不大\n\n来源：大盘分时黄白线（白=指数/权重，黄=全部股票平均）对比\n\n用途：判断当日适合做的风格方向。',
  主力: '主力 = 大盘当日「主力净流入」=（超大单 + 大单）买入 − 卖出，单位：亿元\n\n正值 = 大资金整体净买，负值 = 大资金整体净卖。\n\n注意：这是"按单笔成交金额"分类的口径（东方财富），与 Wind 的"机构"口径不同。\n\n用途：快速看大资金情绪；配合成交额趋势、连板高度综合研判。',
};

interface Props {
  ai: AiAnalysisV2;
  review: DailyReview;
  limitUpReasons?: LimitUpReasons | null;
}

export default function FullReportV2({ ai, review, limitUpReasons }: Props) {
  const hotMoneyMoves = (review.hot_money_moves ?? []) as HotMoneyMove[];

  return (
    <div className={s.v2Root}>
      <HeadlineSection ai={ai} review={review} />
      <SentimentOverview ai={ai} />
      <FundPicturePanel
        ai={ai}
        hotMoneyMoves={hotMoneyMoves}
        marginData={(review.margin_data ?? null) as MarginData | null}
      />
      <ImportantNewsPanel news={ai.important_news ?? []} />
      <MainThemesV2Panel themes={ai.main_themes ?? []} />
      <LadderViewPanel ai={ai} />
      <LadderDetailPanel
        ladder={(review.limit_up_ladder ?? []) as Record<string, unknown>[]}
        limitUpReasons={limitUpReasons}
      />
      <RiskAlertsPanel alerts={ai.risk_alerts ?? []} />
      <BattlePlanPanel ai={ai} />
      <YesterdayVerifyPanel ai={ai} />
    </div>
  );
}

// ========== 1. 头部 ==========

function HeadlineSection({ ai, review }: { ai: AiAnalysisV2; review: DailyReview }) {
  const score = Math.max(0, Math.min(10, ai.sentiment.score));
  const scoreColor =
    score <= 3 ? '#16a34a' : score <= 5 ? '#f59e0b' : score <= 7 ? '#ea580c' : '#dc2626';

  const stageClsMap: Record<string, string> = {
    冰点: base.stageCold,
    修复: base.stageRecover,
    升温: base.stageWarm,
    分歧: base.stageWarm,
    高潮: base.stageHot,
    退潮: base.stageCool,
  };
  const stageCls = stageClsMap[ai.sentiment.stage] ?? base.stageWarm;

  const sentiment = review.market_sentiment as Record<string, number> | null;
  const la = review.limit_analysis as Record<string, unknown> | null;
  const ps = (la?.premium_summary ?? null) as Record<string, number> | null;
  const pm = (la?.promotion ?? null) as Record<string, unknown> | null;
  const ss = (la?.seal_stats ?? null) as Record<string, number> | null;
  const ov = review.market_overview as Record<string, unknown> | null;
  const yw = (ov?.yellow_white ?? null) as Record<string, number | string> | null;
  const ff = (ov?.fund_flow ?? null) as Record<string, number> | null;

  const UP = '#dc2626';
  const DOWN = '#16a34a';
  const metrics: Array<{ label: string; val: string; color?: string }> = [];
  if (sentiment) {
    metrics.push({ label: '涨停', val: `${sentiment.limit_up ?? '-'} 家`, color: UP });
    metrics.push({ label: '跌停', val: `${sentiment.limit_down ?? '-'} 家`, color: DOWN });
  }
  if (ff?.main_inflow != null) {
    metrics.push({
      label: '主力',
      val: `${ff.main_inflow}亿`,
      color: ff.main_inflow >= 0 ? UP : DOWN,
    });
  }
  if (sentiment?.broken_rate != null) {
    metrics.push({ label: '炸板率', val: `${sentiment.broken_rate}%` });
  }
  if (ps?.premium_rate != null) metrics.push({ label: '溢价率', val: `${ps.premium_rate}%` });
  if (pm?.rate != null) metrics.push({ label: '晋级率', val: `${pm.rate}%` });
  if (ss?.total_seal_fund != null) metrics.push({ label: '封单', val: `${ss.total_seal_fund}亿` });
  if (yw?.style_bias) metrics.push({ label: '风格', val: String(yw.style_bias) });

  return (
    <div className={base.aiHeader}>
      <h1 className={base.aiHeadline}>{ai.headline}</h1>

      <div className={base.aiSentimentRow}>
        <span className={base.sentimentLabel}>情绪温度</span>
        <div className={base.sentimentBarWrap}>
          <div
            className={base.sentimentBar}
            style={{ width: `${score * 10}%`, background: scoreColor }}
          />
        </div>
        <span className={base.sentimentScore} style={{ color: scoreColor }}>
          {score}/10
        </span>
        <span className={`${base.sentimentStage} ${stageCls}`}>{ai.sentiment.stage}</span>
      </div>

      {metrics.length > 0 && (
        <div className={base.aiMetrics}>
          {metrics.map((m, i) => (
            <div key={i} className={base.aiMetricCard}>
              <div className={base.aiMetricLabel}>
                {m.label}
                {TIPS[m.label] && <InfoTip text={TIPS[m.label]} />}
              </div>
              <div className={base.aiMetricVal} style={m.color ? { color: m.color } : undefined}>{m.val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== 2. 情绪四维度 ==========

function SentimentOverview({ ai }: { ai: AiAnalysisV2 }) {
  const dims = [
    { label: '宽度', content: ai.sentiment.width_conclusion },
    { label: '高度', content: ai.sentiment.ladder_conclusion },
    { label: '赚钱效应', content: ai.sentiment.profit_conclusion },
    { label: '风格', content: ai.sentiment.style_conclusion },
  ].filter(d => d.content);

  if (!dims.length && !ai.sentiment.summary) return null;

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>情绪结构</h2>
      {dims.length > 0 && (
        <div className={s.sentimentGrid}>
          {dims.map((d, i) => (
            <div key={i} className={s.sentimentCard}>
              <div className={s.sentimentCardLabel}>{d.label}</div>
              <div className={s.sentimentCardContent}>{d.content}</div>
            </div>
          ))}
        </div>
      )}
      {ai.sentiment.summary && <div className={s.sentimentSummary}>{ai.sentiment.summary}</div>}
    </div>
  );
}

// ========== 3. 资金画像 ==========

function FundPicturePanel({
  ai,
  hotMoneyMoves,
  marginData,
}: {
  ai: AiAnalysisV2;
  hotMoneyMoves: HotMoneyMove[];
  marginData: MarginData | null;
}) {
  const fp = ai.fund_picture;
  if (!fp) return null;

  const items = [
    { label: '大盘资金', icon: '📊', content: fp.dashboard_conclusion },
    { label: '资金迁徙', icon: '🔄', content: fp.migration },
    { label: '机构动向', icon: '🏛', content: fp.inst_summary },
    { label: '游资动向', icon: '🔥', content: fp.hot_money_summary },
    { label: '两融杠杆', icon: '⚡', content: fp.margin_summary ?? '' },
  ].filter(x => x.content);

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>资金画像</h2>
      <div className={s.fundGrid}>
        {items.map((it, i) => (
          <div key={i} className={s.fundCard}>
            <div className={s.fundCardLabel}>
              <span className={s.fundCardIcon}>{it.icon}</span>
              {it.label}
            </div>
            <div className={s.fundCardContent}>
              {it.label === '两融杠杆' && marginData && <MarginMetricsRow data={marginData} />}
              {it.content}
              {it.label === '游资动向' && hotMoneyMoves.length > 0 && (
                <div className={s.hotMoneyList}>
                  {hotMoneyMoves.slice(0, 12).map((m, idx) => (
                    <span
                      key={idx}
                      className={`${s.hotMoneyChip} ${
                        m.direction === 'buy' ? s.hotMoneyBuy : s.hotMoneySell
                      }`}
                    >
                      {m.nickname} {m.direction === 'buy' ? '买' : '卖'} {m.stock_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarginMetricsRow({ data }: { data: MarginData }) {
  const UP = '#dc2626';
  const DOWN = '#16a34a';
  const fmtBal = (yi: number | null) => {
    if (yi == null) return '-';
    if (yi >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
    return `${Math.round(yi)}亿`;
  };
  const dc = data.daily_change;
  const cd = data.consecutive_days;
  const dcColor = dc == null ? undefined : dc >= 0 ? UP : DOWN;
  const cdStr = cd && cd !== 0 ? `连续 ${cd > 0 ? '+' : ''}${cd} 日` : '';

  return (
    <div className={s.marginMetrics}>
      <div className={s.marginMetricItem}>
        <span className={s.marginMetricLabel}>余额</span>
        <b className={s.marginMetricVal}>{fmtBal(data.total_balance)}</b>
        {data.balance_percentile_1y != null && (
          <span className={s.marginMetricSub}>1Y分位 {data.balance_percentile_1y}%</span>
        )}
      </div>
      <div className={s.marginMetricItem}>
        <span className={s.marginMetricLabel}>日变化</span>
        <b className={s.marginMetricVal} style={dcColor ? { color: dcColor } : undefined}>
          {dc == null ? '-' : `${dc >= 0 ? '+' : ''}${dc}亿`}
        </b>
        {cdStr && <span className={s.marginMetricSub}>{cdStr}</span>}
      </div>
    </div>
  );
}

// ========== 4. 重要资讯（盘前/盘中/盘后） ==========

const SEGMENT_LABELS: Record<string, { label: string; cls: string }> = {
  pre_market: { label: '盘前', cls: '' },
  intraday: { label: '盘中', cls: '' },
  post_market: { label: '盘后', cls: '' },
};

function ImportantNewsPanel({ news }: { news: AiAnalysisV2ImportantNews[] }) {
  if (!news?.length) return null;

  const grouped: Record<string, AiAnalysisV2ImportantNews[]> = {
    pre_market: [],
    intraday: [],
    post_market: [],
  };
  for (const n of news) {
    (grouped[n.segment] ??= []).push(n);
  }

  const order: Array<'pre_market' | 'intraday' | 'post_market'> = [
    'pre_market',
    'intraday',
    'post_market',
  ];
  const segCls: Record<string, string> = {
    pre_market: s.segmentPre,
    intraday: s.segmentIntra,
    post_market: s.segmentPost,
  };

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>影响盘面的资讯</h2>
      {order.map(seg =>
        grouped[seg]?.length ? (
          <div key={seg} className={s.newsGroup}>
            <h3 className={s.newsGroupTitle}>
              <span className={`${s.newsSegmentBadge} ${segCls[seg]}`}>
                {SEGMENT_LABELS[seg].label}
              </span>
              <span>{grouped[seg].length} 条</span>
            </h3>
            {grouped[seg].map((n, i) => (
              <div key={i} className={s.newsItem}>
                <div className={s.newsTime}>{n.time}</div>
                <div className={s.newsBody}>
                  <div className={s.newsHeadline}>{n.headline}</div>
                  {n.summary && <div className={s.newsSummary}>{n.summary}</div>}
                  {n.driven?.length > 0 && (
                    <div className={s.newsDrivenTags}>
                      {n.driven.map((d, j) => (
                        <span key={j} className={s.newsDrivenTag}>
                          {d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {n.level === 'A' ? (
                  <span className={s.newsLevelA}>A</span>
                ) : n.level === 'B' ? (
                  <span className={s.newsLevelB}>B</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null,
      )}
    </div>
  );
}

// ========== 5. 主线 v2 ==========

function MainThemesV2Panel({ themes }: { themes: AiAnalysisV2MainTheme[] }) {
  if (!themes?.length) return null;
  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>主线分析</h2>
      {themes.map((t, i) => (
        <ThemeV2Card key={i} theme={t} />
      ))}
    </div>
  );
}

function ThemeV2Card({ theme }: { theme: AiAnalysisV2MainTheme }) {
  const strengthCls =
    theme.strength === '强'
      ? s.themeV2StrengthStrong
      : theme.strength === '中'
      ? s.themeV2StrengthMid
      : s.themeV2StrengthWeak;
  const strengthTagCls =
    theme.strength === '强'
      ? s.themeV2TagStrong
      : theme.strength === '中'
      ? s.themeV2TagMid
      : s.themeV2TagWeak;

  const label = theme.next_day_signals?.label ?? '';
  const nextDayCls = label.includes('延续')
    ? s.nextDayContinue
    : label.includes('分歧')
    ? s.nextDayDiverge
    : label.includes('退潮')
    ? s.nextDayExit
    : s.nextDayUnknown;

  return (
    <div className={`${s.themeV2Card} ${strengthCls}`}>
      <div className={s.themeV2Head}>
        <span className={s.themeV2Name}>{theme.name}</span>
        <span className={`${s.themeV2Tag} ${strengthTagCls}`}>{theme.strength}</span>
        {theme.stage && <span className={s.themeV2Tag}>{theme.stage}</span>}
        {theme.days != null && <span className={s.themeV2Tag}>D{theme.days}</span>}
      </div>

      {theme.leader_ladder && (
        <div className={s.themeV2Row}>
          <span className={s.themeV2RowLabel}>龙头梯队：</span>
          {theme.leader_ladder}
        </div>
      )}
      {theme.catalyst && (
        <div className={s.themeV2Row}>
          <span className={s.themeV2RowLabel}>核心催化：</span>
          {theme.catalyst}
        </div>
      )}
      {theme.today_performance && (
        <div className={s.themeV2Row}>
          <span className={s.themeV2RowLabel}>今日表现：</span>
          {theme.today_performance}
        </div>
      )}

      {theme.divergence_signals?.length > 0 && (
        <div className={s.themeV2Divergence}>
          <div className={s.themeV2DivergenceTitle}>⚠ 分歧信号</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {theme.divergence_signals.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {theme.next_day_signals?.label && (
        <div className={`${s.themeV2NextDay} ${nextDayCls}`}>
          <div className={s.themeV2NextLabel}>→ 明日预判：{theme.next_day_signals.label}</div>
          {theme.next_day_signals.evidence?.length > 0 && (
            <ul className={s.themeV2Evidence}>
              {theme.next_day_signals.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {theme.next_day_signals.suggestion && (
            <div className={s.themeV2Suggestion}>{theme.next_day_signals.suggestion}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ========== 6.5 连板天梯明细（含首板 + 涨停原因）==========

function LadderDetailPanel({
  ladder,
  limitUpReasons,
}: {
  ladder: Record<string, unknown>[];
  limitUpReasons?: LimitUpReasons | null;
}) {
  const [showFirstBoard, setShowFirstBoard] = useState(false);
  if (!ladder?.length) return null;

  // code → keyword 映射
  const keywordMap = new Map<string, string>();
  if (limitUpReasons?.themes) {
    for (const theme of limitUpReasons.themes) {
      for (const st of theme.stocks ?? []) {
        if (st.code && st.keyword) keywordMap.set(st.code, st.keyword);
      }
    }
  }

  // 按连板数分组
  const groups = new Map<number, Record<string, unknown>[]>();
  for (const item of ladder) {
    const lv = (item.continuous_limit as number) ?? 1;
    if (!groups.has(lv)) groups.set(lv, []);
    groups.get(lv)!.push(item);
  }
  const levels = [...groups.keys()].sort((a, b) => b - a);

  const levelLabel = (n: number) => {
    if (n === 1) return '首板';
    const map: Record<number, string> = {
      2: '二',
      3: '三',
      4: '四',
      5: '五',
      6: '六',
      7: '七',
      8: '八',
      9: '九',
      10: '十',
    };
    return `${map[n] ?? n}板`;
  };
  const levelColor = (n: number) => {
    if (n >= 5) return '#dc2626';
    if (n >= 3) return '#f59e0b';
    if (n >= 2) return '#3b82f6';
    return '#64748b';
  };

  const firstBoardItems = groups.get(1) ?? [];
  const nonFirstLevels = levels.filter(l => l > 1);
  const firstBoardWithKeyword = firstBoardItems.filter(it =>
    keywordMap.get(String(it.code ?? '')),
  );

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>连板天梯明细</h2>

      {/* 汇总条 */}
      <div className={s.ladderSummary}>
        <span className={s.ladderSummaryTotal}>合计 {ladder.length}</span>
        {levels.map(lv => (
          <span key={lv} style={{ color: levelColor(lv) }}>
            · {levelLabel(lv)} {groups.get(lv)!.length}
          </span>
        ))}
      </div>

      {/* 2 板及以上 全部展开 */}
      {nonFirstLevels.map(lv => (
        <LadderLevelBlock
          key={lv}
          level={lv}
          items={groups.get(lv)!}
          label={levelLabel(lv)}
          color={levelColor(lv)}
          keywordMap={keywordMap}
        />
      ))}

      {/* 首板：默认整块收起，点击标题行展开 */}
      {firstBoardItems.length > 0 && (
        <div
          className={s.ladderBlock}
          style={{ borderLeftColor: levelColor(1) }}
        >
          <button
            type="button"
            className={s.ladderCollapseHead}
            onClick={() => setShowFirstBoard(v => !v)}
          >
            <span className={s.ladderCollapseArrow}>{showFirstBoard ? '▾' : '▸'}</span>
            <span
              className={s.ladderBlockLabel}
              style={{ color: levelColor(1) }}
            >
              首板
            </span>
            <span className={s.ladderBlockCount}>
              {firstBoardItems.length} 只
              {firstBoardWithKeyword.length > 0 &&
                `（其中有股票 ${firstBoardWithKeyword.length} 只）`}
            </span>
            <span className={s.ladderCollapseHint}>
              {showFirstBoard ? '点击收起' : '点击展开'}
            </span>
          </button>
          {showFirstBoard && (
            <div className={s.ladderStockGrid} style={{ marginTop: 8 }}>
              {firstBoardItems.map((it, i) => {
                const code = String(it.code ?? '');
                const keyword = keywordMap.get(code) ?? '';
                return (
                  <div key={`1-${i}`} className={s.ladderStockItem}>
                    <div className={s.ladderStockName}>{it.name as string}</div>
                    <div className={s.ladderStockCode}>{code}</div>
                    {keyword && (
                      <div className={s.ladderStockKeyword}>{keyword}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LadderLevelBlock({
  level,
  items,
  label,
  color,
  keywordMap,
  footer,
}: {
  level: number;
  items: Record<string, unknown>[];
  label: string;
  color: string;
  keywordMap: Map<string, string>;
  footer?: React.ReactNode;
}) {
  return (
    <div className={s.ladderBlock} style={{ borderLeftColor: color }}>
      <div className={s.ladderBlockHead}>
        <span className={s.ladderBlockLabel} style={{ color }}>
          {label}
        </span>
        <span className={s.ladderBlockCount}>{items.length} 只</span>
      </div>
      <div className={s.ladderStockGrid}>
        {items.map((it, i) => {
          const code = String(it.code ?? '');
          const keyword = keywordMap.get(code) ?? '';
          return (
            <div key={`${level}-${i}`} className={s.ladderStockItem}>
              <div className={s.ladderStockName}>{it.name as string}</div>
              <div className={s.ladderStockCode}>{code}</div>
              {keyword && <div className={s.ladderStockKeyword}>{keyword}</div>}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

// ========== 6. 连板梯队 ==========

function LadderViewPanel({ ai }: { ai: AiAnalysisV2 }) {
  const lv = ai.ladder_view;
  if (!lv) return null;
  const cells = [
    { label: '高度', val: lv.height },
    { label: '晋级率', val: lv.promotion },
    { label: '断板', val: lv.broken },
    { label: '新晋级', val: lv.new_promotions },
  ].filter(c => c.val);
  if (!cells.length) return null;

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>连板梯队</h2>
      <div className={s.ladderGrid}>
        {cells.map((c, i) => (
          <div key={i} className={s.ladderCell}>
            <div className={s.ladderCellLabel}>{c.label}</div>
            <div className={s.ladderCellVal}>{c.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== 7. 风险提示 ==========

function RiskAlertsPanel({ alerts }: { alerts: AiAnalysisV2['risk_alerts'] }) {
  if (!alerts?.length) return null;
  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>风险提示</h2>
      <div className={s.riskList}>
        {alerts.map((r, i) => (
          <div key={i} className={s.riskItem}>
            <span className={s.riskType}>{r.type}:</span>
            {r.content}
          </div>
        ))}
      </div>
    </div>
  );
}

// ========== 8. 作战计划 ==========

function BattlePlanPanel({ ai }: { ai: AiAnalysisV2 }) {
  const bp = ai.battle_plan;
  if (!bp) return null;

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>明日作战计划</h2>
      <div className={s.battleHead}>
        {bp.position_level && (
          <div className={s.battleMeta}>
            <span className={s.battleMetaLabel}>仓位：</span>
            <span className={s.battleMetaVal}>{bp.position_level}</span>
          </div>
        )}
        {bp.mode && (
          <div className={s.battleMeta}>
            <span className={s.battleMetaLabel}>模式：</span>
            <span className={s.battleMetaVal}>{bp.mode}</span>
          </div>
        )}
      </div>

      <div className={s.battleList}>
        {bp.focus_stocks?.length > 0 && (
          <div className={s.battleListCard}>
            <div className={s.battleListLabel}>🎯 重点关注</div>
            <ul className={s.battleListItems}>
              {bp.focus_stocks.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        )}
        {bp.avoid_list?.length > 0 && (
          <div className={s.battleListCard}>
            <div className={s.battleListLabel}>🚫 规避清单</div>
            <ul className={s.battleListItems}>
              {bp.avoid_list.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {bp.key_observations?.length > 0 && (
        <div className={s.battleListCard} style={{ marginTop: 12 }}>
          <div className={s.battleListLabel}>👁 关键观察点</div>
          <ul className={s.battleListItems}>
            {bp.key_observations.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ========== 9. 昨日验证 ==========

function YesterdayVerifyPanel({ ai }: { ai: AiAnalysisV2 }) {
  const yv = ai.yesterday_verify;
  if (!yv) return null;
  const hasItems = (yv.hit_items?.length ?? 0) + (yv.miss_items?.length ?? 0) > 0;
  if (!yv.summary && !hasItems) return null;

  return (
    <div className={base.aiSection}>
      <h2 className={base.aiSectionTitle}>昨日验证</h2>
      {yv.summary && <div className={s.verifyHead}>{yv.summary}</div>}
      {hasItems && (
        <div className={s.verifyGrid}>
          {yv.hit_items?.length > 0 && (
            <div className={`${s.verifyCard} ${s.verifyHit}`}>
              <div className={s.verifyCardTitle}>✓ 已兑现</div>
              <ul className={s.verifyItems}>
                {yv.hit_items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}
          {yv.miss_items?.length > 0 && (
            <div className={`${s.verifyCard} ${s.verifyMiss}`}>
              <div className={s.verifyCardTitle}>✗ 未兑现</div>
              <ul className={s.verifyItems}>
                {yv.miss_items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
