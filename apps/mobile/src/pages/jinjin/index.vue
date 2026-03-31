<script setup lang="ts">
// 掘金模块 - 暂留占位入口
</script>

<template>
  <view class="container">
    <view class="header">
      <text class="header-title">掘金</text>
      <text class="header-sub">精选股票池 · 掘金机会</text>
    </view>

    <view class="placeholder">
      <view class="placeholder-icon">⛏️</view>
      <text class="placeholder-title">功能即将上线</text>
      <text class="placeholder-desc">今日股票池正在建设中，敬请期待</text>

      <view class="coming-soon-list">
        <view class="feature-item">
          <text class="feature-dot">•</text>
          <text class="feature-text">A股主题热点追踪</text>
        </view>
        <view class="feature-item">
          <text class="feature-dot">•</text>
          <text class="feature-text">板块资金流向分析</text>
        </view>
        <view class="feature-item">
          <text class="feature-dot">•</text>
          <text class="feature-text">每日精选标的池</text>
        </view>
        <view class="feature-item">
          <text class="feature-dot">•</text>
          <text class="feature-text">量化因子筛选</text>
        </view>
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

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 120rpx;

  &-icon {
    font-size: 120rpx;
    margin-bottom: $spacing-lg;
  }

  &-title {
    font-size: 36rpx;
    font-weight: 700;
    color: $color-text-primary;
    margin-bottom: $spacing-sm;
  }

  &-desc {
    font-size: 26rpx;
    color: $color-text-secondary;
    margin-bottom: $spacing-xl;
  }
}

.coming-soon-list {
  width: 100%;
  background: $color-bg-card;
  border-radius: $radius-lg;
  padding: $spacing-lg;
  border: 1rpx solid $color-border;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding: $spacing-sm 0;
}

.feature-dot {
  color: $color-gold;
  font-size: 28rpx;
}

.feature-text {
  font-size: 28rpx;
  color: $color-text-secondary;
}
</style>
