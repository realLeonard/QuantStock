<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
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
    // 记录浏览事件
    trackEvent('view_report', {
      userId: userStore.user?.id,
      targetId: options.date,
      platform: undefined,
    });
  }
});

const report = computed(() => reportStore.currentDetail);

const isLocked = computed(() => {
  // 服务端 403 UPGRADE_REQUIRED 为准，前端 checkTodayAccess 做 UI 预判
  if (reportStore.upgradeRequired) return true;
  if (!reportDate.value || !isToday(reportDate.value)) return false;
  const result = checkTodayAccess(userStore.user);
  return !result.allowed;
});

const upgradeHint = computed(() => {
  const result = checkTodayAccess(userStore.user);
  return getUpgradeHint(result.reason);
});

function goBack() {
  // 上报停留时长
  const duration = Date.now() - enterTime.value;
  trackEvent('leave_report', {
    userId: userStore.user?.id,
    targetId: reportDate.value,
    durationMs: duration,
  });
  uni.navigateBack();
}

function goLogin() {
  uni.navigateTo({ url: '/src/pages/auth/login?from=report' });
}
</script>

<template>
  <view class="container">
    <!-- 导航栏 -->
    <view class="nav-bar">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-icon">‹</text>
        <text class="nav-back-text">日报列表</text>
      </view>
    </view>

    <!-- 内容区 -->
    <view v-if="reportStore.detailLoading" class="loading-wrap">
      <text class="loading-text">加载中...</text>
    </view>

    <view v-else-if="report" class="content">
      <!-- 报告头部 -->
      <view class="report-header">
        <text class="report-date">{{ formatReportDate(report.report_date) }}</text>
        <view class="report-type-badge" :class="`report-type-badge--${report.report_type}`">
          <text>{{ report.report_type === 'weekly' ? '周报' : '日报' }}</text>
        </view>
      </view>

      <!-- 摘要（所有人可见） -->
      <view class="summary-block">
        <text class="summary-label">今日摘要</text>
        <text class="summary-text">{{ report.summary }}</text>
      </view>

      <!-- 付费墙（仅当日 + 未登录/免费用户） -->
      <view v-if="isLocked" class="paywall">
        <view class="paywall-icon">🔒</view>
        <text class="paywall-title">当日完整内容仅限会员查看</text>
        <text class="paywall-hint">{{ upgradeHint }}</text>
        <view class="paywall-btn" @tap="goLogin">
          <text class="paywall-btn-text">
            {{ userStore.isLoggedIn ? '立即升级' : '登录 / 注册' }}
          </text>
        </view>
      </view>

      <!-- 完整内容（mp-html 渲染 Markdown） -->
      <!-- TODO: 引入 mp-html 组件渲染 Markdown，此处先用 text 占位 -->
      <view v-if="!isLocked" class="markdown-wrap">
        <!-- <mp-html :content="report.content" markdown /> -->
        <text class="markdown-placeholder">{{ report.content }}</text>
      </view>

      <!-- 免责声明（底部固定） -->
      <view class="disclaimer">
        <text class="disclaimer-text">
          本报告仅供参考，不构成投资建议。投资有风险，入市需谨慎。
        </text>
      </view>
    </view>

    <!-- 空状态 -->
    <view v-else class="empty">
      <text class="empty-text">暂无该日报数据</text>
    </view>
  </view>
</template>

<style lang="scss">
@import '@/uni.scss';

.container {
  min-height: 100vh;
  background: $color-bg-deep;
}

.nav-bar {
  padding: 20rpx $spacing-md;
  background: $color-bg-deep;
  position: sticky;
  top: 0;
  z-index: 10;

  &::after {
    content: '';
    display: block;
    height: 1rpx;
    background: $color-border;
    margin-top: 20rpx;
  }
}

.nav-back {
  display: inline-flex;
  align-items: center;
  gap: 4rpx;
  padding: 8rpx 0;

  &-icon {
    font-size: 48rpx;
    color: $color-text-secondary;
    line-height: 1;
    margin-top: -4rpx;
  }

  &-text {
    font-size: 28rpx;
    color: $color-text-secondary;
  }
}

.loading-wrap {
  display: flex;
  justify-content: center;
  padding-top: 200rpx;

  .loading-text {
    font-size: 28rpx;
    color: $color-text-muted;
  }
}

.content {
  padding: $spacing-md;
}

.report-header {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-bottom: $spacing-md;
}

.report-date {
  font-size: 36rpx;
  font-weight: 700;
  color: $color-text-primary;
}

.report-type-badge {
  padding: 6rpx 16rpx;
  border-radius: 100rpx;
  font-size: 22rpx;

  &--trading {
    background: rgba(45, 124, 246, 0.2);
    color: #5b9ffa;
  }

  &--weekly {
    background: rgba(212, 175, 55, 0.2);
    color: $color-gold;
  }
}

.summary-block {
  background: $color-bg-card;
  border-radius: $radius-lg;
  padding: $spacing-md;
  margin-bottom: $spacing-md;
  border-left: 6rpx solid $color-gold;

  &-label {
    display: block;
    font-size: 22rpx;
    color: $color-gold;
    margin-bottom: 8rpx;
    font-weight: 600;
  }

  .summary-label {
    display: block;
    font-size: 22rpx;
    color: $color-gold;
    margin-bottom: 8rpx;
    font-weight: 600;
  }

  .summary-text {
    font-size: 30rpx;
    color: $color-text-primary;
    line-height: 1.7;
  }
}

.paywall {
  background: linear-gradient(135deg, #0d1f3c 0%, #132244 100%);
  border: 1rpx solid rgba(212, 175, 55, 0.3);
  border-radius: $radius-xl;
  padding: $spacing-xl;
  text-align: center;
  margin: $spacing-lg 0;

  &-icon {
    font-size: 80rpx;
    margin-bottom: $spacing-md;
  }

  &-title {
    display: block;
    font-size: 32rpx;
    font-weight: 700;
    color: $color-text-primary;
    margin-bottom: $spacing-sm;
  }

  &-hint {
    display: block;
    font-size: 26rpx;
    color: $color-text-secondary;
    margin-bottom: $spacing-lg;
  }

  &-btn {
    background: linear-gradient(135deg, $color-gold 0%, $color-gold-light 100%);
    border-radius: 100rpx;
    padding: 20rpx $spacing-xl;
    display: inline-block;

    &:active {
      opacity: 0.85;
    }

    &-text {
      font-size: 30rpx;
      font-weight: 700;
      color: #0a1628;
    }
  }
}

.markdown-wrap {
  padding: $spacing-sm 0;
}

.markdown-placeholder {
  font-size: 30rpx;
  color: $color-text-primary;
  line-height: 1.8;
  white-space: pre-wrap;
}

.disclaimer {
  margin-top: $spacing-xl;
  padding: $spacing-md;
  background: $color-bg-card;
  border-radius: $radius-md;

  &-text {
    font-size: 22rpx;
    color: $color-text-muted;
    line-height: 1.6;
  }
}

.empty {
  display: flex;
  justify-content: center;
  padding-top: 200rpx;

  &-text {
    font-size: 28rpx;
    color: $color-text-muted;
  }
}
</style>
