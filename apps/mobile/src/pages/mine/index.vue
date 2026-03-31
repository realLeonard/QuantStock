<script setup lang="ts">
import { computed, ref } from 'vue';
import { useUserStore } from '@/store/user';
import { updateAppUser, submitFeedback } from '@/api/user';
import { clearAllCache, getCacheSize } from '@/utils/cache';
import { calcDaysLeft, isExpired } from '@/utils/time';

const userStore = useUserStore();

const cacheSize = ref(getCacheSize());

const planLabel = computed(() => {
  const info = userStore.planInfo;
  if (!info.isActive) return '免费用户';
  const daysLeft = info.daysLeft;
  if (daysLeft !== null && daysLeft <= 3) {
    return `${info.label}（还剩 ${daysLeft} 天）`;
  }
  return info.label;
});

const planExpiredText = computed(() => {
  const info = userStore.planInfo;
  if (info.type === 'free') return '升级会员，解锁当日内容';
  if (info.expiredAt === null) return '永久有效';
  if (isExpired(info.expiredAt)) {
    const overDays = Math.ceil((Date.now() - info.expiredAt) / (1000 * 60 * 60 * 24));
    return `已过期 ${overDays} 天`;
  }
  const daysLeft = calcDaysLeft(info.expiredAt);
  return `有效期至 ${new Date(info.expiredAt).toLocaleDateString('zh-CN')}（还剩 ${daysLeft} 天）`;
});

function goLogin() {
  uni.navigateTo({ url: '/src/pages/auth/login' });
}

async function doLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确认退出当前账号？',
    success: async (res) => {
      if (res.confirm) {
        await userStore.logout();
        uni.showToast({ title: '已退出登录', icon: 'success' });
      }
    },
  });
}

function goUpgrade() {
  // TODO: 接入微信支付后实现
  uni.showToast({ title: '付费功能即将上线', icon: 'none' });
}

function handleClearCache() {
  uni.showModal({
    title: '清除缓存',
    content: `当前缓存约 ${cacheSize.value} KB，确认清除？`,
    success: (res) => {
      if (res.confirm) {
        clearAllCache();
        cacheSize.value = 0;
        uni.showToast({ title: '缓存已清除', icon: 'success' });
      }
    },
  });
}

function openPrivacyPolicy() {
  uni.showModal({
    title: '隐私政策',
    content: '本应用收集手机号用于注册登录，不会出售给第三方。详情请访问官网查看完整隐私政策。',
    showCancel: false,
  });
}

function openTerms() {
  uni.showModal({
    title: '服务条款',
    content: '本应用提供的内容仅供参考，不构成投资建议。用户需自行承担投资风险。',
    showCancel: false,
  });
}

function contactUs() {
  uni.showModal({
    title: '联系我们',
    content: '如有问题或建议，请发送邮件至 support@quantstock.app',
    showCancel: false,
  });
}

const appVersion = '1.0.0';
</script>

<template>
  <view class="container">
    <!-- 顶部用户信息 -->
    <view class="user-section">
      <view v-if="userStore.isLoggedIn" class="user-info">
        <view class="avatar">
          <image
            v-if="userStore.user?.avatar_url"
            :src="userStore.user.avatar_url"
            class="avatar-img"
            mode="aspectFill"
          />
          <text v-else class="avatar-placeholder">
            {{ userStore.user?.nickname?.[0] || userStore.user?.phone?.slice(-4) || '?' }}
          </text>
        </view>
        <view class="user-detail">
          <text class="user-name">
            {{ userStore.user?.nickname || `用户 ${userStore.user?.phone?.slice(-4)}` }}
          </text>
          <text class="user-phone">{{ userStore.user?.phone }}</text>
        </view>
      </view>
      <view v-else class="user-guest" @tap="goLogin">
        <view class="guest-avatar">
          <text class="guest-icon">👤</text>
        </view>
        <view class="guest-info">
          <text class="guest-title">点击登录 / 注册</text>
          <text class="guest-hint">注册即享 3 天免费试用</text>
        </view>
        <text class="guest-arrow">›</text>
      </view>
    </view>

    <!-- 付费 Plan 卡片 -->
    <view class="plan-card">
      <view class="plan-header">
        <text class="plan-icon">👑</text>
        <text class="plan-label">{{ planLabel }}</text>
      </view>
      <text class="plan-expired-text">{{ planExpiredText }}</text>
      <view
        v-if="!userStore.planInfo.isActive || (userStore.planInfo.daysLeft !== null && userStore.planInfo.daysLeft <= 7)"
        class="plan-upgrade-btn"
        @tap="goUpgrade"
      >
        <text class="plan-upgrade-text">
          {{ userStore.planInfo.type === 'free' ? '立即升级会员' : '立即续费' }}
        </text>
      </view>
    </view>

    <!-- 设置列表 -->
    <view class="settings-group">
      <text class="settings-group-title">设置</text>
      <view class="settings-list">
        <view class="settings-item" @tap="openPrivacyPolicy">
          <text class="settings-item-label">隐私政策</text>
          <text class="settings-item-arrow">›</text>
        </view>
        <view class="settings-item" @tap="openTerms">
          <text class="settings-item-label">服务条款</text>
          <text class="settings-item-arrow">›</text>
        </view>
        <view class="settings-item" @tap="contactUs">
          <text class="settings-item-label">联系我们</text>
          <text class="settings-item-arrow">›</text>
        </view>
        <view class="settings-item" @tap="handleClearCache">
          <text class="settings-item-label">清除缓存</text>
          <view class="settings-item-right">
            <text class="settings-item-value">{{ cacheSize }} KB</text>
            <text class="settings-item-arrow">›</text>
          </view>
        </view>
        <view class="settings-item">
          <text class="settings-item-label">当前版本</text>
          <text class="settings-item-value">v{{ appVersion }}</text>
        </view>
      </view>
    </view>

    <!-- 退出登录 -->
    <view v-if="userStore.isLoggedIn" class="logout-btn" @tap="doLogout">
      <text class="logout-text">退出登录</text>
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

.user-section {
  margin-bottom: $spacing-md;
}

.user-info {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $color-bg-card;
  border-radius: $radius-xl;
  border: 1rpx solid $color-border;
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 60rpx;
  background: $color-bg-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;

  &-img {
    width: 100%;
    height: 100%;
  }

  &-placeholder {
    font-size: 48rpx;
    color: $color-gold;
    font-weight: 700;
  }
}

.user-detail {
  flex: 1;
}

.user-name {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: $color-text-primary;
  margin-bottom: 6rpx;
}

.user-phone {
  font-size: 24rpx;
  color: $color-text-secondary;
}

.user-guest {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $color-bg-card;
  border-radius: $radius-xl;
  border: 1rpx solid $color-border;

  &:active {
    opacity: 0.8;
  }
}

.guest-avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 60rpx;
  background: $color-bg-surface;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.guest-icon {
  font-size: 60rpx;
}

.guest-info {
  flex: 1;
}

.guest-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: $color-text-primary;
  margin-bottom: 6rpx;
}

.guest-hint {
  font-size: 24rpx;
  color: $color-gold;
}

.guest-arrow {
  font-size: 44rpx;
  color: $color-text-muted;
}

.plan-card {
  background: linear-gradient(135deg, #1a2f58 0%, #0d1f3c 100%);
  border-radius: $radius-xl;
  padding: $spacing-lg;
  margin-bottom: $spacing-md;
  border: 1rpx solid rgba(212, 175, 55, 0.3);
}

.plan-header {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  margin-bottom: 8rpx;
}

.plan-icon {
  font-size: 36rpx;
}

.plan-label {
  font-size: 32rpx;
  font-weight: 700;
  color: $color-gold;
}

.plan-expired-text {
  display: block;
  font-size: 24rpx;
  color: $color-text-secondary;
  margin-bottom: $spacing-md;
}

.plan-upgrade-btn {
  background: linear-gradient(135deg, $color-gold 0%, $color-gold-light 100%);
  border-radius: 100rpx;
  padding: 18rpx $spacing-lg;
  text-align: center;

  &:active {
    opacity: 0.85;
  }
}

.plan-upgrade-text {
  font-size: 28rpx;
  font-weight: 700;
  color: #0a1628;
}

.settings-group {
  margin-bottom: $spacing-md;
}

.settings-group-title {
  display: block;
  font-size: 24rpx;
  color: $color-text-muted;
  margin-bottom: $spacing-sm;
  padding-left: $spacing-sm;
}

.settings-list {
  background: $color-bg-card;
  border-radius: $radius-lg;
  border: 1rpx solid $color-border;
  overflow: hidden;
}

.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $spacing-md $spacing-lg;
  border-bottom: 1rpx solid rgba(138, 155, 184, 0.1);

  &:last-child {
    border-bottom: none;
  }

  &:active {
    background: $color-bg-surface;
  }

  &-label {
    font-size: 28rpx;
    color: $color-text-primary;
  }

  &-right {
    display: flex;
    align-items: center;
    gap: 8rpx;
  }

  &-value {
    font-size: 26rpx;
    color: $color-text-secondary;
  }

  &-arrow {
    font-size: 36rpx;
    color: $color-text-muted;
  }
}

.logout-btn {
  background: $color-bg-card;
  border-radius: $radius-lg;
  padding: $spacing-md;
  text-align: center;
  border: 1rpx solid rgba(232, 93, 84, 0.3);

  &:active {
    opacity: 0.8;
  }
}

.logout-text {
  font-size: 28rpx;
  color: $color-red;
}
</style>
