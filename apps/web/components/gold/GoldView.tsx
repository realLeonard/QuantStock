'use client';

import PageHeader from '@/components/ui/PageHeader';
import { RecentInsightsCard, DailyGuidanceCard } from './GoldPanels';
import styles from './GoldView.module.css';

export default function GoldView() {
  return (
    <div>
      <PageHeader
        title="近期掘金"
        desc="近期投研思路、聚焦方向与每日掘金板块个股"
      />

      <div className={styles.wrap}>
        <RecentInsightsCard />
        <DailyGuidanceCard />
      </div>
    </div>
  );
}
