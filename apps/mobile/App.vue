<script setup lang="ts">
import { onLaunch, onShow } from '@dcloudio/uni-app';
import { useUserStore } from '@/store/user';

onLaunch(() => {
  const userStore = useUserStore();
  userStore.restoreSession();
});

onShow(() => {
  const userStore = useUserStore();
  if (userStore.isLoggedIn) {
    userStore.refreshPlanStatus();
  }
});
</script>

<style>
page {
  background-color: #0a1628;
  color: #e8edf5;
  font-family: -apple-system, 'SF Pro Display', 'PingFang SC', 'Helvetica Neue', sans-serif;
}
::-webkit-scrollbar {
  display: none;
}
</style>
