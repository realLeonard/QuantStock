'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useAppStore } from '@/store';
import type { MarketBreadth } from '@quantstock/types';
import styles from './BreadthView.module.css';
import PageHeader from '@/components/ui/PageHeader';

// 获取当前月份字符串，如 '2026-03'
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// 生成最近 N 个月的列表（从近到远）
function getRecentMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

// 月份格式化显示：'2026-03' → '2026年03月'
function formatMonthLabel(m: string): string {
  const [y, mo] = m.split('-');
  return `${y}年${mo}月`;
}

// 日期格式化：'2026-03-22' → '3月22日'
function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}月${parseInt(d)}日`;
}

// 情绪总结
function getSentimentText(rise: number, total: number): string {
  if (total === 0) return '';
  const ratio = rise / total;
  if (ratio >= 0.6) return '🔥 市场情绪热烈，多头主导';
  if (ratio >= 0.45) return '📈 市场情绪偏多，上涨氛围良好';
  if (ratio >= 0.35) return '🔄 市场情绪中性，涨跌分化';
  if (ratio >= 0.25) return '📉 市场情绪偏弱，下跌家数占优';
  return '❄️ 市场情绪低迷，建议谨慎';
}

// 连续两日趋势补充说明
function getConsecutiveSuffix(data: MarketBreadth[]): string {
  if (data.length < 2) return '';
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const r1 = prev.rise;
  const r2 = last.rise;

  if (r1 < 1000 && r2 < 1000) {
    return '市场连续低迷，随时关注情绪转好，适当增加仓位';
  }
  if (r1 > 4000 && r2 > 4000) {
    return '市场过于兴奋，注意控制风险，适当降低仓位';
  }
  if (r2 > r1) {
    return '连续两日上涨家数回暖，情绪逐步修复，可关注结构性机会';
  }
  if (r2 < r1) {
    return '连续两日上涨家数走弱，保持谨慎，控制仓位';
  }
  return '';
}

// 自定义 Tooltip
interface TooltipPayload {
  payload?: MarketBreadth;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const d = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{d.trade_date}</div>
      <div className={styles.tooltipRow}>
        <span className={styles.rise}>📈 上涨</span>
        <span>{d.rise} 家</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.rise}>🔝 涨停</span>
        <span>{d.limit_up} 家</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.flat}>➖ 平盘</span>
        <span>{d.flat} 家</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.fall}>📉 下跌</span>
        <span>{d.fall} 家</span>
      </div>
      <div className={styles.tooltipRow}>
        <span className={styles.fall}>🔻 跌停</span>
        <span>{d.limit_down} 家</span>
      </div>
    </div>
  );
}

export default function BreadthView() {
  const { breadthData, breadthMonth, loadBreadth } = useAppStore();
  const [selectedMode, setSelectedMode] = useState<string>(breadthMonth || 'recent30');

  // 可选月份列表（最近6个月）
  const months = useMemo(() => getRecentMonths(6), []);
  const currentMonth = getCurrentMonth();

  // 进入页面时加载数据
  useEffect(() => {
    loadBreadth(selectedMode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换模式
  function handleSelect(mode: string) {
    setSelectedMode(mode);
    loadBreadth(mode);
  }

  // 最新一天数据
  const latest = breadthData.length > 0 ? breadthData[breadthData.length - 1] : null;
  const latestTotal = latest ? latest.rise + latest.fall + latest.flat : 0;

  // 图表数据：X轴显示 MM-DD
  const chartData = breadthData.map((d) => ({
    ...d,
    day: d.trade_date.slice(5), // 'MM-DD'
  }));

  return (
    <div className={styles.container}>
      <PageHeader title="涨跌家数" desc="全市场 A 股每日上涨/下跌家数趋势" />

      {/* 最新一日统计 + 情绪解读（始终显示） */}
      <div className={styles.statsCard}>
        {latest ? (
          <>
            <div className={styles.sentimentSection}>
              <span className={styles.sentimentLabel}>{formatDateLabel(latest.trade_date)}情绪解读</span>
              <span className={styles.sentiment}>
                {getSentimentText(latest.rise, latestTotal)}
                {getConsecutiveSuffix(breadthData) && (
                  <span className={styles.sentimentSuffix}>
                    {' '}· {getConsecutiveSuffix(breadthData)}
                  </span>
                )}
              </span>
            </div>
            <div className={styles.divider} />
            <div className={styles.statsGrid}>
              <div className={`${styles.statItem} ${styles.riseColor}`}>
                <span className={styles.statLabel}>📈 上涨</span>
                <span className={styles.statValue}>{latest.rise.toLocaleString()} 家</span>
              </div>
              <div className={`${styles.statItem} ${styles.fallColor}`}>
                <span className={styles.statLabel}>📉 下跌</span>
                <span className={styles.statValue}>{latest.fall.toLocaleString()} 家</span>
              </div>
              <div className={`${styles.statItem} ${styles.riseColor}`}>
                <span className={styles.statLabel}>🔝 涨停</span>
                <span className={styles.statValue}>{latest.limit_up.toLocaleString()} 家</span>
              </div>
              <div className={`${styles.statItem} ${styles.fallColor}`}>
                <span className={styles.statLabel}>🔻 跌停</span>
                <span className={styles.statValue}>{latest.limit_down.toLocaleString()} 家</span>
              </div>
              <div className={`${styles.statItem} ${styles.flatColor}`}>
                <span className={styles.statLabel}>➖ 平盘</span>
                <span className={styles.statValue}>{latest.flat.toLocaleString()} 家</span>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.noDataStats}>
            <div className={styles.sentimentSection}>
              <span className={styles.sentimentLabel}>情绪解读</span>
              <span className={styles.sentimentEmpty}>暂无最新交易数据</span>
            </div>
            <div className={styles.divider} />
            <div className={styles.statsGrid}>
              {(['📈 上涨', '📉 下跌', '🔝 涨停', '🔻 跌停', '➖ 平盘'] as const).map((label) => (
                <div key={label} className={styles.statItem}>
                  <span className={styles.statLabel}>{label}</span>
                  <span className={styles.statValueEmpty}>— 家</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 月份切换器 */}
      <div className={styles.switcher}>
        <button
          className={`${styles.switchBtn} ${selectedMode === 'recent30' ? styles.active : ''}`}
          onClick={() => handleSelect('recent30')}
        >
          最近30天
        </button>
        {months.map((m) => (
          <button
            key={m}
            className={`${styles.switchBtn} ${selectedMode === m ? styles.active : ''}`}
            onClick={() => handleSelect(m)}
            disabled={m > currentMonth}
          >
            {formatMonthLabel(m)}
          </button>
        ))}
      </div>

      {/* 折线图 */}
      <div className={styles.chartCard}>
        {chartData.length === 0 ? (
          <div className={styles.empty}>
            <p>暂无数据</p>
            <span>该时段没有市场涨跌家数记录</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="day"
                tick={{ fill: '#718096', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#718096', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={50}
                domain={[0, 5500]}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="rise"
                stroke="#f87171"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                name="上涨家数"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
