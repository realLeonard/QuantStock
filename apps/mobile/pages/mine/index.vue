<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';

onShow(() => { uni.showTabBar(); });
import { updateAppUser, submitFeedback } from '@/api/user';
import { clearAllCache, getCacheSize } from '@/utils/cache';
import { calcDaysLeft, isExpired } from '@/utils/time';

const userStore = useUserStore();
const cacheSize = ref(getCacheSize());

const planLabel = computed(() => {
  const info = userStore.planInfo;
  if (!info.isActive) return '免费用户';
  const daysLeft = info.daysLeft;
  if (daysLeft !== null && daysLeft <= 3) return `${info.label}（还剩 ${daysLeft} 天）`;
  return info.label;
});

const planExpiredText = computed(() => {
  const info = userStore.planInfo;
  if (info.type === 'free') return '升级解锁每日完整早报内容';
  if (info.expiredAt === null) return '永久有效';
  if (isExpired(info.expiredAt)) {
    const overDays = Math.ceil((Date.now() - info.expiredAt) / (1000 * 60 * 60 * 24));
    return `已过期 ${overDays} 天`;
  }
  const daysLeft = calcDaysLeft(info.expiredAt);
  return `有效至 ${new Date(info.expiredAt).toLocaleDateString('zh-CN')}（剩 ${daysLeft} 天）`;
});

function goLogin() { uni.navigateTo({ url: '/pages/auth/login' }); }

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

function goUpgrade() { uni.showToast({ title: '付费功能即将上线', icon: 'none' }); }

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
  uni.showModal({ title: '隐私政策', content: '本应用收集手机号用于注册登录，不会出售给第三方。', showCancel: false });
}
function openTerms() {
  uni.showModal({ title: '服务条款', content: '本应用内容仅供参考，不构成投资建议。用户需自行承担投资风险。', showCancel: false });
}
function contactUs() {
  uni.showModal({ title: '联系我们', content: '如有问题请发送邮件至 support@quantstock.app', showCancel: false });
}

const appVersion = '1.0.0';
</script>

<template>
  <view class="container">
    <!-- 用户区 -->
    <view class="user-section">
      <view v-if="userStore.isLoggedIn" class="user-card">
        <view class="avatar">
          <image v-if="userStore.user?.avatar_url" :src="userStore.user.avatar_url" class="avatar-img" mode="aspectFill" />
          <text v-else class="avatar-initial">
            {{ userStore.user?.nickname?.[0] || userStore.user?.phone?.slice(-4) || '?' }}
          </text>
        </view>
        <view class="user-info">
          <text class="user-name">{{ userStore.user?.nickname || `用户 ${userStore.user?.phone?.slice(-4)}` }}</text>
          <text class="user-phone">{{ userStore.user?.phone }}</text>
        </view>
      </view>
      <view v-else class="guest-card" @tap="goLogin">
        <view class="guest-avatar"><text class="guest-avatar-icon">👤</text></view>
        <view class="guest-info">
          <text class="guest-name">点击登录 / 注册</text>
          <text class="guest-hint">注册即享 3 天免费试用 🎁</text>
        </view>
        <text class="guest-arrow">›</text>
      </view>
    </view>

    <!-- 会员卡 -->
    <view class="plan-section">
      <view class="plan-card">
        <view class="plan-top">
          <view class="plan-icon-box"><text class="plan-icon">👑</text></view>
          <view class="plan-info">
            <text class="plan-label">{{ planLabel }}</text>
            <text class="plan-desc">{{ planExpiredText }}</text>
          </view>
          <view
            v-if="!userStore.planInfo.isActive || (userStore.planInfo.daysLeft !== null && userStore.planInfo.daysLeft <= 7)"
            class="plan-btn"
            @tap="goUpgrade"
          >
            <text class="plan-btn-text">{{ userStore.planInfo.type === 'free' ? '升级' : '续费' }}</text>
          </view>
        </view>
        <view v-if="!userStore.planInfo.isActive" class="plan-features">
          <text class="plan-feature">✓ 每日完整早报</text>
          <text class="plan-feature">✓ 历史全量查看</text>
          <text class="plan-feature">✓ 掘金选股池</text>
        </view>
      </view>
    </view>

    <!-- 设置 -->
    <view class="settings-section">
      <text class="section-title">设置</text>
      <view class="settings-group">
        <view class="settings-row" @tap="openPrivacyPolicy">
          <text class="settings-row-label">隐私政策</text>
          <text class="settings-row-arrow">›</text>
        </view>
        <view class="settings-sep" />
        <view class="settings-row" @tap="openTerms">
          <text class="settings-row-label">服务条款</text>
          <text class="settings-row-arrow">›</text>
        </view>
        <view class="settings-sep" />
        <view class="settings-row" @tap="contactUs">
          <text class="settings-row-label">联系我们</text>
          <text class="settings-row-arrow">›</text>
        </view>
        <view class="settings-sep" />
        <view class="settings-row" @tap="handleClearCache">
          <text class="settings-row-label">清除缓存</text>
          <view class="settings-row-right">
            <text class="settings-row-value">{{ cacheSize }} KB</text>
            <text class="settings-row-arrow">›</text>
          </view>
        </view>
        <view class="settings-sep" />
        <view class="settings-row">
          <text class="settings-row-label">当前版本</text>
          <text class="settings-row-value">v{{ appVersion }}</text>
        </view>
      </view>
    </view>

    <!-- 退出 -->
    <view v-if="userStore.isLoggedIn" class="logout-section">
      <view class="logout-btn" @tap="doLogout">
        <text class="logout-text">退出登录</text>
      </view>
    </view>

    <view class="footer">
      <text class="footer-brand">股海远洋</text>
      <text class="footer-copy">© 2026 QuantStock · 专业A股早报</text>
    </view>
  </view>
</template>

<style lang="scss">
$d-bg: #000000;
$d-card: #1C1C1E;
$d-elevated: #2C2C2E;
$d-accent: #FF6B00;
$d-accent-muted: rgba(255, 107, 0, 0.15);
$d-red: #FF453A;
$d-text: #FFFFFF;
$d-text-sub: rgba(235, 235, 245, 0.60);
$d-text-muted: rgba(235, 235, 245, 0.30);
$d-text-faint: rgba(235, 235, 245, 0.16);
$d-border: rgba(255, 255, 255, 0.08);

.container {
  min-height: 100vh;
  background: $d-bg;
  padding-bottom: 40rpx;
}

.user-section {
  padding: 60rpx $spacing-md $spacing-md;
}

.user-card {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $d-card;
  border-radius: $radius-xl;
  border: 1rpx solid $d-border;
}

.avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background: $d-elevated;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  border: 2rpx solid $d-accent-muted;

  &-img { width: 100%; height: 100%; }
  &-initial { font-size: 44rpx; color: $d-accent; font-weight: 700; }
}

.user-info { flex: 1; }
.user-name { display: block; font-size: 34rpx; font-weight: 700; color: $d-text; margin-bottom: 8rpx; }
.user-phone { font-size: 24rpx; color: $d-text-sub; }

.guest-card {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  background: $d-card;
  border-radius: $radius-xl;
  border: 1rpx solid $d-border;

  &:active { opacity: 0.7; }
}

.guest-avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background: $d-elevated;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &-icon { font-size: 56rpx; }
}

.guest-info { flex: 1; }
.guest-name { display: block; font-size: 32rpx; font-weight: 600; color: $d-text; margin-bottom: 8rpx; }
.guest-hint { font-size: 24rpx; color: $d-accent; }
.guest-arrow { font-size: 48rpx; color: $d-text-muted; }

.plan-section {
  padding: 0 $spacing-md $spacing-md;
}

.plan-card {
  background: $d-card;
  border-radius: $radius-xl;
  padding: $spacing-lg;
  border: 1rpx solid rgba(255, 107, 0, 0.2);
}

.plan-top {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.plan-icon-box {
  width: 80rpx;
  height: 80rpx;
  border-radius: $radius-md;
  background: $d-accent-muted;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  .plan-icon { font-size: 40rpx; }
}

.plan-info { flex: 1; }
.plan-label { display: block; font-size: 30rpx; font-weight: 700; color: $d-text; margin-bottom: 6rpx; }
.plan-desc { font-size: 24rpx; color: $d-text-sub; }

.plan-btn {
  background: $d-accent;
  border-radius: 100rpx;
  padding: 12rpx 28rpx;

  &:active { opacity: 0.85; }

  &-text { font-size: 26rpx; font-weight: 700; color: #fff; }
}

.plan-features {
  display: flex;
  gap: $spacing-md;
  margin-top: $spacing-md;
  padding-top: $spacing-md;
  border-top: 1rpx solid $d-border;
  flex-wrap: wrap;
}

.plan-feature { font-size: 22rpx; color: $d-text-muted; }

.settings-section {
  padding: 0 $spacing-md $spacing-md;
}

.section-title {
  display: block;
  font-size: 22rpx;
  color: $d-text-muted;
  letter-spacing: 2rpx;
  padding-left: 4rpx;
  margin-bottom: $spacing-sm;
}

.settings-group {
  background: $d-card;
  border-radius: $radius-lg;
  border: 1rpx solid $d-border;
  overflow: hidden;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: $spacing-md $spacing-lg;

  &:active { background: $d-elevated; }

  &-label { font-size: 30rpx; color: $d-text; }

  &-right { display: flex; align-items: center; gap: 8rpx; }

  &-value { font-size: 26rpx; color: $d-text-sub; }

  &-arrow { font-size: 40rpx; color: $d-text-muted; line-height: 1; }
}

.settings-sep {
  height: 1rpx;
  background: $d-border;
  margin-left: $spacing-lg;
}

.logout-section {
  padding: 0 $spacing-md $spacing-md;
}

.logout-btn {
  background: $d-card;
  border-radius: $radius-lg;
  padding: $spacing-md;
  text-align: center;
  border: 1rpx solid rgba(255, 69, 58, 0.2);

  &:active { opacity: 0.7; }
}

.logout-text { font-size: 30rpx; color: $d-red; font-weight: 500; }

.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $spacing-xl $spacing-md;
  gap: 8rpx;

  &-brand { font-size: 26rpx; font-weight: 700; color: $d-text-faint; letter-spacing: 2rpx; }
  &-copy { font-size: 20rpx; color: $d-text-faint; }
}
</style>
