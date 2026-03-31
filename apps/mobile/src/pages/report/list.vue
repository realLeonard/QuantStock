<script setup lang="ts">
import { onMounted } from 'vue';
import { onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app';
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
    // 引导登录/升级
    uni.navigateTo({ url: '/src/pages/auth/login?from=report' });
    return;
  }
  uni.navigateTo({ url: `/src/pages/report/detail?date=${report.report_date}` });
}

function getTypeLabel(type: string): string {
  return type === 'weekly' ? '周报' : '日报';
}
</script>

<template>
  <view class="container">
    <!-- 顶部标题 -->
    <view class="header">
      <text class="header-title">股海早报</text>
      <text class="header-sub">A股投资日报 · 每日精华</text>
    </view>

    <!-- 列表 -->
    <view v-if="reportStore.list.length > 0" class="list">
      <view
        v-for="report in reportStore.list"
        :key="report.id"
        class="card"
        :class="{ 'card--today': isToday(report.report_date) }"
        @tap="goDetail(report)"
      >
        <!-- 卡片头部 -->
        <view class="card-header">
          <view class="card-header-left">
            <text class="card-date">{{ formatReportDate(report.report_date) }}</text>
            <view class="card-type-badge" :class="`card-type-badge--${report.report_type}`">
              <text>{{ getTypeLabel(report.report_type) }}</text>
            </view>
          </view>
          <!-- 当日锁定标记 -->
          <view v-if="isToday(report.report_date) && !userStore.canViewTodayContent" class="lock-badge">
            <text class="lock-icon">🔒</text>
            <text class="lock-text">会员可见</text>
          </view>
          <view v-if="isToday(report.report_date)" class="today-badge">
            <text>今日</text>
          </view>
        </view>

        <!-- 摘要 -->
        <text class="card-summary" :class="{ 'card-summary--locked': isToday(report.report_date) && !userStore.canViewTodayContent }">
          {{ report.summary || '点击查看完整早报内容' }}
        </text>

        <!-- 箭头 -->
        <view class="card-arrow">
          <text class="arrow-icon">›</text>
        </view>
      </view>

      <!-- 加载更多 -->
      <view class="load-more">
        <text v-if="reportStore.loading" class="load-more-text">加载中...</text>
        <text v-else-if="!reportStore.hasMore" class="load-more-text load-more-text--end">已经到底了</text>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-else-if="!reportStore.loading" class="empty">
      <text class="empty-icon">📋</text>
      <text class="empty-text">暂无早报数据</text>
    </view>

    <!-- 首次加载骨架屏 -->
    <view v-if="reportStore.loading && reportStore.list.length === 0" class="skeleton">
      <view v-for="i in 5" :key="i" class="skeleton-card" />
    </view>
  </view>
</template>

<style lang="scss">
@import '@/uni.scss';

.container {
  min-height: 100vh;
  background: $color-bg-deep;
  padding: $spacing-md;
}

.header {
  padding: $spacing-xl 0 $spacing-lg;

  &-title {
    display: block;
    font-size: 56rpx;
    font-weight: 700;
    color: $color-text-primary;
    letter-spacing: 2rpx;
  }

  &-sub {
    display: block;
    font-size: 26rpx;
    color: $color-text-secondary;
    margin-top: 8rpx;
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
}

.card {
  background: $color-bg-card;
  border-radius: $radius-lg;
  padding: $spacing-md $spacing-lg;
  border: 1rpx solid $color-border;
  position: relative;
  transition: opacity 0.2s;

  &:active {
    opacity: 0.8;
  }

  &--today {
    border-color: rgba(212, 175, 55, 0.4);
    background: linear-gradient(135deg, #0d1f3c 0%, #132244 100%);
  }

  &-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: $spacing-sm;

    &-left {
      display: flex;
      align-items: center;
      gap: $spacing-xs;
    }
  }

  &-date {
    font-size: 28rpx;
    color: $color-text-primary;
    font-weight: 600;
  }

  &-type-badge {
    padding: 4rpx 12rpx;
    border-radius: 100rpx;
    font-size: 20rpx;

    &--trading {
      background: rgba(45, 124, 246, 0.2);
      color: #5b9ffa;
    }

    &--weekly {
      background: rgba(212, 175, 55, 0.2);
      color: $color-gold;
    }
  }

  &-summary {
    display: block;
    font-size: 28rpx;
    color: $color-text-secondary;
    line-height: 1.6;
    padding-right: 60rpx;

    &--locked {
      color: $color-text-muted;
    }
  }

  &-arrow {
    position: absolute;
    right: $spacing-lg;
    top: 50%;
    transform: translateY(-50%);
    color: $color-text-muted;
    font-size: 40rpx;
  }
}

.today-badge {
  background: $color-gold;
  padding: 4rpx 14rpx;
  border-radius: 100rpx;

  text {
    font-size: 20rpx;
    color: #0a1628;
    font-weight: 700;
  }
}

.lock-badge {
  display: flex;
  align-items: center;
  gap: 4rpx;

  &-icon {
    font-size: 20rpx;
  }

  &-text {
    font-size: 20rpx;
    color: $color-text-muted;
  }
}

.load-more {
  padding: $spacing-lg 0;
  text-align: center;

  &-text {
    font-size: 24rpx;
    color: $color-text-muted;

    &--end {
      color: $color-text-muted;
    }
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;

  &-icon {
    font-size: 80rpx;
    margin-bottom: $spacing-md;
  }

  &-text {
    font-size: 28rpx;
    color: $color-text-muted;
  }
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;

  &-card {
    height: 160rpx;
    background: linear-gradient(90deg, $color-bg-card 25%, $color-bg-surface 50%, $color-bg-card 75%);
    border-radius: $radius-lg;
    animation: shimmer 1.5s infinite;
    background-size: 400% 100%;
  }
}

@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
</style>
