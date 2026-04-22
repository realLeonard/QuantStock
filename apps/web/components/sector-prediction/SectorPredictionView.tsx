'use client';

import React, { useState, useMemo } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import DetailBackBar from '@/components/ui/DetailBackBar';
import type {
  SectorScore, SectorDaily, SectorRotationMap,
  SectorPredictionSummary, SectorSignal, MarketEmotionPhase,
} from '@quantstock/types';
import s from './SectorPredictionView.module.css';

// ===== 信号中文映射 =====
const SIGNAL_LABEL: Record<SectorSignal, string> = {
  strong_buy: '强买',
  buy: '买入',
  hold: '持有',
  sell: '卖出',
  watch: '观察',
  avoid: '规避',
  risk: '风险',
};
const SIGNAL_CLS: Record<SectorSignal, string> = {
  strong_buy: s.signalStrongBuy,
  buy: s.signalBuy,
  hold: s.signalHold,
  sell: s.signalSell,
  watch: s.signalWatch,
  avoid: s.signalAvoid,
  risk: s.signalRisk,
};

// ===== 市场环境中文映射 =====
const PHASE_LABEL: Record<MarketEmotionPhase, string> = {
  strong: '强势',
  neutral: '中性',
  weak: '弱势',
  extreme: '极端',
};
const PHASE_CLS: Record<MarketEmotionPhase, string> = {
  strong: s.phaseStrong,
  neutral: s.phaseNeutral,
  weak: s.phaseWeak,
  extreme: s.phaseExtreme,
};
const ENV_CLS: Record<MarketEmotionPhase, string> = {
  strong: s.envStrong,
  neutral: s.envNeutral,
  weak: s.envWeak,
  extreme: s.envExtreme,
};
// ===== 生命周期阶段配置 =====
const LIFECYCLE_STAGES = [
  { key: '萌芽', cls: s.stageMengya, color: '#1d4ed8', bg: '#dbeafe' },
  { key: '启动', cls: s.stageQidong, color: '#166534', bg: '#dcfce7' },
  { key: '发酵', cls: s.stageFajiao, color: '#92400e', bg: '#fef3c7' },
  { key: '主升', cls: s.stageZhusheng, color: '#dc2626', bg: '#fee2e2' },
  { key: '分歧', cls: s.stageFenqi, color: '#6d28d9', bg: '#ede9fe' },
  { key: '退潮', cls: s.stageTuichao, color: '#475569', bg: '#f1f5f9' },
  { key: '观察', cls: s.stageGuancha, color: '#64748b', bg: '#e5e7eb' },
];

const ENV_DESC: Record<MarketEmotionPhase, string> = {
  strong: '市场情绪积极，板块轮动活跃，适合积极布局',
  neutral: '市场情绪平稳，结构性机会为主，精选方向',
  weak: '市场情绪低迷，防守为主，控制仓位',
  extreme: '市场情绪极端，警惕风险，观望等待',
};

const TABS = [
  { key: 'overview', label: '全览' },
  { key: 'scores', label: '评分明细' },
  { key: 'fund-flow', label: '资金暗流' },
  { key: 'kline', label: 'K线数据' },
  { key: 'limit-stats', label: '涨跌停统计' },
  { key: 'rotation', label: '产业链图' },
];

// ===== 入口组件 =====
export default function SectorPredictionView() {
  const {
    sectorPredictionDays, currentSectorDate, setCurrentSectorDate,
    sectorScores, sectorDaily, sectorRotationMap, loadSectorDetail,
  } = useAppStore();

  function handleSelect(date: string) {
    setCurrentSectorDate(date);
    loadSectorDetail(date);
  }

  if (currentSectorDate) {
    return (
      <DetailView
        date={currentSectorDate}
        scores={sectorScores}
        daily={sectorDaily}
        rotationMap={sectorRotationMap}
        onBack={() => setCurrentSectorDate(null)}
      />
    );
  }

  return <ListView days={sectorPredictionDays} onSelect={handleSelect} />;
}

// ===== 列表页 =====
function ListView({
  days, onSelect,
}: {
  days: SectorPredictionSummary[];
  onSelect: (date: string) => void;
}) {
  if (!days.length) {
    return (
      <>
        <PageHeader title="板块预测" desc="基于多维评分的板块预测系统，每日收盘后自动生成" />
        <div className={s.empty}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span>暂无预测数据</span>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="板块预测" desc="基于多维评分的板块预测系统，每日收盘后自动生成" />
      <div className={s.list}>
        {days.map(d => {
          const signals: Array<{ key: string; cls: string; label: string; count: number }> = [
            { key: 'sb', cls: s.signalStrongBuy, label: '强买', count: d.strong_buy_count },
            { key: 'b', cls: s.signalBuy, label: '买入', count: d.buy_count },
            { key: 'h', cls: s.signalHold, label: '持有', count: d.hold_count },
            { key: 'sl', cls: s.signalSell, label: '卖出', count: d.sell_count },
            { key: 'w', cls: s.signalWatch, label: '观察', count: d.watch_count },
            { key: 'a', cls: s.signalAvoid, label: '规避', count: d.avoid_count },
          ];
          return (
            <div key={d.trade_date} className={s.card} onClick={() => onSelect(d.trade_date)}>
              <div className={s.cardHeader}>
                <div className={s.cardHeaderLeft}>
                  <span className={s.cardDate}>{d.trade_date}</span>
                  <span className={`${s.phaseTag} ${PHASE_CLS[d.market_emotion_phase]}`}>
                    市场情绪 · {PHASE_LABEL[d.market_emotion_phase]}
                  </span>
                  <span className={s.cardScoreMeta}>
                    均分 {d.avg_score} · 最高 {d.max_score.toFixed(1)} · 置信度 {(d.avg_confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <span className={s.totalBadge}>共 {d.total_count} 个板块</span>
              </div>

              {/* 完整信号分布 */}
              <div className={s.cardSummary}>
                {signals.map(sig => (
                  <span key={sig.key}>
                    <span className={`${s.signalTag} ${sig.cls}`}>{sig.label}</span>
                    {sig.count}
                  </span>
                ))}
              </div>

              {/* 生命周期分布芯片（仅当存在非"观察"阶段时才显示） */}
              {LIFECYCLE_STAGES.some(st => st.key !== '观察' && d.stage_counts[st.key] > 0) && (
                <div className={s.cardStages}>
                  <span className={s.cardStagesLabel}>生命周期</span>
                  {LIFECYCLE_STAGES.map(st => {
                    const cnt = d.stage_counts[st.key];
                    return cnt ? (
                      <span key={st.key} className={`${s.cardStageChip} ${st.cls}`}>
                        {st.key} {cnt}
                      </span>
                    ) : null;
                  })}
                </div>
              )}

              {/* TOP 板块预览 */}
              {d.top_sectors.length > 0 && (
                <div className={s.cardTopSectors}>
                  <span className={s.cardTopLabel}>TOP</span>
                  {d.top_sectors.map(t => (
                    <span key={t.sector_name} className={s.cardTopItem}>
                      <span className={`${s.signalTag} ${SIGNAL_CLS[t.signal as SectorSignal] || s.signalWatch}`}>
                        {SIGNAL_LABEL[t.signal as SectorSignal] || t.signal}
                      </span>
                      {t.sector_name}
                      <span className={s.cardTopScore}>{t.total_score.toFixed(1)}分</span>
                      {t.leading_stock && (
                        <span className={s.cardTopLeader}>{t.leading_stock}</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===== 详情页 =====
function DetailView({
  date, scores, daily, rotationMap, onBack,
}: {
  date: string;
  scores: SectorScore[];
  daily: SectorDaily[];
  rotationMap: SectorRotationMap[];
  onBack: () => void;
}) {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className={s.detail}>
      <DetailBackBar title={`板块预测 · ${date}`} onBack={onBack} />

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

      {activeTab === 'overview' && <OverviewPanel scores={scores} />}
      {activeTab === 'scores' && <ScoreDetailPanel scores={scores} />}
      {activeTab === 'fund-flow' && <FundFlowPanel daily={daily} />}
      {activeTab === 'kline' && <KlinePanel daily={daily} />}
      {activeTab === 'limit-stats' && <LimitStatsPanel scores={scores} />}
      {activeTab === 'rotation' && <RotationPanel rotationMap={rotationMap} />}
    </div>
  );
}

// ===== 生命周期进度条 =====
function LifecycleBar({ stageCounts }: { stageCounts: Record<string, number> }) {
  const maxCount = Math.max(...Object.values(stageCounts), 1);
  return (
    <div className={s.lifecycleBar}>
      {LIFECYCLE_STAGES.map((stage, i) => {
        const count = stageCounts[stage.key] || 0;
        const isActive = count > 0;
        const isMax = count === maxCount && count > 0;
        return (
          <React.Fragment key={stage.key}>
            {i > 0 && <div className={s.lifecycleLine} />}
            <div className={`${s.lifecycleNode} ${isActive ? '' : s.lifecycleNodeInactive}`}>
              <span className={s.lifecycleLabel}>{stage.key}</span>
              <div
                className={`${s.lifecycleCircle} ${isMax ? s.lifecycleCircleMax : ''}`}
                style={{
                  background: isActive ? stage.bg : '#f1f5f9',
                  color: isActive ? stage.color : '#cbd5e1',
                  boxShadow: isMax ? `0 0 12px ${stage.color}33` : 'none',
                }}
              >
                {count}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ===== 全览面板 =====
function OverviewPanel({ scores }: { scores: SectorScore[] }) {
  const phase = scores[0]?.market_emotion_phase ?? 'neutral';
  const strongBuy = scores.filter(s => s.signal === 'strong_buy');
  const buy = scores.filter(s => s.signal === 'buy');
  const sell = scores.filter(s => s.signal === 'sell');
  const watch = scores.filter(s => s.signal === 'watch').slice(0, 10);
  const avoid = scores.filter(s => s.signal === 'avoid' || s.signal === 'risk');

  // 信号分布
  const signalCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sc of scores) {
      map[sc.signal] = (map[sc.signal] || 0) + 1;
    }
    return map;
  }, [scores]);

  // 生命周期分布
  const stageCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const stage of LIFECYCLE_STAGES) map[stage.key] = 0;
    for (const sc of scores) {
      const key = sc.stage || '观察';
      if (key in map) map[key]++;
      else map['观察']++;
    }
    return map;
  }, [scores]);

  return (
    <div className={s.overviewWrap}>
      {/* 市场环境指示器 */}
      <div className={`${s.envIndicator} ${ENV_CLS[phase]}`}>
        <span className={s.envLabel}>市场情绪 · {PHASE_LABEL[phase]}</span>
        <span className={s.envDesc}>{ENV_DESC[phase]}</span>
      </div>

      {/* 生命周期进度条 */}
      <LifecycleBar stageCounts={stageCounts} />

      {/* 信号分布统计 */}
      <div className={s.overviewCard} style={{ textAlign: 'center' }}>
        <div className={s.overviewCardTitle} style={{ justifyContent: 'center' }}>信号分布统计</div>
        <div className={s.signalStats}>
          {(['strong_buy', 'buy', 'hold', 'watch', 'sell', 'avoid', 'risk'] as SectorSignal[]).map(sig => (
            <div key={sig} className={s.signalStatItem}>
              <span className={`${s.signalTag} ${SIGNAL_CLS[sig]}`}>{SIGNAL_LABEL[sig]}</span>
              <span className={s.signalStatCount}>{signalCounts[sig] || 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={s.overviewGrid}>
        {/* 推荐板块 */}
        <div className={s.overviewCard}>
          <div className={s.overviewCardTitle}>
            <span className={`${s.signalTag} ${s.signalStrongBuy}`}>强买</span>
            推荐板块（{strongBuy.length}）
          </div>
          <SectorList items={strongBuy} />
        </div>

        <div className={s.overviewCard}>
          <div className={s.overviewCardTitle}>
            <span className={`${s.signalTag} ${s.signalBuy}`}>买入</span>
            推荐板块（{buy.length}）
          </div>
          <SectorList items={buy} />
        </div>

        {/* 离场板块 */}
        <div className={s.overviewCard}>
          <div className={s.overviewCardTitle}>
            <span className={`${s.signalTag} ${s.signalSell}`}>卖出</span>
            离场板块（{sell.length}）
          </div>
          <SectorList items={sell} />
        </div>

        {/* 观察板块 */}
        <div className={s.overviewCard}>
          <div className={s.overviewCardTitle}>
            <span className={`${s.signalTag} ${s.signalWatch}`}>观察</span>
            观察板块（前10）
          </div>
          <SectorList items={watch} />
        </div>

        {/* 规避/风险板块 */}
        {avoid.length > 0 && (
          <div className={s.overviewCard}>
            <div className={s.overviewCardTitle}>
              <span className={`${s.signalTag} ${s.signalRisk}`}>风险</span>
              规避板块（{avoid.length}）
            </div>
            <CollapsibleSectorList items={avoid} limit={10} />
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 板块列表小组件 =====
function SectorList({ items }: { items: SectorScore[] }) {
  if (!items.length) {
    return <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>暂无</div>;
  }
  return (
    <div className={s.sectorList}>
      {items.map(it => (
        <div key={it.sector_name} className={s.sectorItem}>
          <span className={s.sectorName}>{it.sector_name}</span>
          <span className={`${s.signalTag} ${SIGNAL_CLS[it.signal]}`}>
            {SIGNAL_LABEL[it.signal]}
          </span>
          <span className={s.sectorScore}>{(it.total_score ?? 0).toFixed(1)}分</span>
          <span className={s.sectorStage}>{it.stage}</span>
          {it.leading_stock && (
            <span className={s.sectorLeader}>{it.leading_stock}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ===== 可折叠板块列表 =====
function CollapsibleSectorList({ items, limit }: { items: SectorScore[]; limit: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) {
    return <div style={{ fontSize: 13, color: '#94a3b8', padding: '8px 0' }}>暂无</div>;
  }
  const needCollapse = items.length > limit;
  const visible = needCollapse && !expanded ? items.slice(0, limit) : items;
  return (
    <>
      <SectorList items={visible} />
      {needCollapse && (
        <button className={s.collapseBtn} onClick={() => setExpanded(v => !v)}>
          {expanded ? '收起' : `展开全部（${items.length}）`}
        </button>
      )}
    </>
  );
}

// ===== 评分明细面板 =====
function ScoreDetailPanel({ scores }: { scores: SectorScore[] }) {
  const [sortKey, setSortKey] = useState<string>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'rank' ? 'asc' : 'desc');
    }
  }

  const sorted = useMemo(() => {
    const arr = [...scores];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return 0;
    });
    return arr;
  }, [scores, sortKey, sortDir]);

  const arrow = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th onClick={() => handleSort('rank')}>排名{arrow('rank')}</th>
            <th onClick={() => handleSort('sector_name')}>板块{arrow('sector_name')}</th>
            <th onClick={() => handleSort('total_score')}>总分{arrow('total_score')}</th>
            <th onClick={() => handleSort('signal')}>信号{arrow('signal')}</th>
            <th onClick={() => handleSort('stealth_fund_score')}>资金暗流{arrow('stealth_fund_score')}</th>
            <th onClick={() => handleSort('momentum_score')}>量价蓄势{arrow('momentum_score')}</th>
            <th onClick={() => handleSort('pattern_score')}>模式匹配{arrow('pattern_score')}</th>
            <th onClick={() => handleSort('catalyst_score')}>催化剂{arrow('catalyst_score')}</th>
            <th onClick={() => handleSort('risk_adjustment')}>风险修正{arrow('risk_adjustment')}</th>
            <th onClick={() => handleSort('stage_coefficient')}>阶段系数{arrow('stage_coefficient')}</th>
            <th onClick={() => handleSort('stage')}>阶段{arrow('stage')}</th>
            <th onClick={() => handleSort('confidence')}>置信度{arrow('confidence')}</th>
            <th>龙头股</th>
            <th>时间建议</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(sc => (
            <tr key={sc.sector_name}>
              <td>{sc.rank}</td>
              <td style={{ fontWeight: 600 }}>{sc.sector_name}</td>
              <td style={{ fontWeight: 700 }}>{(sc.total_score ?? 0).toFixed(1)}</td>
              <td>
                <span className={`${s.signalTag} ${SIGNAL_CLS[sc.signal]}`}>
                  {SIGNAL_LABEL[sc.signal]}
                </span>
              </td>
              <td>{(sc.stealth_fund_score ?? 0).toFixed(1)}</td>
              <td>{(sc.momentum_score ?? 0).toFixed(1)}</td>
              <td>{(sc.pattern_score ?? 0).toFixed(1)}</td>
              <td>{(sc.catalyst_score ?? 0).toFixed(1)}</td>
              <td>{(sc.risk_adjustment ?? 0).toFixed(1)}</td>
              <td>{(sc.stage_coefficient ?? 0).toFixed(2)}</td>
              <td><span className={s.sectorStage}>{sc.stage}</span></td>
              <td>{((sc.confidence ?? 0) * 100).toFixed(0)}%</td>
              <td>{sc.leading_stock ?? '-'}</td>
              <td style={{ fontSize: 12 }}>{sc.time_horizon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== 资金暗流面板 =====
function FundFlowPanel({ daily }: { daily: SectorDaily[] }) {
  const [sortKey, setSortKey] = useState<string>('main_net_inflow');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(() => {
    const arr = [...daily];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return 0;
    });
    return arr;
  }, [daily, sortKey, sortDir]);

  const arrow = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  // 格式化金额（亿元）
  function fmtAmt(v: number): string {
    const yi = v / 1e8;
    return yi.toFixed(2) + '亿';
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th onClick={() => handleSort('sector_name')}>板块{arrow('sector_name')}</th>
            <th onClick={() => handleSort('main_net_inflow')}>主力净流入{arrow('main_net_inflow')}</th>
            <th onClick={() => handleSort('main_net_inflow_pct')}>主力净流入占比{arrow('main_net_inflow_pct')}</th>
            <th onClick={() => handleSort('super_large_net')}>超大单{arrow('super_large_net')}</th>
            <th onClick={() => handleSort('large_net')}>大单{arrow('large_net')}</th>
            <th onClick={() => handleSort('medium_net')}>中单{arrow('medium_net')}</th>
            <th onClick={() => handleSort('small_net')}>小单{arrow('small_net')}</th>
            <th>资金龙头</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(d => {
            const inflow = d.main_net_inflow ?? 0;
            const inflowPct = d.main_net_inflow_pct ?? 0;
            return (
              <tr key={d.sector_name} style={inflow > 0 ? { background: 'rgba(220,38,38,0.04)' } : undefined}>
                <td style={{ fontWeight: 600 }}>{d.sector_name}</td>
                <td className={inflow > 0 ? s.positive : inflow < 0 ? s.negative : s.flat}>
                  {fmtAmt(inflow)}
                </td>
                <td className={inflowPct > 0 ? s.positive : inflowPct < 0 ? s.negative : s.flat}>
                  {inflowPct.toFixed(2)}%
                </td>
                <td className={(d.super_large_net ?? 0) > 0 ? s.positive : s.negative}>{fmtAmt(d.super_large_net ?? 0)}</td>
                <td className={(d.large_net ?? 0) > 0 ? s.positive : s.negative}>{fmtAmt(d.large_net ?? 0)}</td>
                <td className={(d.medium_net ?? 0) > 0 ? s.positive : s.negative}>{fmtAmt(d.medium_net ?? 0)}</td>
                <td className={(d.small_net ?? 0) > 0 ? s.positive : s.negative}>{fmtAmt(d.small_net ?? 0)}</td>
                <td>{d.fund_leading_stock ?? '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===== K线数据面板 =====
function KlinePanel({ daily }: { daily: SectorDaily[] }) {
  const [sortKey, setSortKey] = useState<string>('change_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sorted = useMemo(() => {
    const arr = [...daily];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return 0;
    });
    return arr;
  }, [daily, sortKey, sortDir]);

  const arrow = (key: string) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  function fmtAmt(v: number): string {
    const yi = v / 1e8;
    return yi.toFixed(2) + '亿';
  }

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th onClick={() => handleSort('sector_name')}>板块{arrow('sector_name')}</th>
            <th onClick={() => handleSort('open')}>开盘{arrow('open')}</th>
            <th onClick={() => handleSort('close')}>收盘{arrow('close')}</th>
            <th onClick={() => handleSort('high')}>最高{arrow('high')}</th>
            <th onClick={() => handleSort('low')}>最低{arrow('low')}</th>
            <th onClick={() => handleSort('change_pct')}>涨跌幅{arrow('change_pct')}</th>
            <th onClick={() => handleSort('volume')}>成交量{arrow('volume')}</th>
            <th onClick={() => handleSort('turnover')}>成交额{arrow('turnover')}</th>
            <th onClick={() => handleSort('amplitude')}>振幅{arrow('amplitude')}</th>
            <th onClick={() => handleSort('turnover_rate')}>换手率{arrow('turnover_rate')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(d => {
            const chg = d.change_pct ?? 0;
            return (
              <tr key={d.sector_name}>
                <td style={{ fontWeight: 600 }}>{d.sector_name}</td>
                <td>{d.open?.toFixed(2) ?? '-'}</td>
                <td>{d.close?.toFixed(2) ?? '-'}</td>
                <td>{d.high?.toFixed(2) ?? '-'}</td>
                <td>{d.low?.toFixed(2) ?? '-'}</td>
                <td className={chg > 0 ? s.up : chg < 0 ? s.down : s.flat}>
                  {chg > 0 ? '+' : ''}{chg.toFixed(2)}%
                </td>
                <td>{d.volume ? (d.volume / 1e4).toFixed(0) + '万' : '-'}</td>
                <td>{d.turnover ? fmtAmt(d.turnover) : '-'}</td>
                <td>{d.amplitude?.toFixed(2) ?? '-'}%</td>
                <td>{d.turnover_rate?.toFixed(2) ?? '-'}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===== 涨跌停统计面板（从 sector_scores 取 stage + leading_stock 等信息）=====
function LimitStatsPanel({ scores }: { scores: SectorScore[] }) {
  // 按阶段分组展示
  const stageGroups = useMemo(() => {
    const map = new Map<string, SectorScore[]>();
    for (const sc of scores) {
      const key = sc.stage || '未知';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(sc);
    }
    // 按生命周期排序
    const order = ['萌芽', '启动', '发酵', '主升', '分歧', '退潮', '观察', '未知'];
    return Array.from(map.entries()).sort((a, b) => {
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    });
  }, [scores]);

  return (
    <>
      <div className={s.overviewGrid}>
        {stageGroups.map(([stage, items]) => (
          <div key={stage} className={s.overviewCard}>
            <div className={s.overviewCardTitle}>
              <span className={s.sectorStage}>{stage}</span>
              {items.length} 个板块
            </div>
            <SectorList items={items} />
          </div>
        ))}
      </div>
    </>
  );
}

// ===== 产业链图面板 =====
function RotationPanel({ rotationMap }: { rotationMap: SectorRotationMap[] }) {
  if (!rotationMap.length) {
    return (
      <div className={s.empty}>
        <span>暂无产业链数据</span>
      </div>
    );
  }

  // 按 source_sector 分组
  const groups = useMemo(() => {
    const map = new Map<string, SectorRotationMap[]>();
    for (const r of rotationMap) {
      if (!map.has(r.source_sector)) map.set(r.source_sector, []);
      map.get(r.source_sector)!.push(r);
    }
    return Array.from(map.entries());
  }, [rotationMap]);

  return (
    <div className={s.overviewGrid}>
      {groups.map(([source, edges]) => (
        <div key={source} className={s.overviewCard}>
          <div className={s.overviewCardTitle}>{source}</div>
          <div className={s.sectorList}>
            {edges.map(e => (
              <div key={e.id} className={s.sectorItem}>
                <span className={s.sectorName}>{e.target_sector}</span>
                <span className={`${s.chainBadge} ${e.relation_type === 'chain' ? s.chainType : s.corrType}`}>
                  {e.relation_type === 'chain' ? '产业链' : '相关性'}
                </span>
                {e.description && (
                  <span className={s.sectorLeader}>{e.description}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
