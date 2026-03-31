<script setup lang="ts">
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { sendOtp, verifyOtp, getOrCreateAppUser } from '@/api/user';
import { useUserStore } from '@/store/user';

const userStore = useUserStore();

const fromRoute = ref('');
const phone = ref('');
const code = ref('');
const step = ref<'phone' | 'code'>('phone');
const countdown = ref(0);
const loading = ref(false);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

onLoad((options) => {
  fromRoute.value = options?.from ?? '';
});

// 手机号格式验证
const isPhoneValid = computed(() => /^1[3-9]\d{9}$/.test(phone.value));
const isCodeValid = computed(() => /^\d{6}$/.test(code.value));

async function handleSendOtp() {
  if (!isPhoneValid.value) {
    uni.showToast({ title: '请输入正确的手机号', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    await sendOtp(phone.value);
    step.value = 'code';
    startCountdown();
    uni.showToast({ title: '验证码已发送', icon: 'success' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '发送失败，请重试';
    uni.showToast({ title: msg, icon: 'none' });
  } finally {
    loading.value = false;
  }
}

async function handleVerifyOtp() {
  if (!isCodeValid.value) {
    uni.showToast({ title: '请输入 6 位验证码', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    const authRes = await verifyOtp(phone.value, code.value);
    const appUser = await getOrCreateAppUser(authRes.user.id, phone.value);

    userStore.setSession({
      accessToken: authRes.access_token,
      authId: authRes.user.id,
      phone: phone.value,
      appUser,
    });

    // 新用户提示
    const isNewUser = Date.now() - appUser.created_at < 5000;
    if (isNewUser) {
      uni.showModal({
        title: '欢迎加入股海远洋！',
        content: '已为您激活 3 天免费试用，立即探索每日早报吧！',
        showCancel: false,
        success: () => handleLoginSuccess(),
      });
    } else {
      handleLoginSuccess();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '验证失败，请重试';
    uni.showToast({ title: msg, icon: 'none' });
  } finally {
    loading.value = false;
  }
}

function handleLoginSuccess() {
  // 返回来源页或首页
  if (fromRoute.value) {
    uni.navigateBack();
  } else {
    uni.switchTab({ url: '/src/pages/report/list' });
  }
}

function startCountdown() {
  countdown.value = 60;
  countdownTimer = setInterval(() => {
    countdown.value--;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer!);
      countdownTimer = null;
    }
  }, 1000);
}

function goBack() {
  if (step.value === 'code') {
    step.value = 'phone';
    code.value = '';
  } else {
    uni.navigateBack();
  }
}
</script>

<template>
  <view class="container">
    <!-- 顶部返回 -->
    <view class="nav-bar">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-icon">‹</text>
      </view>
    </view>

    <!-- Logo 区域 -->
    <view class="logo-section">
      <text class="logo-title">股海远洋</text>
      <text class="logo-sub">专业A股投资日报</text>
    </view>

    <!-- 手机号输入步骤 -->
    <view v-if="step === 'phone'" class="form-section">
      <text class="form-title">手机号登录 / 注册</text>
      <text class="form-hint">注册即享 3 天免费试用</text>

      <view class="input-group">
        <text class="input-prefix">+86</text>
        <input
          v-model="phone"
          class="input"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="input-placeholder"
        />
      </view>

      <view
        class="btn"
        :class="{ 'btn--disabled': !isPhoneValid || loading }"
        @tap="handleSendOtp"
      >
        <text class="btn-text">{{ loading ? '发送中...' : '获取验证码' }}</text>
      </view>

      <!-- 隐私协议 -->
      <text class="privacy-tip">
        登录即代表您同意
        <text class="privacy-link" @tap="() => {}">《隐私政策》</text>
        与
        <text class="privacy-link" @tap="() => {}">《服务条款》</text>
      </text>
    </view>

    <!-- 验证码输入步骤 -->
    <view v-if="step === 'code'" class="form-section">
      <text class="form-title">输入验证码</text>
      <text class="form-hint">验证码已发送至 {{ phone }}</text>

      <view class="input-group">
        <input
          v-model="code"
          class="input input--code"
          type="number"
          maxlength="6"
          placeholder="6 位验证码"
          placeholder-class="input-placeholder"
        />
      </view>

      <view class="resend-row">
        <view
          v-if="countdown > 0"
          class="resend-disabled"
        >
          <text class="resend-text">{{ countdown }}s 后重新发送</text>
        </view>
        <view
          v-else
          class="resend-btn"
          @tap="handleSendOtp"
        >
          <text class="resend-link">重新发送</text>
        </view>
      </view>

      <view
        class="btn"
        :class="{ 'btn--disabled': !isCodeValid || loading }"
        @tap="handleVerifyOtp"
      >
        <text class="btn-text">{{ loading ? '验证中...' : '登录 / 注册' }}</text>
      </view>
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

.nav-bar {
  padding: 20rpx 0;
}

.nav-back {
  display: inline-flex;
  align-items: center;
  padding: 8rpx;

  &-icon {
    font-size: 56rpx;
    color: $color-text-secondary;
    line-height: 1;
  }
}

.logo-section {
  text-align: center;
  padding: 80rpx 0 $spacing-xl;

  .logo-title {
    display: block;
    font-size: 64rpx;
    font-weight: 800;
    color: $color-gold;
    letter-spacing: 4rpx;
    margin-bottom: 12rpx;
  }

  .logo-sub {
    font-size: 28rpx;
    color: $color-text-secondary;
  }
}

.form-section {
  padding: 0 $spacing-sm;
}

.form-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: $color-text-primary;
  margin-bottom: 8rpx;
}

.form-hint {
  display: block;
  font-size: 26rpx;
  color: $color-gold;
  margin-bottom: $spacing-xl;
}

.input-group {
  display: flex;
  align-items: center;
  background: $color-bg-card;
  border: 1rpx solid $color-border;
  border-radius: $radius-lg;
  padding: 0 $spacing-md;
  margin-bottom: $spacing-md;
  height: 100rpx;
}

.input-prefix {
  font-size: 30rpx;
  color: $color-text-secondary;
  margin-right: $spacing-sm;
  padding-right: $spacing-sm;
  border-right: 1rpx solid $color-border;
}

.input {
  flex: 1;
  height: 100rpx;
  font-size: 32rpx;
  color: $color-text-primary;
  background: transparent;

  &--code {
    text-align: center;
    letter-spacing: 8rpx;
    font-size: 40rpx;
    font-weight: 700;
  }
}

.input-placeholder {
  color: $color-text-muted;
}

.resend-row {
  text-align: right;
  margin-bottom: $spacing-md;
}

.resend-text {
  font-size: 24rpx;
  color: $color-text-muted;
}

.resend-link {
  font-size: 24rpx;
  color: $color-blue;
}

.btn {
  background: linear-gradient(135deg, $color-gold 0%, $color-gold-light 100%);
  border-radius: 100rpx;
  padding: 28rpx 0;
  text-align: center;
  margin-bottom: $spacing-md;

  &:active {
    opacity: 0.85;
  }

  &--disabled {
    opacity: 0.4;
    pointer-events: none;
  }

  &-text {
    font-size: 32rpx;
    font-weight: 700;
    color: #0a1628;
  }
}

.privacy-tip {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: $color-text-muted;
  line-height: 1.8;
}

.privacy-link {
  color: $color-blue;
}
</style>
