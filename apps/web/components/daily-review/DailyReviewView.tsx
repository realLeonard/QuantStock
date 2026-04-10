'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import DetailBackBar from '@/components/ui/DetailBackBar';
import type { DailyReview } from '@quantstock/types';
import s from './DailyReviewView.module.css';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  success: { label: '完整', cls: s.statusSuccess },
  partial: { label: '部分', cls: s.statusPartial },
  failed: { label: '失败', cls: s.statusFailed },
};

const TABS = [
  { key: 'overview', label: '大盘概览' },
  { key: 'sentiment', label: '市场情绪' },
  { key: 'hot', label: '热门股' },
  { key: 'ladder', label: '连板天梯' },
  { key: 'dragon', label: '龙虎榜' },
  { key: 'industry', label: '行业分布' },
  { key: 'limitIndustry', label: '涨跌停分布' },
  { key: 'sectorFlow', label: '板块资金' },
  { key: 'stockFlow', label: '个股资金' },
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
        {reviews.map(r => {
          const st = STATUS_MAP[r.status] ?? STATUS_MAP.success;
          const sentiment = r.market_sentiment as Record<string, number> | null;
          const overview = r.market_overview as Record<string, unknown> | null;
          const volume = overview?.volume as Record<string, number> | null;
          return (
            <div key={r.id} className={s.card} onClick={() => onSelect(r.id)}>
              <div className={s.cardHeader}>
                <span className={s.cardDate}>{r.report_date}</span>
                <span className={`${s.cardStatus} ${st.cls}`}>{st.label}</span>
              </div>
              <div className={s.cardMeta}>
                {sentiment && <span>涨停 {sentiment.limit_up ?? '-'} / 跌停 {sentiment.limit_down ?? '-'}</span>}
                {sentiment && <span>炸板率 {sentiment.broken_rate ?? '-'}%</span>}
                {volume?.today != null && <span>成交额 {volume.today}亿</span>}
                {r.ai_summary && <span>已生成 AI 总结</span>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===== 详情页 =====
function DetailView({ review, onBack }: { review: DailyReview; onBack: () => void }) {
  const [activeTab, setActiveTab] = useState('overview');

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

      <div className={s.panel}>
        {activeTab === 'overview' && <OverviewPanel data={review.market_overview} />}
        {activeTab === 'sentiment' && <SentimentPanel data={review.market_sentiment} />}
        {activeTab === 'hot' && <HotStocksPanel data={review.hot_stocks} />}
        {activeTab === 'ladder' && <LadderPanel data={review.limit_up_ladder} />}
        {activeTab === 'dragon' && <DragonPanel data={review.dragon_tiger} />}
        {activeTab === 'industry' && <IndustryPanel data={review.industry_distribution} />}
        {activeTab === 'limitIndustry' && <LimitIndustryPanel data={review.limit_industry_distribution} />}
        {activeTab === 'sectorFlow' && <FlowPanel data={review.sector_fund_flow} type="sector" />}
        {activeTab === 'stockFlow' && <FlowPanel data={review.stock_fund_flow} type="stock" />}
        {activeTab === 'summary' && <SummaryPanel data={review.ai_summary} />}
      </div>
    </div>
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

// 模块1: 大盘概览
function OverviewPanel({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <p>暂无数据</p>;
  const indices = (data.indices ?? []) as Record<string, unknown>[];
  const nb = data.north_bound as Record<string, number> | null;
  const margin = data.margin as Record<string, number> | null;
  const volume = data.volume as Record<string, number> | null;

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
          <div className={s.metricLabel}>北向资金今日</div>
          <div className={`${s.metricValue} ${changeCls(nb?.today ?? 0)}`}>{fmt(nb?.today)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>北向近5日累计</div>
          <div className={`${s.metricValue} ${changeCls(nb?.recent_5d ?? 0)}`}>{fmt(nb?.recent_5d)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>融资余额</div>
          <div className={s.metricValue}>{fmt(margin?.balance)}亿</div>
        </div>
        <div className={s.metricCard}>
          <div className={s.metricLabel}>融资余额变化</div>
          <div className={`${s.metricValue} ${changeCls(margin?.change ?? 0)}`}>{fmt(margin?.change)}亿</div>
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
    </>
  );
}

// 模块2: 市场情绪
function SentimentPanel({ data }: { data: Record<string, unknown> | null }) {
  if (!data) return <p>暂无数据</p>;
  const d = data as Record<string, number>;
  return (
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
  );
}

// 模块3: 热门股 TOP20
function HotStocksPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <table className={s.table}>
      <thead><tr><th>#</th><th>代码</th><th>名称</th><th>现价</th><th>涨跌幅</th><th>换手率</th></tr></thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td>{item.rank as number ?? i + 1}</td>
            <td>{item.code as string}</td>
            <td>{item.name as string}</td>
            <td>{fmt(item.price as number)}</td>
            <td className={changeCls(item.change_pct as number)}>{fmt(item.change_pct as number)}%</td>
            <td>{fmt(item.turnover_rate as number)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 模块4: 连板天梯
function LadderPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <table className={s.table}>
      <thead><tr><th>代码</th><th>名称</th><th>现价</th><th>涨幅</th><th>连板数</th><th>行业</th></tr></thead>
      <tbody>
        {data.map((item, i) => (
          <tr key={i}>
            <td>{item.code as string}</td>
            <td>{item.name as string}</td>
            <td>{fmt(item.price as number)}</td>
            <td className={changeCls(item.change_pct as number)}>{fmt(item.change_pct as number)}%</td>
            <td style={{ fontWeight: 700, color: '#dc2626' }}>{item.continuous_limit as number}</td>
            <td>{(item.industries as string[])?.join(' / ') ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
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

// 模块6: 行业分布统计
function IndustryPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
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
  );
}

// 模块7: 涨跌停行业分布
function LimitIndustryPanel({ data }: { data: Record<string, unknown>[] | null }) {
  if (!data?.length) return <p>暂无数据</p>;
  return (
    <table className={s.table}>
      <thead>
        <tr><th>行业</th><th>涨停</th><th>跌停</th><th>涨停代表股</th><th>跌停代表股</th></tr>
      </thead>
      <tbody>
        {data.map((item, i) => {
          const upStocks = (item.limit_up_stocks as Record<string, string>[]) ?? [];
          const downStocks = (item.limit_down_stocks as Record<string, string>[]) ?? [];
          return (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{item.industry as string}</td>
              <td className={s.up}>{item.limit_up_count as number ?? 0}</td>
              <td className={s.down}>{item.limit_down_count as number ?? 0}</td>
              <td style={{ fontSize: 12 }}>
                {upStocks.map(st => st.name).join('、') || '-'}
              </td>
              <td style={{ fontSize: 12 }}>
                {downStocks.map(st => st.name).join('、') || '-'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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

// 模块10: AI 总结
function SummaryPanel({ data }: { data: string | null }) {
  if (!data) return <p>AI 总结尚未生成</p>;
  return <div className={s.summaryBlock}>{data}</div>;
}
