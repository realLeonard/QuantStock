'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/store';
import { apiClient } from '@/lib/supabase';
import PageHeader from '@/components/ui/PageHeader';
import DetailBackBar from '@/components/ui/DetailBackBar';
import type { DailyReview, AiAnalysis, AiAnalysisV2, LimitUpReasons } from '@quantstock/types';
import s from './DailyReviewView.module.css';
import FullReportV2 from './FullReportV2';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  success: { label: '完整', cls: s.statusSuccess },
  partial: { label: '部分', cls: s.statusPartial },
  failed: { label: '失败', cls: s.statusFailed },
};

const TABS = [
  { key: 'full', label: '全览' },
  { key: 'overview', label: '大盘总览' },
  { key: 'limitUp', label: '涨停简图' },
  { key: 'ladder', label: '连板天梯' },
  { key: 'thsHot', label: '热门股' },
  { key: 'dragon', label: '龙虎榜' },
  { key: 'industry', label: '行业分布' },
  { key: 'limitIndustry', label: '涨跌停分布' },
  { key: 'sectorFlow', label: '板块资金' },
  { key: 'stockFlow', label: '个股资金' },
  { key: 'thsConcept', label: '热门概念' },
  { key: 'thsIndustry', label: '热门行业' },
  { key: 'limitAnalysis', label: '打板分析' },
  { key: 'summary', label: 'AI 总结' },
];

export default function DailyReviewView() {
  const { dailyReviews, currentDailyReviewId, setCurrentDailyReviewId } = useAppStore();

  if (currentDailyReviewId) {
    const review = dailyReviews.find(r => r.id === currentDailyReviewId);
    if (review) {
      return <DetailView review={review} onBack={() => setCurrentDailyReviewId(null)} />;
    }
  }

  return <ListView reviews={dailyReviews} onSelect={setCurrentDailyReviewId} />;
}

// ===== 列表页 =====
function ListView({ reviews, onSelect }: { reviews: DailyReview[]; onSelect: (id: string) => void }) {
  if (!reviews.length) {
    return (
      <>
        <PageHeader title="每日复盘" desc="A 股收盘后自动生成的市场复盘报告" />
        <div className={s.empty}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>暂无复盘报告</span>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="每日复盘" desc="A 股收盘后自动生成的市场复盘报告" />
      <div className={s.list}>
        {reviews.map(r => (
          <ListCard key={r.id} review={r} onSelect={onSelect} />
        ))}
      </div>
    </>
  );
}

// ===== 列表卡片 =====
function ListCard({ review, onSelect }: { review: DailyReview; onSelect: (id: string) => void }) {
  const st = STATUS_MAP[review.status] ?? STATUS_MAP.success;
  const sentiment = review.market_sentiment as Record<string, number> | null;
  const overview = review.market_overview as Record<string, unknown> | null;
  const volume = overview?.volume as Record<string, number> | null;
  const fundFlow = overview?.fund_flow as Record<string, number> | null;

  const ai = review.ai_analysis as AiAnalysisV2 | AiAnalysis | null;
  const aiV2 = ai && 'version' in ai && ai.version === 'v2' ? (ai as AiAnalysisV2) : null;

  const limitAnalysis = review.limit_analysis as {
    premium_summary?: { premium_rate?: number | string };
    promotion?: { rate?: number | string };
  } | null;

  const stageClass = aiV2 ? stageColorClass(aiV2.sentiment.stage) : '';
  const mainInflow = fundFlow?.main_inflow;
  const premiumRate = limitAnalysis?.premium_summary?.premium_rate;
  const promotionRate = limitAnalysis?.promotion?.rate;
  // 两融 T-1 披露，日变化放列表摘要易被误读为当日，故不显示

  return (
    <div className={s.card} onClick={() => onSelect(review.id)}>
      <div className={s.cardHeader}>
        <div className={s.cardHeaderLeft}>
          <span className={s.cardDate}>{review.report_date}</span>
          {aiV2 && (
            <>
              <span className={`${s.cardStageTag} ${stageClass}`}>{aiV2.sentiment.stage}</span>
              <span className={s.cardScore}>情绪 {aiV2.sentiment.score}/10</span>
            </>
          )}
        </div>
        <span className={`${s.cardStatus} ${st.cls}`}>{st.label}</span>
      </div>

      {aiV2?.headline && <div className={s.cardHeadline}>{aiV2.headline}</div>}

      <div className={s.cardMeta}>
        {sentiment && (
          <span>
            涨停 <b className={s.cardRed}>{sentiment.limit_up ?? '-'}</b>
            {' / '}跌停 <b className={s.cardGreen}>{sentiment.limit_down ?? '-'}</b>
          </span>
        )}
        {sentiment?.broken_rate != null && <span>炸板率 {sentiment.broken_rate}%</span>}
        {promotionRate != null && <span>晋级率 {promotionRate}%</span>}
        {premiumRate != null && <span>溢价率 {premiumRate}%</span>}
        {mainInflow != null && (
          <span>
            主力 <b className={mainInflow >= 0 ? s.cardRed : s.cardGreen}>
              {mainInflow >= 0 ? '+' : ''}{mainInflow}亿
            </b>
          </span>
        )}
        {volume?.today != null && <span>成交 {volume.today}亿</span>}
      </div>

      {aiV2 && aiV2.main_themes.length > 0 && (
        <div className={s.cardThemes}>
          <span className={s.cardThemesLabel}>主线</span>
          {aiV2.main_themes.slice(0, 4).map((t, i) => (
            <span key={i} className={`${s.cardThemeChip} ${strengthChipClass(t.strength)}`}>
              {t.name}
              {t.days > 0 && <span className={s.cardThemeDays}>D{t.days}</span>}
            </span>
          ))}
        </div>
      )}

      {aiV2?.battle_plan && (aiV2.battle_plan.position_level || aiV2.battle_plan.mode) && (
        <div className={s.cardBattle}>
          {aiV2.battle_plan.position_level && (
            <span className={s.cardBattleItem}>
              <span className={s.cardBattleLabel}>仓位</span>
              {aiV2.battle_plan.position_level}
            </span>
          )}
          {aiV2.battle_plan.mode && (
            <span className={s.cardBattleItem}>
              <span className={s.cardBattleLabel}>模式</span>
              {aiV2.battle_plan.mode}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function stageColorClass(stage: string): string {
  if (!stage) return '';
  if (stage.includes('高潮') || stage.includes('升温')) return s.stageHot;
  if (stage.includes('分歧')) return s.stageDiverge;
  if (stage.includes('退潮') || stage.includes('冰点')) return s.stageCold;
  if (stage.includes('修复')) return s.stageRecover;
  return '';
}

function strengthChipClass(strength: string): string {
  if (!strength) return '';
  if (strength.includes('强')) return s.cardThemeChipStrong;
  if (strength.includes('弱')) return s.cardThemeChipWeak;
  return s.cardThemeChipMid;
}

// ===== 详情页 =====
function DetailView({ review, onBack }: { review: DailyReview; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState('full');
  const [limitUpReasons, setLimitUpReasons] = useState<LimitUpReasons | null>(null);
  const [limitUpLoading, setLimitUpLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLimitUpLoading(true);
    apiClient
      .getLimitUpReasonsByDate(review.report_date)
      .then(data => {
        if (!cancelled) setLimitUpReasons(data);
      })
      .finally(() => {
        if (!cancelled) setLimitUpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [review.report_date]);

  return (
    <div className={s.detail}>
      <DetailBackBar onBack={onBack} title={`${review.report_date} 每日复盘`} />

      <div className={s.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`${s.tab} ${activeTab === t.key ? s.tabActive : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'full' ? (
        <FullReportPanel review={review} limitUpReasons={limitUpReasons} />
      ) : (
        <div className={s.panel}>
          {activeTab === 'overview' && <OverviewPanel data={review.market_overview} sentiment={review.market_sentiment} marginTradeDate={(review.margin_data as { trade_date?: string } | null)?.trade_date ?? null} />}
          {activeTab === 'thsHot' && <ThsHotStocksPanel data={review.ths_hot_stocks} />}
          {activeTab === 'ladder' && <LadderPanel data={review.limit_up_ladder} limitUpReasons={limitUpReasons} />}
          {activeTab === 'dragon' && <DragonPanel data={review.dragon_tiger} />}
          {activeTab === 'limitUp' && (
            <LimitUpReasonsPanel data={limitUpReasons} loading={limitUpLoading} />
          )}
          {activeTab === 'limitAnalysis' && <LimitAnalysisPanel data={review.limit_analysis} />}
          {activeTab === 'industry' && <IndustryPanel data={review.industry_distribution} />}
          {activeTab === 'limitIndustry' && <LimitIndustryPanel data={review.limit_industry_distribution} />}
          {activeTab === 'sectorFlow' && <FlowPanel data={review.sector_fund_flow} type="sector" />}
          {activeTab === 'stockFlow' && <FlowPanel data={review.stock_fund_flow} type="stock" />}
          {activeTab === 'thsConcept' && <ThsHotPlatePanel data={review.ths_hot_concepts} type="concept" />}
          {activeTab === 'thsIndustry' && <ThsHotPlatePanel data={review.ths_hot_industries} type="industry" />}
          {activeTab === 'summary' && <SummaryPanel data={review.ai_summary} />}
        </div>
      )}
    </div>
  );
}

// ===== 全览面板 =====
const FULL_COLLAPSE_LIMIT = 20;

function FullReportPanel({
  review,
  limitUpReasons,
}: {
  review: DailyReview;
  limitUpReasons?: LimitUpReasons | null;
}) {
  const aiRaw = review.ai_analysis as (AiAnalysis | AiAnalysisV2) | null;

  // 如果没有 ai_analysis，降级到旧版平铺展示
  if (!aiRaw) {
    return <LegacyFullReportPanel review={review} />;
  }

  // v2 分析 → 新版全览面板
  if ((aiRaw as { version?: string }).version === 'v2') {
    return (
      <FullReportV2
        ai={aiRaw as AiAnalysisV2}
        review={review}
        limitUpReasons={limitUpReasons}
      />
    );
  }

  const ai = aiRaw as AiAnalysis;

  return (
    <div className={s.fullReport}>
      {/* 第一层：头部概览 */}
      <AiHeaderSection ai={ai} review={review} />

      {/* 第二层：主线分析 */}
      {ai.main_themes?.length > 0 && (
        <div className={s.aiSection}>
          <h2 className={s.aiSectionTitle}>主线分析</h2>
          {ai.main_themes.map((theme, i) => (
            <ThemeCard key={i} theme={theme} />
          ))}
        </div>
      )}

      {/* 第三层：异动信号 */}
      {ai.signals?.length > 0 && (
        <div className={s.aiSection}>
          <h2 className={s.aiSectionTitle}>异动信号</h2>
          <div className={s.signalList}>
            {ai.signals.map((sig, i) => (
              <SignalItem key={i} signal={sig} />
            ))}
          </div>
        </div>
      )}

      {/* 第四层：明日展望 */}
      {ai.outlook && <OutlookSection outlook={ai.outlook} />}

      {/* 第五层：原始数据折叠区 */}
      <div className={s.aiSection}>
        <h2 className={s.aiSectionTitle}>原始数据</h2>
        <CollapsePanel title="大盘总览">
          <OverviewPanel
            data={review.market_overview}
            sentiment={review.market_sentiment}
            marginTradeDate={(review.margin_data as { trade_date?: string } | null)?.trade_date ?? null}
          />
        </CollapsePanel>
        <CollapsePanel title="热门股">
          <ThsHotStocksPanel data={review.ths_hot_stocks} />
        </CollapsePanel>
        <CollapsePanel title="连板天梯">
          <LadderPanel data={review.limit_up_ladder} />
        </CollapsePanel>
        <CollapsePanel title="龙虎榜">
          <DragonPanel data={review.dragon_tiger} />
        </CollapsePanel>
        <CollapsePanel title="打板分析">
          <LimitAnalysisPanel data={review.limit_analysis} />
        </CollapsePanel>
        <CollapsePanel title="行业分布">
          <IndustryPanel data={review.industry_distribution} />
        </CollapsePanel>
        <CollapsePanel title="涨跌停分布">
          <LimitIndustryPanel data={review.limit_industry_distribution} />
        </CollapsePanel>
        <CollapsePanel title="板块资金">
          <FlowPanel data={review.sector_fund_flow} type="sector" />
        </CollapsePanel>
        <CollapsePanel title="个股资金">
          <FlowPanel data={review.stock_fund_flow} type="stock" />
        </CollapsePanel>
        <CollapsePanel title="热门概念">
          <ThsHotPlatePanel data={review.ths_hot_concepts} type="concept" />
        </CollapsePanel>
        <CollapsePanel title="热门行业">
          <ThsHotPlatePanel data={review.ths_hot_industries} type="industry" />
        </CollapsePanel>
        <CollapsePanel title="AI 完整文本">
          <SummaryPanel data={review.ai_summary} />
        </CollapsePanel>
      </div>
    </div>
  );
}

// AI 头部概览区
function AiHeaderSection({ ai, review }: { ai: AiAnalysis; review: DailyReview }) {
  const sentiment = review.market_sentiment as Record<string, number> | null;
  const overview = review.market_overview as Record<string, unknown> | null;
  const volume = overview?.volume as Record<string, number> | null;

  // 情绪温度计颜色
  const scoreColor = ai.sentiment_score <= 3 ? '#16a34a'
    : ai.sentiment_score <= 5 ? '#f59e0b'
    : ai.sentiment_score <= 7 ? '#ea580c'
    : '#dc2626';

  const stageClsMap: Record<string, string> = {
    '冰点': s.stageCold,
    '修复': s.stageRecover,
    '升温': s.stageWarm,
    '高潮': s.stageHot,
    '退潮': s.stageCool,
  };

  // 连板最高板数
  const ladder = review.limit_up_ladder as Record<string, unknown>[] | null;
  const maxBoard = ladder?.length
    ? Math.max(...ladder.map(item => (item.continuous_limit as number) ?? 0))
    : null;

  // 打板分析指标
  const la = review.limit_analysis as Record<string, unknown> | null;
  const premiumSummary = la?.premium_summary as Record<string, number> | null;
  const promotion = la?.promotion as Record<string, unknown> | null;
  const sealStats = la?.seal_stats as Record<string, number> | null;

  return (
    <div className={s.aiHeader}>
      <h1 className={s.aiHeadline}>{ai.headline}</h1>

      {/* 情绪温度计 */}
      <div className={s.aiSentimentRow}>
        <span className={s.sentimentLabel}>情绪温度</span>
        <div className={s.sentimentBarWrap}>
          <div
            className={s.sentimentBar}
            style={{
              width: `${ai.sentiment_score * 10}%`,
              background: scoreColor,
            }}
          />
        </div>
        <span className={s.sentimentScore} style={{ color: scoreColor }}>
          {ai.sentiment_score}
        </span>
        <span className={`${s.sentimentStage} ${stageClsMap[ai.sentiment_stage] ?? s.stageWarm}`}>
          {ai.sentiment_stage}
        </span>
      </div>

      {/* 核心指标卡片 */}
      <div className={s.aiMetrics}>
        {sentiment?.up_count != null && sentiment?.down_count != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>涨/跌</div>
            <div className={s.aiMetricVal}>
              <span className={s.up}>{sentiment.up_count}</span>
              {' / '}
              <span className={s.down}>{sentiment.down_count}</span>
            </div>
          </div>
        )}
        {sentiment?.limit_up != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>涨停</div>
            <div className={`${s.aiMetricVal} ${s.up}`}>{sentiment.limit_up}</div>
          </div>
        )}
        {sentiment?.broken_rate != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>炸板率</div>
            <div className={s.aiMetricVal}>{fmt(sentiment.broken_rate)}%</div>
          </div>
        )}
        {volume?.today != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>成交额</div>
            <div className={s.aiMetricVal}>{fmt(volume.today)}亿</div>
          </div>
        )}
        {maxBoard != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>最高连板</div>
            <div className={`${s.aiMetricVal} ${s.up}`}>{maxBoard}板</div>
          </div>
        )}
        {premiumSummary?.premium_rate != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>打板溢价率</div>
            <div className={`${s.aiMetricVal} ${premiumSummary.premium_rate >= 50 ? s.up : s.down}`}>
              {fmt(premiumSummary.premium_rate)}%
            </div>
          </div>
        )}
        {promotion?.rate != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>首板晋级率</div>
            <div className={`${s.aiMetricVal} ${(promotion.rate as number) >= 20 ? s.up : s.down}`}>
              {fmt(promotion.rate as number)}%
            </div>
          </div>
        )}
        {sealStats?.total_seal_fund != null && (
          <div className={s.aiMetricCard}>
            <div className={s.aiMetricLabel}>封单总额</div>
            <div className={`${s.aiMetricVal} ${s.up}`}>{fmt(sealStats.total_seal_fund, 1)}亿</div>
          </div>
        )}
      </div>
    </div>
  );
}

// 主线卡片
function ThemeCard({ theme }: { theme: AiAnalysis['main_themes'][0] }) {
  const strengthCls = theme.strength === '强' ? s.strengthStrong
    : theme.strength === '中' ? s.strengthMedium
    : s.strengthWeak;

  return (
    <div className={`${s.themeCard} ${strengthCls}`}>
      <div className={s.themeCardHeader}>
        <span className={s.themeName}>{theme.name}</span>
        <span className={`${s.strengthTag} ${strengthCls}`}>{theme.strength}</span>
      </div>
      <div className={s.themeLogic}>{theme.logic}</div>
      {theme.leader_stocks?.length > 0 && (
        <div className={s.themeLeaders}>
          {theme.leader_stocks.map((stock, i) => (
            <span key={i} className={s.leaderChip}>{stock}</span>
          ))}
        </div>
      )}
      {theme.related_data && (
        <div className={s.themeRelated}>{theme.related_data}</div>
      )}
      {theme.continuation && (
        <div className={s.themeContinuation}>{theme.continuation}</div>
      )}
    </div>
  );
}

// 异动信号项
function SignalItem({ signal }: { signal: AiAnalysis['signals'][0] }) {
  const iconMap: Record<string, { cls: string; icon: string }> = {
    '机构抢筹': { cls: s.signalInstitution, icon: '🏛' },
    '游资接力': { cls: s.signalHotMoney, icon: '🔥' },
    '主力撤退': { cls: s.signalRetreat, icon: '📉' },
    '新题材': { cls: s.signalNew, icon: '✨' },
    '风险': { cls: s.signalRisk, icon: '⚠' },
  };
  const { cls, icon } = iconMap[signal.type] ?? { cls: s.signalDefault, icon: '📌' };

  return (
    <div className={s.signalItem}>
      <div className={`${s.signalIcon} ${cls}`}>{icon}</div>
      <div>
        <div className={s.signalType}>{signal.type}</div>
        <div className={s.signalContent}>{signal.content}</div>
      </div>
    </div>
  );
}

// 明日展望区
function OutlookSection({ outlook }: { outlook: AiAnalysis['outlook'] }) {
  const dirCls = outlook.direction === '偏多' ? s.dirBullish
    : outlook.direction === '偏空' ? s.dirBearish
    : s.dirNeutral;

  return (
    <div className={s.aiSection}>
      <h2 className={s.aiSectionTitle}>明日展望</h2>
      <div className={s.outlookCard}>
        <div className={s.outlookDirection}>
          <span className={`${s.directionTag} ${dirCls}`}>{outlook.direction}</span>
        </div>
        {outlook.focus_areas?.length > 0 && (
          <>
            <div className={s.outlookLabel}>关注方向</div>
            <ul className={`${s.outlookList} ${s.focusList}`}>
              {outlook.focus_areas.map((area, i) => <li key={i}>{area}</li>)}
            </ul>
          </>
        )}
        {outlook.risk_warnings?.length > 0 && (
          <>
            <div className={s.outlookLabel}>风险提示</div>
            <ul className={`${s.outlookList} ${s.riskList}`}>
              {outlook.risk_warnings.map((warn, i) => <li key={i}>{warn}</li>)}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// 折叠面板组件
function CollapsePanel({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.collapseSection}>
      <button className={s.collapseHeader} onClick={() => setOpen(v => !v)}>
        {title}
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`${s.collapseArrow} ${open ? s.collapseArrowOpen : ''}`}
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && <div className={s.collapseBody}>{children}</div>}
    </div>
  );
}

// 旧版平铺展示（降级用）
function LegacyFullReportPanel({ review }: { review: DailyReview }) {
  const [expandDragon, setExpandDragon] = useState(false);
  const [expandIndustry, setExpandIndustry] = useState(false);
  const [expandLimitUp, setExpandLimitUp] = useState(false);
  const [expandLimitDown, setExpandLimitDown] = useState(false);

  const sections: { title: string; content: React.ReactNode }[] = [
    { title: '大盘总览', content: <OverviewPanel data={review.market_overview} sentiment={review.market_sentiment} marginTradeDate={(review.margin_data as { trade_date?: string } | null)?.trade_date ?? null} /> },
    { title: '热门股', content: <ThsHotStocksPanel data={review.ths_hot_stocks} /> },
    { title: '连板天梯', content: <LadderPanel data={review.limit_up_ladder} /> },
    {
      title: '龙虎榜',
      content: <FullDragonPanel
        data={review.dragon_tiger}
        expanded={expandDragon}
        onToggle={() => setExpandDragon(v => !v)}
      />,
    },
    {
      title: '行业分布（来源于热门、连板、龙虎榜）',
      content: <FullIndustryPanel
        data={review.industry_distribution}
        expanded={expandIndustry}
        onToggle={() => setExpandIndustry(v => !v)}
      />,
    },
    {
      title: '涨跌停分布',
      content: <FullLimitIndustryPanel
        data={review.limit_industry_distribution}
        expandUp={expandLimitUp}
        onToggleUp={() => setExpandLimitUp(v => !v)}
        expandDown={expandLimitDown}
        onToggleDown={() => setExpandLimitDown(v => !v)}
      />,
    },
    { title: '板块资金', content: <FlowPanel data={review.sector_fund_flow} type="sector" /> },
    { title: '个股资金', content: <FlowPanel data={review.stock_fund_flow} type="stock" /> },
    { title: '热门概念', content: <ThsHotPlatePanel data={review.ths_hot_concepts} type="concept" /> },
    { title: '热门行业', content: <ThsHotPlatePanel data={review.ths_hot_industries} type="industry" /> },
    { title: 'AI 总结', content: <SummaryPanel data={review.ai_summary} /> },
  ];

  return (
    <div className={s.fullReport}>
      {sections.map((sec, i) => (
        <section key={i} className={s.fullSection}>
          <h2 className={s.fullSectionTitle}>
            <span className={s.fullSectionOrder}>{i + 1}</span>
            {sec.title}
          </h2>
          <div className={s.panel}>{sec.content}</div>
        </section>
      ))}
    </div>
  );
}

// 展开/收起按钮
function ExpandToggle({ total, limit, expanded, onToggle }: {
  total: number; limit: number; expanded: boolean; onToggle: () => void;
}) {
  if (total <= limit) return null;
  return (
    <button className={s.expandBtn} onClick={onToggle}>
      {expanded ? '收起' : `展开全部（共 ${total} 条）`}
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
      >
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
  );
}

// 全览 — 龙虎榜（带序号 + 折叠）
function FullDragonPanel({ data, expanded, onToggle }: {
  data: Record<string, unknown>[] | null;
  expanded: boolean; onToggle: () => void;
}) {
  if (!data?.length) return <p>暂无数据</p>;
  const shown = expanded ? data : data.slice(0, FULL_COLLAPSE_LIMIT);
  return (
    <>
      <table className={s.table}>
        <thead>
          <tr>
            <th>#</th><th>代码</th><th>名称</th><th>涨幅</th>
            <th>买入额(万)</th><th>卖出额(万)</th><th>净额(万)</th><th>上榜原因</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{item.code as string}</td>
              <td>{item.name as string}</td>
              <td className={changeCls(item.change_pct as number)}>
                {fmt(item.change_pct as number)}%
              </td>
              <td>{fmt(item.buy_amount as number, 0)}</td>
              <td>{fmt(item.sell_amount as number, 0)}</td>
              <td className={changeCls(item.net_amount as number)}>
                {fmt(item.net_amount as number, 0)}
              </td>
              <td style={{
                fontSize: 12, maxWidth: 200,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.reason as string ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ExpandToggle
        total={data.length} limit={FULL_COLLAPSE_LIMIT}
        expanded={expanded} onToggle={onToggle}
      />
    </>
  );
}

// 全览 — 行业分布（折叠）
function FullIndustryPanel({ data, expanded, onToggle }: {
  data: Record<string, unknown>[] | null;
  expanded: boolean; onToggle: () => void;
}) {
  if (!data?.length) return <p>暂无数据</p>;
  const shown = expanded ? data : data.slice(0, FULL_COLLAPSE_LIMIT);
  return (
    <>
      <table className={s.table}>
        <thead>
          <tr>
            <th>行业</th><th>热门</th><th>连板</th><th>龙虎榜</th>
            <th>合计</th><th>代表个股</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
              <td>{item.hot_count as number ?? 0}</td>
              <td>{item.limit_count as number ?? 0}</td>
              <td>{item.dragon_count as number ?? 0}</td>
              <td style={{ fontWeight: 700 }}>{item.total as number ?? 0}</td>
              <td style={{ fontSize: 12 }}>
                {(item.top_stocks as string[])?.join('、') ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ExpandToggle
        total={data.length} limit={FULL_COLLAPSE_LIMIT}
        expanded={expanded} onToggle={onToggle}
      />
    </>
  );
}

// 全览 — 涨跌停分布（涨停/跌停各自折叠）
function FullLimitIndustryPanel({ data, expandUp, onToggleUp, expandDown, onToggleDown }: {
  data: Record<string, unknown>[] | null;
  expandUp: boolean; onToggleUp: () => void;
  expandDown: boolean; onToggleDown: () => void;
}) {
  if (!data?.length) return <p>暂无数据</p>;

  const upList = data
    .filter(item => ((item.limit_up_count as number) ?? 0) > 0)
    .sort((a, b) => ((b.limit_up_count as number) ?? 0) - ((a.limit_up_count as number) ?? 0));
  const downList = data
    .filter(item => ((item.limit_down_count as number) ?? 0) > 0)
    .sort((a, b) => ((b.limit_down_count as number) ?? 0) - ((a.limit_down_count as number) ?? 0));

  const shownUp = expandUp ? upList : upList.slice(0, FULL_COLLAPSE_LIMIT);
  const shownDown = expandDown ? downList : downList.slice(0, FULL_COLLAPSE_LIMIT);

  return (
    <>
      <div className={s.subTitle}>涨停行业分布</div>
      {shownUp.length ? (
        <>
          <table className={s.table}>
            <thead><tr><th>行业</th><th>涨停数</th><th>代表个股</th></tr></thead>
            <tbody>
              {shownUp.map((item, i) => {
                const stocks = (item.limit_up_stocks as Record<string, string>[]) ?? [];
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
                    <td className={s.up}>{item.limit_up_count as number}</td>
                    <td style={{ fontSize: 12 }}>
                      {stocks.map(st => st.name).join('、') || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ExpandToggle
            total={upList.length} limit={FULL_COLLAPSE_LIMIT}
            expanded={expandUp} onToggle={onToggleUp}
          />
        </>
      ) : <p>无涨停数据</p>}

      <div className={s.subTitle} style={{ marginTop: 24 }}>跌停行业分布</div>
      {shownDown.length ? (
        <>
          <table className={s.table}>
            <thead><tr><th>行业</th><th>跌停数</th><th>代表个股</th></tr></thead>
            <tbody>
              {shownDown.map((item, i) => {
                const stocks = (item.limit_down_stocks as Record<string, string>[]) ?? [];
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
                    <td className={s.down}>{item.limit_down_count as number}</td>
                    <td style={{ fontSize: 12 }}>
                      {stocks.map(st => st.name).join('、') || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ExpandToggle
            total={downList.length} limit={FULL_COLLAPSE_LIMIT}
            expanded={expandDown} onToggle={onToggleDown}
          />
        </>
      ) : <p>无跌停数据</p>}
    </>
  );
}

// ===== 各模块面板 =====

function changeCls(val: number) {
  if (val > 0) return s.up;
  if (val < 0) return s.down;
  return s.flat;
}

function fmt(val: number | null | undefined, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return Number(val).toFixed(digits);
}

// 模块1+2: 大盘总览（大盘概览 + 市场情绪）
// 小问号提示：hover 立即显示深色气泡，支持多行
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#cbd5e1',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'help',
        marginLeft: 4,
        verticalAlign: 'middle',
        userSelect: 'none',
      }}
    >
      ?
      {open && (
        <span
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e293b',
            color: '#fff',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.6,
            padding: '8px 12px',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            whiteSpace: 'pre-line',
            width: 260,
            maxWidth: '80vw',
            zIndex: 50,
            textAlign: 'left',
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

function OverviewPanel({
  data,
  sentiment,
  marginTradeDate,
}: {
  data: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
  marginTradeDate?: string | null;
}) {
  if (!data) return <p>暂无数据</p>;
  const indices = (data.indices ?? []) as Record<string, unknown>[];
  const margin = data.margin as Record<string, number> | null;
  const volume = data.volume as Record<string, number> | null;
  const ff = data.fund_flow as Record<string, number | null> | null;
  const d = (sentiment ?? {}) as Record<string, number>;

  return (
    <>
      <table className={s.table}>
        <thead><tr><th>指数</th><th>收盘价</th><th>涨跌幅</th><th>成交额(亿)</th></tr></thead>
        <tbody>
          {indices.map((idx, i) => (
            <tr key={i}>
              <td>{idx.name as string}</td>
              <td>{fmt(idx.close as number)}</td>
              <td className={changeCls(idx.change_pct as number)}>{fmt(idx.change_pct as number)}%</td>
              <td>{idx.amount != null ? fmt(idx.amount as number) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={s.subTitle}>资金面</div>
      <div className={s.metricGrid}>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            融资余额{marginTradeDate ? `（截至 ${marginTradeDate}）` : '（T-1）'}
            <InfoTip text={'两融数据由交易所 T+1 披露，当日复盘里的融资余额实际反映的是上一交易日收盘后的数据。\n仅作为中期趋势参考，不宜直接用来解读当日涨跌。'} />
          </div>
          <div className={s.metricValue}>{fmt(margin?.balance)}亿</div>
        </div>
      </div>
      {/* 大盘资金（主力/超大单/中单/散户）— 单独一行 */}
      <div className={s.metricGrid} style={{ marginTop: 8 }}>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            主力净流入 <InfoTip text={'主力净流入 =（超大单 + 大单）买入 − 卖出\n\n主力 = 机构 + 大游资，单笔成交 ≥ 20 万元的资金合计。\n正值=大资金净买，负值=大资金净卖。\n注意：与超大单有重叠，不要相加。'} />
          </div>
          <div className={`${s.metricValue} ${changeCls(ff?.main_inflow ?? 0)}`}>{fmt(ff?.main_inflow)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            超大单净流入(机构) <InfoTip text={'超大单净流入 = 超大单买入 − 超大单卖出\n\n顶级机构 / 大私募 / 顶级游资，单笔成交 ≥ 100 万元。\n是"主力"里最顶层的一档，更接近真正的机构动向。\n属于"主力"的子集。'} />
          </div>
          <div className={`${s.metricValue} ${changeCls(ff?.super_large_inflow ?? 0)}`}>{fmt(ff?.super_large_inflow)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            大单净流入(主力) <InfoTip text={'大单净流入 = 大单买入 − 大单卖出\n\n中型机构 / 中大游资，单笔成交 20-100 万元。\n属于"主力"的子集（主力 = 超大单 + 大单）。'} />
          </div>
          <div className={`${s.metricValue} ${changeCls(ff?.large_inflow ?? 0)}`}>{fmt(ff?.large_inflow)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            中单净流入(大户) <InfoTip text={'中单净流入 = 中单买入 − 中单卖出\n\n一般大户 / 小机构，单笔成交 4-20 万元。\n介于主力与散户之间的中等资金。'} />
          </div>
          <div className={`${s.metricValue} ${changeCls(ff?.mid_inflow ?? 0)}`}>{fmt(ff?.mid_inflow)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>
            散户净流入(散户) <InfoTip text={'散户净流入 = 小单买入 − 小单卖出\n\n散户，单笔成交 < 4 万元。\n小资金动向的代理指标。\n主力与散户对立方向，往往是出货/接盘信号。'} />
          </div>
          <div className={`${s.metricValue} ${changeCls(ff?.retail_inflow ?? 0)}`}>{fmt(ff?.retail_inflow)}亿</div>
        </div>
      </div>

      <div className={s.subTitle}>量能趋势</div>
      <div className={s.metricGrid}>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>今日两市成交额</div>
          <div className={s.metricValue}>{fmt(volume?.today)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>5日均量</div>
          <div className={s.metricValue}>{fmt(volume?.avg_5d)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>量能变化</div>
          <div className={`${s.metricValue} ${changeCls(volume?.change_pct ?? 0)}`}>
            {fmt(volume?.change_pct)}%
          </div>
        </div>
      </div>

      <div className={s.subTitle}>市场情绪</div>
      <div className={s.metricGrid}>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>上涨家数</div>
          <div className={`${s.metricValue} ${s.up}`}>{d.up_count ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>下跌家数</div>
          <div className={`${s.metricValue} ${s.down}`}>{d.down_count ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>涨停(非ST)</div>
          <div className={`${s.metricValue} ${s.up}`}>{d.limit_up ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>跌停(非ST)</div>
          <div className={`${s.metricValue} ${s.down}`}>{d.limit_down ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>炸板数</div>
          <div className={s.metricValue}>{d.broken_limit ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>炸板率</div>
          <div className={s.metricValue}>{fmt(d.broken_rate)}%</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>涨幅&gt;7%</div>
          <div className={`${s.metricValue} ${s.up}`}>{d.strong_stocks ?? '-'}</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>跌幅&gt;7%</div>
          <div className={`${s.metricValue} ${s.down}`}>{d.weak_stocks ?? '-'}</div>
        </div>
      </div>
    </>
  );
}

// 模块4: 连板天梯（按连板数分组，合并单元格）
function LadderPanel({
  data,
  limitUpReasons,
}: {
  data: Record<string, unknown>[] | null;
  limitUpReasons?: LimitUpReasons | null;
}) {
  if (!data?.length) return <p>暂无数据</p>;

  // 按连板数分组，降序排列
  const groups = new Map<number, Record<string, unknown>[]>();
  for (const item of data) {
    const level = (item.continuous_limit as number) ?? 1;
    if (!groups.has(level)) groups.set(level, []);
    groups.get(level)!.push(item);
  }
  const sortedLevels = [...groups.keys()].sort((a, b) => b - a);

  const levelLabel = (n: number) => {
    if (n === 1) return '首板';
    const map: Record<number, string> = { 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' };
    return `${map[n] ?? n}板`;
  };

  // 涨停关键词映射：code → keyword（来自涨停简图）
  const keywordMap = new Map<string, string>();
  if (limitUpReasons?.themes) {
    for (const theme of limitUpReasons.themes) {
      for (const st of theme.stocks ?? []) {
        if (st.code && st.keyword) keywordMap.set(st.code, st.keyword);
      }
    }
  }

  // 交替色：每个连板级别用不同左边框颜色区分
  const groupColors = ['#dc2626', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 12px',
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          fontSize: 13,
          color: '#1e293b',
        }}
      >
        <span style={{ fontWeight: 700 }}>合计 {data.length}</span>
        {sortedLevels.map((level, gi) => (
          <span key={level} style={{ color: groupColors[gi % groupColors.length] }}>
            · {levelLabel(level)} {groups.get(level)!.length}
          </span>
        ))}
      </div>

      <table className={s.table}>
        <thead>
          <tr>
            <th>连板</th>
            <th>代码</th>
            <th>名称</th>
            <th>行业</th>
            <th>涨幅</th>
            <th>涨停原因</th>
          </tr>
        </thead>
        <tbody>
          {sortedLevels.map((level, gi) => {
            const items = groups.get(level)!;
            const color = groupColors[gi % groupColors.length];
            return items.map((item, i) => {
              const code = item.code as string;
              const keyword = keywordMap.get(code) ?? '';
              return (
                <tr
                  key={`${level}-${i}`}
                  className={i === 0 ? s.ladderGroupFirst : undefined}
                >
                  {i === 0 && (
                    <td
                      rowSpan={items.length}
                      className={s.ladderLevelCell}
                      style={{ borderLeftColor: color }}
                    >
                      {levelLabel(level)}
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 400, marginTop: 2 }}>
                        {items.length} 只
                      </div>
                    </td>
                  )}
                  <td>{code}</td>
                  <td style={{ fontWeight: 600 }}>{item.name as string}</td>
                  <td style={{ fontSize: 12 }}>
                    {(item.industries as string[])?.join('/') ?? '-'}
                  </td>
                  <td className={changeCls(item.change_pct as number)}>
                    {fmt(item.change_pct as number)}%
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: 'normal', lineHeight: 1.5 }}>
                    {keyword || '-'}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// 模块5: 龙虎榜
function DragonPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <table className={s.table}>
      <thead>
        <tr><th>代码</th><th>名称</th><th>涨幅</th><th>买入额(万)</th><th>卖出额(万)</th><th>净额(万)</th><th>上榜原因</th></tr>
      </thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td>{item.code as string}</td>
            <td>{item.name as string}</td>
            <td className={changeCls(item.change_pct as number)}>{fmt(item.change_pct as number)}%</td>
            <td>{fmt(item.buy_amount as number, 0)}</td>
            <td>{fmt(item.sell_amount as number, 0)}</td>
            <td className={changeCls(item.net_amount as number)}>{fmt(item.net_amount as number, 0)}</td>
            <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.reason as string ?? '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 今日异动（韭研公社涨停原因）
function LimitUpReasonsPanel({
  data,
  loading,
}: {
  data: LimitUpReasons | null;
  loading: boolean;
}) {
  if (loading) return <p>加载中…</p>;
  if (!data || !data.themes?.length) {
    return <p>暂无数据（韭研公社每日 17:00-20:00 采集）</p>;
  }

  const sectorId = (i: number) => `limit-up-sector-${i}`;
  const jumpTo = (i: number) => {
    const el = document.getElementById(sectorId(i));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginRight: 4 }}>
          合计: {data.themes.reduce((sum, t) => sum + (t.stocks?.length ?? 0), 0)}
        </span>
        {data.themes.map((theme, i) => (
          <button
            key={i}
            type="button"
            onClick={() => jumpTo(i)}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 14,
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#1e293b',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {theme.name}
            <span style={{ color: '#dc2626', marginLeft: 4 }}>*{theme.count}</span>
          </button>
        ))}
      </div>

      {data.themes.map((theme, i) => (
        <div
          key={i}
          id={sectorId(i)}
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: '14px 16px',
            background: '#fff',
            scrollMarginTop: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
              {theme.name}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                background: '#fee2e2',
                color: '#dc2626',
                fontWeight: 600,
              }}
            >
              涨停 {theme.count}
            </span>
          </div>
          <table className={s.table}>
            <thead>
              <tr>
                <th>板数</th>
                <th>代码</th>
                <th>名称</th>
                <th>涨停时间</th>
                <th>流通市值(亿)</th>
                <th>成交额(亿)</th>
                <th>涨停关键词</th>
              </tr>
            </thead>
            <tbody>
              {theme.stocks.map((st, j) => {
                const isHighBoard = /连板|[3-9]板|\d{2,}板/.test(st.board || '');
                return (
                  <tr key={j}>
                    <td>
                      {st.board ? (
                        <span
                          style={{
                            fontSize: 11,
                            padding: '1px 6px',
                            background: isHighBoard ? '#fee2e2' : '#fef3c7',
                            color: isHighBoard ? '#dc2626' : '#92400e',
                            borderRadius: 4,
                            fontWeight: 700,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {st.board}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{st.code}</td>
                    <td style={{ fontWeight: 600 }}>{st.name}</td>
                    <td style={{ fontSize: 12 }}>{st.time || '-'}</td>
                    <td>{st.float_mv != null ? st.float_mv.toFixed(2) : '-'}</td>
                    <td>{st.turnover_amt != null ? st.turnover_amt.toFixed(2) : '-'}</td>
                    <td style={{ fontSize: 12, maxWidth: 320, whiteSpace: 'normal', lineHeight: 1.5 }}>
                      {st.keyword || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// 模块6: 行业分布统计
function IndustryPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <>
      <div
        style={{
          padding: '8px 12px',
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          fontSize: 12,
          color: '#475569',
          marginBottom: 12,
        }}
      >
        说明：来源于<b>连板天梯</b>、<b>热门股</b>、<b>龙虎榜</b> 三板块的行业聚合
      </div>
      <table className={s.table}>
      <thead>
        <tr><th>行业</th><th>热门</th><th>连板</th><th>龙虎榜</th><th>合计</th><th>代表个股</th></tr>
      </thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
            <td>{item.hot_count as number ?? 0}</td>
            <td>{item.limit_count as number ?? 0}</td>
            <td>{item.dragon_count as number ?? 0}</td>
            <td style={{ fontWeight: 700 }}>{item.total as number ?? 0}</td>
            <td style={{ fontSize: 12 }}>
              {(item.top_stocks as string[])?.join('、') ?? '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

// 模块7: 涨跌停行业分布（涨停/跌停分开展示）
function LimitIndustryPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;

  // 筛选有涨停的行业，按涨停数降序
  const upList = data
    .filter(item => ((item.limit_up_count as number) ?? 0) > 0)
    .sort((a, b) => ((b.limit_up_count as number) ?? 0) - ((a.limit_up_count as number) ?? 0));

  // 筛选有跌停的行业，按跌停数降序
  const downList = data
    .filter(item => ((item.limit_down_count as number) ?? 0) > 0)
    .sort((a, b) => ((b.limit_down_count as number) ?? 0) - ((a.limit_down_count as number) ?? 0));

  const totalUp = upList.reduce((sum, it) => sum + ((it.limit_up_count as number) ?? 0), 0);
  const totalDown = downList.reduce((sum, it) => sum + ((it.limit_down_count as number) ?? 0), 0);

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: '8px 12px',
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          color: '#1e293b',
          marginBottom: 12,
        }}
      >
        <span>合计:</span>
        <span className={s.up}>涨停 {totalUp}</span>
        <span className={s.down}>跌停 {totalDown}</span>
      </div>
      <div className={s.subTitle}>涨停行业分布</div>
      {upList.length ? (
        <table className={s.table}>
          <thead>
            <tr><th>行业</th><th>涨停数</th><th>代表个股</th></tr>
          </thead>
          <tbody>
            {upList.map((item, i) => {
              const stocks = (item.limit_up_stocks as Record<string, string>[]) ?? [];
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
                  <td className={s.up}>{item.limit_up_count as number}</td>
                  <td style={{ fontSize: 12 }}>{stocks.map(st => st.name).join('、') || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p>无涨停数据</p>}

      <div className={s.subTitle} style={{ marginTop: 24 }}>跌停行业分布</div>
      {downList.length ? (
        <table className={s.table}>
          <thead>
            <tr><th>行业</th><th>跌停数</th><th>代表个股</th></tr>
          </thead>
          <tbody>
            {downList.map((item, i) => {
              const stocks = (item.limit_down_stocks as Record<string, string>[]) ?? [];
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
                  <td className={s.down}>{item.limit_down_count as number}</td>
                  <td style={{ fontSize: 12 }}>{stocks.map(st => st.name).join('、') || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p>无跌停数据</p>}
    </>
  );
}

// 模块8/9: 资金流向（板块+个股复用）
function FlowPanel({ data, type }: { data: Record<string, unknown> | null; type: 'sector' | 'stock' }) {
  if (!data) return <p>暂无数据</p>;
  const inflow = (data.inflow ?? []) as Record<string, unknown>[];
  const outflow = (data.outflow ?? []) as Record<string, unknown>[];

  const isSector = type === 'sector';

  return (
    <>
      <div className={s.subTitle}>流入 TOP10</div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{isSector ? '板块' : '代码'}</th>
            {!isSector && <th>名称</th>}
            <th>今日净额(亿)</th>
            {!isSector && <th>涨幅</th>}
            {isSector && <th>代表个股</th>}
            <th>10日流入天数</th>
          </tr>
        </thead>
        <tbody>
          {inflow.map((item, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{(isSector ? item.sector : item.code) as string}</td>
              {!isSector && <td>{item.name as string}</td>}
              <td className={s.up}>{fmt(item.net_amount as number)}</td>
              {!isSector && <td className={changeCls(item.change_pct as number)}>{fmt(item.change_pct as number)}%</td>}
              {isSector && <td style={{ fontSize: 12 }}>{(item.top_stocks as string[])?.join('、') ?? '-'}</td>}
              <td>{item.inflow_days_10 != null ? `${item.inflow_days_10}天` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={s.subTitle} style={{ marginTop: 24 }}>流出 TOP10</div>
      <table className={s.table}>
        <thead>
          <tr>
            <th>{isSector ? '板块' : '代码'}</th>
            {!isSector && <th>名称</th>}
            <th>今日净额(亿)</th>
            {!isSector && <th>涨幅</th>}
            {isSector && <th>代表个股</th>}
            <th>10日流入天数</th>
          </tr>
        </thead>
        <tbody>
          {outflow.map((item, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{(isSector ? item.sector : item.code) as string}</td>
              {!isSector && <td>{item.name as string}</td>}
              <td className={s.down}>{fmt(item.net_amount as number)}</td>
              {!isSector && <td className={changeCls(item.change_pct as number)}>{fmt(item.change_pct as number)}%</td>}
              {isSector && <td style={{ fontSize: 12 }}>{(item.top_stocks as string[])?.join('、') ?? '-'}</td>}
              <td>{item.inflow_days_10 != null ? `${item.inflow_days_10}天` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// 模块3: 热门个股（数据源: 同花顺）
function ThsHotStocksPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>#</th><th>代码</th><th>名称</th><th>热度</th><th>涨跌幅</th>
          <th>热度变化</th><th>标签</th><th>概念</th><th>分析</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td>{item.order as number ?? i + 1}</td>
            <td>{item.code as string}</td>
            <td>{item.name as string}</td>
            <td>{item.rate as number}</td>
            <td className={changeCls(item.rise_and_fall as number)}>
              {fmt(item.rise_and_fall as number)}%
            </td>
            <td>{item.hot_rank_chg as number ?? '-'}</td>
            <td style={{ fontSize: 12 }}>{(item.popularity_tag as string) || '-'}</td>
            <td style={{ fontSize: 12, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(item.concepts as string[])?.join('、') ?? '-'}
            </td>
            <td style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {(item.analyse_title as string) || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 模块11/12: 同花顺热门概念/行业（复用）
function ThsHotPlatePanel({ data, type }: { data: Record<string, unknown>[] | null; type: 'concept' | 'industry' }) {
  if (!data?.length) return <p>暂无数据</p>;
  const label = type === 'concept' ? '概念' : '行业';
  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>#</th><th>{label}名</th><th>热度</th><th>涨跌幅</th>
          <th>标签</th><th>热度标签</th><th>关联ETF</th>
        </tr>
      </thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td>{item.order as number ?? i + 1}</td>
            <td style={{ fontWeight: 600 }}>{item.name as string}</td>
            <td>{item.rate as number}</td>
            <td className={changeCls(item.rise_and_fall as number)}>
              {fmt(item.rise_and_fall as number)}%
            </td>
            <td style={{ fontSize: 12 }}>{(item.tag as string) || '-'}</td>
            <td style={{ fontSize: 12 }}>{(item.hot_tag as string) || '-'}</td>
            <td style={{ fontSize: 12 }}>{(item.etf_name as string) || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 打板分析（溢价率 + 晋级率 + 封单）
function LimitAnalysisPanel({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <p>暂无数据</p>;

  const ps = data.premium_summary as Record<string, number> | null;
  const premiumDetails = (data.premium_details ?? []) as Record<string, unknown>[];
  const promotion = data.promotion as Record<string, unknown> | null;
  const ss = data.seal_stats as Record<string, number> | null;
  const sealDetails = (data.seal_details ?? []) as Record<string, unknown>[];

  return (
    <>
      {/* 概览指标 */}
      <div className={s.metricGrid}>
        {ps && (
          <>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>昨日涨停数</div>
              <div className={s.metricValue}>{ps.yesterday_limit_count ?? '-'}</div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>有溢价比例</div>
              <div className={`${s.metricValue} ${(ps.premium_rate ?? 0) >= 50 ? s.up : s.down}`}>
                {fmt(ps.premium_rate)}%
              </div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>平均溢价率</div>
              <div className={`${s.metricValue} ${changeCls(ps.avg_premium ?? 0)}`}>
                {fmt(ps.avg_premium)}%
              </div>
            </div>
          </>
        )}
        {promotion && (
          <>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>首板晋级率</div>
              <div className={`${s.metricValue} ${(promotion.rate as number ?? 0) >= 20 ? s.up : s.down}`}>
                {fmt(promotion.rate as number)}%
              </div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>晋级数/昨日涨停</div>
              <div className={s.metricValue}>
                {promotion.promoted_count as number ?? 0}/{promotion.yesterday_count as number ?? 0}
              </div>
            </div>
          </>
        )}
        {ss && (
          <>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>封单总额</div>
              <div className={`${s.metricValue} ${s.up}`}>{fmt(ss.total_seal_fund, 1)}亿</div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>平均封单</div>
              <div className={s.metricValue}>{fmt(ss.avg_seal_fund)}亿</div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>一字板数</div>
              <div className={s.metricValue}>{ss.yizi_count ?? 0}</div>
            </div>
            <div className={s.metricCard}>
              <div className={s.metricLabel}>早盘封板数</div>
              <div className={s.metricValue}>{ss.early_seal_count ?? 0}</div>
            </div>
          </>
        )}
      </div>

      {/* 晋级个股 */}
      {promotion && (promotion.promoted_stocks as string[])?.length > 0 && (
        <>
          <div className={s.subTitle}>晋级个股</div>
          <div className={s.promotedChips}>
            {(promotion.promoted_stocks as string[]).map((name, i) => (
              <span key={i} className={s.leaderChip}>{name}</span>
            ))}
          </div>
        </>
      )}

      {/* 溢价明细 */}
      {premiumDetails.length > 0 && (
        <>
          <div className={s.subTitle}>昨日涨停今日表现</div>
          <table className={s.table}>
            <thead>
              <tr><th>代码</th><th>名称</th><th>今日涨跌幅</th><th>连板数</th></tr>
            </thead>
            <tbody>
              {premiumDetails.map((item, i) => (
                <tr key={i}>
                  <td>{item.code as string}</td>
                  <td>{item.name as string}</td>
                  <td className={changeCls(item.change_pct as number)}>
                    {fmt(item.change_pct as number)}%
                  </td>
                  <td>{(item.continuous_limit as number) || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 封单明细 */}
      {sealDetails.length > 0 && (
        <>
          <div className={s.subTitle}>封单明细</div>
          <table className={s.table}>
            <thead>
              <tr>
                <th>代码</th><th>名称</th><th>封板资金(亿)</th>
                <th>首次封板</th><th>最后封板</th><th>炸板次数</th>
              </tr>
            </thead>
            <tbody>
              {sealDetails.map((item, i) => (
                <tr key={i}>
                  <td>{item.code as string}</td>
                  <td>{item.name as string}</td>
                  <td className={s.up}>{fmt(item.seal_fund as number)}</td>
                  <td>{(item.first_seal_time as string) || '-'}</td>
                  <td>{(item.last_seal_time as string) || '-'}</td>
                  <td>{(item.broken_count as number) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

// 模块13: AI 总结
function SummaryPanel({ data }: { data: string | null }) {
  if (!data) return <p>AI 总结尚未生成</p>;
  return <div className={s.summaryBlock}>{data}</div>;
}
