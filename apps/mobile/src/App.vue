<script setup lang="ts">
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';

onLaunch(() => {
  // 恢复用户登录态
  const userStore = useUserStore();
  userStore.restoreSession();
});

onShow(() => {
  // App 从后台回到前台时，刷新会员状态
  const userStore = useUserStore();
  if (userStore.isLoggedIn) {
    userStore.refreshPlanStatus();
  }
});

onHide(() => {});
</script>

<template>
  <div />
</template>

<style>
/* 全局基础样式 */
page {
  background-color: #0a1628;
  color: #e8edf5;
  font-family: -apple-system, 'SF Pro Display', 'PingFang SC', 'Helvetica Neue', sans-serif;
}

/* 滚动条隐藏 */
::-webkit-scrollbar {
  display: none;
}
</style>
