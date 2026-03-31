<script setup lang="ts">
import { onMounted } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';

onShow(() => { uni.showTabBar(); });
import { useReportStore } from '@/store/report';
import { useUserStore } from '@/store/user';
import { formatReportDate, isToday } from '@/utils/time';
import type { DailyReport } from '@/types';

const reportStore = useReportStore();
const userStore = useUserStore();

onMounted(() => {
  reportStore.loadFirstPage();
});

onPullDownRefresh(async () => {
  await reportStore.loadFirstPage();
  uni.stopPullDownRefresh();
});

onReachBottom(() => {
  reportStore.loadNextPage();
});

function goDetail(report: DailyReport) {
  const today = isToday(report.report_date);
  if (today && !userStore.canViewTodayContent) {
    uni.navigateTo({ url: '/pages/auth/login?from=report' });
    return;
  }
  uni.navigateTo({ url: `/pages/report/detail?date=${report.report_date}` });
}

function getTypeLabel(type: string): string {
  return type === 'weekly' ? '周报' : '日报';
}
</script>

<template>
  <view class="container">
    <!-- 骨架屏 -->
    <view v-if="reportStore.loading && reportStore.list.length === 0" class="skeleton">
      <view v-for="i in 5" :key="i" class="skeleton-card" />
    </view>

    <!-- 列表 -->
    <view v-else-if="reportStore.list.length > 0" class="list">
      <view
        v-for="report in reportStore.list"
        :key="report.id"
        class="card"
        :class="{ 'card--today': isToday(report.report_date) }"
        @tap="goDetail(report)"
      >
        <view class="card-top">
          <view class="card-top-left">
            <text class="card-date">{{ formatReportDate(report.report_date) }}</text>
            <view class="card-type-tag" :class="`card-type-tag--${report.report_type}`">
              <text>{{ getTypeLabel(report.report_type) }}</text>
            </view>
          </view>
          <view class="card-top-right">
            <view v-if="isToday(report.report_date) && !userStore.canViewTodayContent" class="lock-tag">
              <text class="lock-tag-text">🔒 会员</text>
            </view>
            <view v-if="isToday(report.report_date)" class="today-tag">
              <text class="today-tag-text">今日</text>
            </view>
          </view>
        </view>

        <text
          class="card-summary"
          :class="{ 'card-summary--muted': isToday(report.report_date) && !userStore.canViewTodayContent }"
        >
          {{ report.summary || '点击查看完整早报内容' }}
        </text>

        <view class="card-footer">
          <text class="card-footer-hint">查看完整早报</text>
          <text class="card-arrow">›</text>
        </view>
      </view>

      <view class="load-more">
        <text v-if="reportStore.loading" class="load-more-text">加载中...</text>
        <text v-else-if="!reportStore.hasMore" class="load-more-end">— 已加载全部 —</text>
      </view>
    </view>

    <view v-else-if="!reportStore.loading" class="empty">
      <text class="empty-icon">📋</text>
      <text class="empty-title">暂无早报数据</text>
      <text class="empty-hint">下拉刷新重试</text>
    </view>
  </view>
</template>

<style lang="scss">
// Local design tokens
$d-bg: #000000;
$d-card: #1C1C1E;
$d-elevated: #2C2C2E;
$d-accent: #FF6B00;
$d-accent-light: #FF9640;
$d-accent-muted: rgba(255, 107, 0, 0.15);
$d-blue: #0A84FF;
$d-text: #FFFFFF;
$d-text-sub: rgba(235, 235, 245, 0.60);
$d-text-muted: rgba(235, 235, 245, 0.30);
$d-text-faint: rgba(235, 235, 245, 0.16);
$d-border: rgba(255, 255, 255, 0.08);
$d-border-light: rgba(255, 255, 255, 0.05);

.container {
  min-height: 100vh;
  background: $d-bg;
}

.list {
  padding: $spacing-md;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.card {
  background: $d-card;
  border-radius: $radius-lg;
  padding: $spacing-md $spacing-lg;
  border: 1rpx solid $d-border;
  position: relative;
  overflow: hidden;

  &:active { opacity: 0.7; }

  &--today {
    border-color: rgba(255, 107, 0, 0.25);
  }

  &-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: $spacing-sm;

    &-left {
      display: flex;
      align-items: center;
      gap: $spacing-xs;
    }

    &-right {
      display: flex;
      align-items: center;
      gap: $spacing-xs;
    }
  }

  &-date {
    font-size: 28rpx;
    font-weight: 600;
    color: $d-text;
  }

  &-type-tag {
    padding: 4rpx 14rpx;
    border-radius: 100rpx;
    font-size: 20rpx;
    font-weight: 500;

    &--trading {
      background: rgba(10, 132, 255, 0.15);
      color: $d-blue;
    }

    &--weekly {
      background: $d-accent-muted;
      color: $d-accent;
    }
  }

  &-summary {
    display: block;
    font-size: 28rpx;
    color: $d-text-sub;
    line-height: 1.65;
    margin-bottom: $spacing-sm;

    &--muted {
      color: $d-text-muted;
      font-style: italic;
    }
  }

  &-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: $spacing-xs;
    border-top: 1rpx solid $d-border-light;
  }

  &-footer-hint {
    font-size: 22rpx;
    color: $d-text-faint;
  }

  &-arrow {
    font-size: 36rpx;
    color: $d-text-muted;
    line-height: 1;
  }
}

.today-tag {
  background: $d-accent;
  padding: 4rpx 16rpx;
  border-radius: 100rpx;

  &-text {
    font-size: 20rpx;
    font-weight: 700;
    color: #fff;
  }
}

.lock-tag {
  &-text {
    font-size: 20rpx;
    color: $d-text-muted;
  }
}

.load-more {
  padding: $spacing-xl 0 64rpx;
  text-align: center;

  &-text, &-end {
    font-size: 24rpx;
    color: $d-text-faint;
    letter-spacing: 2rpx;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 240rpx;
  gap: 12rpx;

  &-icon { font-size: 80rpx; }

  &-title {
    font-size: 32rpx;
    font-weight: 600;
    color: $d-text-sub;
  }

  &-hint {
    font-size: 24rpx;
    color: $d-text-muted;
  }
}

.skeleton {
  padding: $spacing-md;
  display: flex;
  flex-direction: column;
  gap: 16rpx;

  &-card {
    height: 180rpx;
    background: $d-card;
    border-radius: $radius-lg;
    border: 1rpx solid $d-border;
  }
}
</style>
