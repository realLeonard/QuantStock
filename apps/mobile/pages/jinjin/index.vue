<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
onShow(() => { uni.showTabBar(); });
</script>

<template>
  <view class="container">
    <view class="body">
      <view class="icon-wrap">
        <text class="icon">⛏️</text>
      </view>
      <text class="title">功能建设中</text>
      <text class="desc">今日股票池即将上线，敬请期待</text>

      <view class="feature-list">
        <view class="feature-item">
          <view class="feature-dot" />
          <text class="feature-text">A股主题热点追踪</text>
        </view>
        <view class="feature-sep" />
        <view class="feature-item">
          <view class="feature-dot" />
          <text class="feature-text">板块资金流向分析</text>
        </view>
        <view class="feature-sep" />
        <view class="feature-item">
          <view class="feature-dot" />
          <text class="feature-text">每日精选标的池</text>
        </view>
        <view class="feature-sep" />
        <view class="feature-item">
          <view class="feature-dot" />
          <text class="feature-text">量化因子筛选</text>
        </view>
      </view>

      <view class="coming-tag">
        <text class="coming-tag-text">COMING SOON</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
$d-bg: #000000;
$d-card: #1C1C1E;
$d-accent: #FF6B00;
$d-text: #FFFFFF;
$d-text-sub: rgba(235, 235, 245, 0.60);
$d-text-muted: rgba(235, 235, 245, 0.30);
$d-text-faint: rgba(235, 235, 245, 0.16);
$d-border: rgba(255, 255, 255, 0.08);

.container {
  min-height: 100vh;
  background: $d-bg;
}

.body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: $spacing-xl $spacing-md;
}

.icon-wrap {
  width: 160rpx;
  height: 160rpx;
  border-radius: $radius-xl;
  background: $d-card;
  border: 1rpx solid $d-border;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: $spacing-lg;

  .icon { font-size: 80rpx; }
}

.title {
  font-size: 36rpx;
  font-weight: 700;
  color: $d-text;
  margin-bottom: 12rpx;
}

.desc {
  font-size: 26rpx;
  color: $d-text-sub;
  margin-bottom: $spacing-xl;
}

.feature-list {
  width: 100%;
  background: $d-card;
  border-radius: $radius-lg;
  border: 1rpx solid $d-border;
  overflow: hidden;
  margin-bottom: $spacing-xl;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-md $spacing-lg;
}

.feature-dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: $d-accent;
  flex-shrink: 0;
}

.feature-text { font-size: 28rpx; color: $d-text-sub; }

.feature-sep {
  height: 1rpx;
  background: $d-border;
  margin-left: $spacing-lg;
}

.coming-tag {
  background: $d-card;
  border-radius: 100rpx;
  padding: 10rpx 28rpx;
  border: 1rpx solid $d-border;

  &-text {
    font-size: 20rpx;
    font-weight: 700;
    color: $d-text-faint;
    letter-spacing: 3rpx;
  }
}
</style>
