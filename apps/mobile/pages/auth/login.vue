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

onLoad((options) => { fromRoute.value = options?.from ?? ''; });

const isPhoneValid = computed(() => /^1[3-9]\d{9}$/.test(phone.value));
const isCodeValid = computed(() => /^\d{6}$/.test(code.value));

async function handleSendOtp() {
  if (!isPhoneValid.value) { uni.showToast({ title: '请输入正确的手机号', icon: 'none' }); return; }
  loading.value = true;
  try {
    await sendOtp(phone.value);
    step.value = 'code';
    startCountdown();
    uni.showToast({ title: '验证码已发送', icon: 'success' });
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '发送失败，请重试', icon: 'none' });
  } finally { loading.value = false; }
}

async function handleVerifyOtp() {
  if (!isCodeValid.value) { uni.showToast({ title: '请输入 6 位验证码', icon: 'none' }); return; }
  loading.value = true;
  try {
    const authRes = await verifyOtp(phone.value, code.value);
    const appUser = await getOrCreateAppUser(authRes.user.id, phone.value);
    userStore.setSession({ accessToken: authRes.access_token, authId: authRes.user.id, phone: phone.value, appUser });
    const isNewUser = Date.now() - appUser.created_at < 5000;
    if (isNewUser) {
      uni.showModal({ title: '欢迎加入股海远洋！', content: '已激活 3 天免费试用，立即探索每日早报！', showCancel: false, success: () => handleLoginSuccess() });
    } else {
      handleLoginSuccess();
    }
  } catch (err) {
    uni.showToast({ title: err instanceof Error ? err.message : '验证失败，请重试', icon: 'none' });
  } finally { loading.value = false; }
}

function handleLoginSuccess() {
  if (fromRoute.value) { uni.navigateBack(); } else { uni.switchTab({ url: '/pages/report/list' }); }
}

function startCountdown() {
  countdown.value = 60;
  countdownTimer = setInterval(() => { countdown.value--; if (countdown.value <= 0) { clearInterval(countdownTimer!); countdownTimer = null; } }, 1000);
}

function goBack() {
  if (step.value === 'code') { step.value = 'phone'; code.value = ''; } else { uni.navigateBack(); }
}
</script>

<template>
  <view class="container">
    <view class="nav-bar">
      <view class="nav-back" @tap="goBack">
        <text class="nav-chevron">‹</text>
      </view>
    </view>

    <view class="brand-section">
      <view class="brand-logo">
        <text class="brand-logo-icon">🌊</text>
      </view>
      <text class="brand-title">股海远洋</text>
      <text class="brand-sub">专业 A 股投资早报</text>
    </view>

    <view v-if="step === 'phone'" class="form-section">
      <text class="form-title">手机号登录</text>
      <text class="form-hint">新用户注册即享 3 天免费试用</text>

      <view class="input-wrap">
        <view class="input-prefix-box">
          <text class="input-prefix">+86</text>
        </view>
        <input
          v-model="phone"
          class="input"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="input-ph"
        />
      </view>

      <view class="btn-primary" :class="{ 'btn-primary--off': !isPhoneValid || loading }" @tap="handleSendOtp">
        <text class="btn-primary-text">{{ loading ? '发送中…' : '获取验证码' }}</text>
      </view>

      <text class="privacy-tip">
        登录即代表您同意
        <text class="privacy-link">《隐私政策》</text>
        与
        <text class="privacy-link">《服务条款》</text>
      </text>
    </view>

    <view v-if="step === 'code'" class="form-section">
      <text class="form-title">输入验证码</text>
      <text class="form-hint">已发送至 +86 {{ phone }}</text>

      <view class="input-wrap input-wrap--code">
        <input
          v-model="code"
          class="input input--code"
          type="number"
          maxlength="6"
          placeholder="- - - - - -"
          placeholder-class="input-ph"
        />
      </view>

      <view class="resend-row">
        <text v-if="countdown > 0" class="resend-countdown">{{ countdown }}s 后重新发送</text>
        <text v-else class="resend-link" @tap="handleSendOtp">重新发送验证码</text>
      </view>

      <view class="btn-primary" :class="{ 'btn-primary--off': !isCodeValid || loading }" @tap="handleVerifyOtp">
        <text class="btn-primary-text">{{ loading ? '验证中…' : '登录 / 注册' }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
$d-bg: #000000;
$d-card: #1C1C1E;
$d-elevated: #2C2C2E;
$d-accent: #FF6B00;
$d-accent-muted: rgba(255, 107, 0, 0.15);
$d-blue: #0A84FF;
$d-text: #FFFFFF;
$d-text-sub: rgba(235, 235, 245, 0.60);
$d-text-muted: rgba(235, 235, 245, 0.30);
$d-border: rgba(255, 255, 255, 0.08);

.container {
  min-height: 100vh;
  background: $d-bg;
  display: flex;
  flex-direction: column;
}

.nav-bar {
  padding: 24rpx $spacing-md 0;
}

.nav-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: $d-card;

  &:active { opacity: 0.7; }
}

.nav-chevron {
  font-size: 48rpx;
  color: $d-text;
  line-height: 1;
  margin-top: -4rpx;
}

.brand-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64rpx 0 64rpx;
}

.brand-logo {
  width: 120rpx;
  height: 120rpx;
  border-radius: $radius-xl;
  background: $d-accent-muted;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: $spacing-lg;
  border: 1rpx solid rgba(255, 107, 0, 0.25);

  &-icon { font-size: 60rpx; }
}

.brand-title {
  font-size: 56rpx;
  font-weight: 800;
  color: $d-text;
  letter-spacing: 2rpx;
  margin-bottom: 10rpx;
}

.brand-sub {
  font-size: 26rpx;
  color: $d-text-sub;
}

.form-section {
  flex: 1;
  padding: 0 $spacing-lg;
}

.form-title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: $d-text;
  margin-bottom: 8rpx;
}

.form-hint {
  display: block;
  font-size: 26rpx;
  color: $d-text-sub;
  margin-bottom: $spacing-xl;
}

.input-wrap {
  display: flex;
  align-items: center;
  background: $d-card;
  border-radius: $radius-lg;
  border: 1rpx solid $d-border;
  margin-bottom: $spacing-md;
  height: 104rpx;
  overflow: hidden;

  &--code { justify-content: center; }
}

.input-prefix-box {
  padding: 0 $spacing-md;
  border-right: 1rpx solid $d-border;
  height: 100%;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.input-prefix {
  font-size: 30rpx;
  font-weight: 600;
  color: $d-text;
}

.input {
  flex: 1;
  height: 104rpx;
  padding: 0 $spacing-md;
  font-size: 32rpx;
  color: $d-text;
  background: transparent;

  &--code {
    text-align: center;
    letter-spacing: 16rpx;
    font-size: 44rpx;
    font-weight: 700;
  }
}

.input-ph { color: rgba(235, 235, 245, 0.30); }

.resend-row {
  text-align: right;
  margin-bottom: $spacing-md;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.resend-countdown { font-size: 26rpx; color: $d-text-muted; }
.resend-link { font-size: 26rpx; color: $d-blue; font-weight: 500; }

.btn-primary {
  background: $d-accent;
  border-radius: 100rpx;
  padding: 30rpx 0;
  text-align: center;
  margin-bottom: $spacing-lg;

  &:active { opacity: 0.85; }

  &--off { opacity: 0.35; pointer-events: none; }

  &-text { font-size: 32rpx; font-weight: 700; color: #fff; letter-spacing: 1rpx; }
}

.privacy-tip {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: $d-text-muted;
  line-height: 1.8;
}

.privacy-link { color: $d-blue; }
</style>
