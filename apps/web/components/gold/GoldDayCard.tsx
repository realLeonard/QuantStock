'use client';

import { useState } from 'react';
import type { DailyGoldPick } from '@quantstock/types';
import styles from './GoldView.module.css';

interface Props {
  pick: DailyGoldPick;
}

export default function GoldDayCard({ pick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sectors = pick.sectors || [];

  return (
    <div className={styles.dayCard}>
      <div className={styles.dayCardHeader} onClick={() => setExpanded(v => !v)}>
        <span className={styles.dayDate}>{pick.pick_date}</span>
        <span className={styles.daySectorCount}>共 {sectors.length} 个板块</span>
        <div className={styles.sectorChipList}>
          {sectors.slice(0, 6).map((s, i) => (
            <span key={i} className={styles.sectorChip}>{s.name}</span>
          ))}
          {sectors.length > 6 && (
            <span className={styles.sectorChip}>+{sectors.length - 6}</span>
          )}
        </div>
        <span className={`${styles.expandIcon}${expanded ? ' ' + styles.expanded : ''}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </span>
      </div>

      {expanded && (
        <div className={styles.dayCardBody}>
          {sectors.length === 0 ? (
            <span className={styles.emptyText}>暂无板块数据</span>
          ) : sectors.map((sector, i) => (
            <div key={i} className={styles.sectorBlock}>
              <div className={styles.sectorName}>{sector.name}</div>
              <div className={styles.stockList}>
                {(sector.stocks || []).map((stock, j) => (
                  <div key={j} className={styles.stockRow}>
                    <span className={styles.stockCode}>{stock.code}</span>
                    <span className={styles.stockName}>{stock.name}</span>
                    {stock.comment && (
                      <span className={styles.stockComment}>— {stock.comment}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
