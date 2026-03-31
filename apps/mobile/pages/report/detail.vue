<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useReportStore } from '@/store/report';
import { useUserStore } from '@/store/user';
import { formatReportDate, isToday } from '@/utils/time';
import { checkTodayAccess, getUpgradeHint } from '@/utils/permission';
import { trackEvent } from '@/api/user';

const reportStore = useReportStore();
const userStore = useUserStore();

const reportDate = ref('');
const enterTime = ref(Date.now());

onLoad((options) => {
  if (options?.date) {
    reportDate.value = options.date;
    reportStore.loadDetail(options.date);
    enterTime.value = Date.now();
    trackEvent('view_report', {
      userId: userStore.user?.id,
      targetId: options.date,
      platform: undefined,
    });
  }
});

const report = computed(() => reportStore.currentDetail);

const isLocked = computed(() => {
  if (!reportDate.value || !isToday(reportDate.value)) return false;
  const result = checkTodayAccess(userStore.user);
  return !result.allowed;
});

const upgradeHint = computed(() => {
  const result = checkTodayAccess(userStore.user);
  return getUpgradeHint(result.reason);
});

function goBack() {
  const duration = Date.now() - enterTime.value;
  trackEvent('leave_report', {
    userId: userStore.user?.id,
    targetId: reportDate.value,
    durationMs: duration,
  });
  uni.navigateBack();
}

function goLogin() {
  uni.navigateTo({ url: '/pages/auth/login?from=report' });
}
</script>

<template>
  <view class="container">
    <view class="nav-bar">
      <view class="nav-back" @tap="goBack">
        <text class="nav-chevron">‹</text>
        <text class="nav-label">早报</text>
      </view>
      <text class="nav-title">日报详情</text>
      <view class="nav-spacer" />
    </view>

    <view v-if="reportStore.detailLoading" class="loading-wrap">
      <view class="loading-ring" />
      <text class="loading-text">加载中</text>
    </view>

    <view v-else-if="report" class="content">
      <view class="report-header">
        <text class="report-date">{{ formatReportDate(report.report_date) }}</text>
        <view class="report-type-tag" :class="`report-type-tag--${report.report_type}`">
          <text>{{ report.report_type === 'weekly' ? '周报' : '日报' }}</text>
        </view>
      </view>

      <view class="summary-card">
        <view class="summary-card-head">
          <text class="summary-card-label">今日摘要</text>
        </view>
        <text class="summary-card-text">{{ report.summary }}</text>
      </view>

      <view v-if="isLocked" class="paywall">
        <text class="paywall-icon">🔒</text>
        <text class="paywall-title">今日内容仅限会员</text>
        <text class="paywall-hint">{{ upgradeHint }}</text>
        <view class="paywall-btn" @tap="goLogin">
          <text class="paywall-btn-text">
            {{ userStore.isLoggedIn ? '立即升级会员' : '登录 / 注册' }}
          </text>
        </view>
        <text class="paywall-trial">注册即享 3 天免费试用</text>
      </view>

      <view v-if="!isLocked" class="markdown-wrap">
        <text class="markdown-text">{{ report.content }}</text>
      </view>

      <view class="disclaimer">
        <text class="disclaimer-text">本报告仅供参考，不构成投资建议。投资有风险，入市需谨慎。</text>
      </view>
    </view>

    <view v-else class="empty">
      <text class="empty-icon">📄</text>
      <text class="empty-text">暂无该日报数据</text>
    </view>
  </view>
</template>

<style lang="scss">
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

.container {
  min-height: 100vh;
  background: $d-bg;
}

.nav-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx $spacing-md 16rpx;
  background: rgba(0, 0, 0, 0.9);
  border-bottom: 1rpx solid $d-border;
}

.nav-back {
  display: flex;
  align-items: center;
  gap: 4rpx;
  min-width: 120rpx;

  &:active { opacity: 0.6; }
}

.nav-chevron {
  font-size: 52rpx;
  color: $d-accent;
  line-height: 1;
  margin-top: -4rpx;
}

.nav-label {
  font-size: 28rpx;
  color: $d-accent;
  font-weight: 500;
}

.nav-title {
  font-size: 30rpx;
  font-weight: 600;
  color: $d-text;
}

.nav-spacer {
  min-width: 120rpx;
}

.loading-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
  padding-top: 240rpx;
}

.loading-ring {
  width: 64rpx;
  height: 64rpx;
  border: 4rpx solid $d-border;
  border-top-color: $d-accent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  font-size: 26rpx;
  color: $d-text-muted;
}

.content {
  padding: $spacing-md $spacing-md 64rpx;
}

.report-header {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-bottom: $spacing-md;
  padding-top: $spacing-xs;
}

.report-date {
  font-size: 34rpx;
  font-weight: 700;
  color: $d-text;
}

.report-type-tag {
  padding: 6rpx 18rpx;
  border-radius: 100rpx;
  font-size: 22rpx;
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

.summary-card {
  background: $d-card;
  border-radius: $radius-lg;
  overflow: hidden;
  margin-bottom: $spacing-md;
  border: 1rpx solid $d-border;

  &-head {
    background: $d-accent-muted;
    padding: 14rpx $spacing-md;
    border-bottom: 1rpx solid rgba(255, 107, 0, 0.10);
  }

  &-label {
    font-size: 22rpx;
    font-weight: 700;
    color: $d-accent;
    letter-spacing: 1rpx;
  }

  &-text {
    display: block;
    font-size: 30rpx;
    color: $d-text;
    line-height: 1.7;
    padding: $spacing-md;
  }
}

.paywall {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: $d-card;
  border-radius: $radius-xl;
  padding: 64rpx $spacing-xl $spacing-xl;
  margin: $spacing-md 0;
  border: 1rpx solid $d-border;
  text-align: center;

  &-icon {
    font-size: 72rpx;
    margin-bottom: $spacing-md;
  }

  &-title {
    display: block;
    font-size: 34rpx;
    font-weight: 700;
    color: $d-text;
    margin-bottom: $spacing-sm;
  }

  &-hint {
    display: block;
    font-size: 26rpx;
    color: $d-text-sub;
    margin-bottom: $spacing-xl;
    line-height: 1.5;
  }

  &-btn {
    width: 100%;
    background: $d-accent;
    border-radius: 100rpx;
    padding: 26rpx 0;
    margin-bottom: $spacing-sm;

    &:active { opacity: 0.85; }

    &-text {
      font-size: 32rpx;
      font-weight: 700;
      color: #fff;
    }
  }

  &-trial {
    font-size: 22rpx;
    color: $d-text-muted;
  }
}

.markdown-wrap {
  background: $d-card;
  border-radius: $radius-lg;
  padding: $spacing-md;
  border: 1rpx solid $d-border;
  margin-bottom: $spacing-md;
}

.markdown-text {
  font-size: 28rpx;
  color: $d-text-sub;
  line-height: 1.85;
  white-space: pre-wrap;
}

.disclaimer {
  padding: $spacing-md;
  background: $d-card;
  border-radius: $radius-md;
  border: 1rpx solid $d-border;

  &-text {
    font-size: 22rpx;
    color: $d-text-faint;
    line-height: 1.6;
    text-align: center;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding-top: 240rpx;

  &-icon { font-size: 80rpx; }
  &-text { font-size: 28rpx; color: $d-text-muted; }
}
</style>
