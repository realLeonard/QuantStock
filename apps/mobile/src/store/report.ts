import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DailyReport } from '../types';
import { fetchReportList, fetchReportDetail, isUpgradeRequired } from '../api/report';
import { cacheReportDetail, getCachedReportDetail } from '../utils/cache';

export const useReportStore = defineStore('report', () => {
  const list = ref<DailyReport[]>([]);
  const currentDetail = ref<DailyReport | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const hasMore = ref(true);
  const currentPage = ref(1);
  /** 服务端返回 403 UPGRADE_REQUIRED（当日内容需要会员） */
  const upgradeRequired = ref(false);
  const PAGE_SIZE = 20;

  /** 加载第一页（下拉刷新） */
  async function loadFirstPage(): Promise<void> {
    loading.value = true;
    try {
      const data = await fetchReportList(1, PAGE_SIZE);
      list.value = data;
      currentPage.value = 1;
      hasMore.value = data.length === PAGE_SIZE;
    } finally {
      loading.value = false;
    }
  }

  /** 加载下一页（上拉加载更多） */
  async function loadNextPage(): Promise<void> {
    if (!hasMore.value || loading.value) return;
    loading.value = true;
    try {
      const nextPage = currentPage.value + 1;
      const data = await fetchReportList(nextPage, PAGE_SIZE);
      list.value = [...list.value, ...data];
      currentPage.value = nextPage;
      hasMore.value = data.length === PAGE_SIZE;
    } finally {
      loading.value = false;
    }
  }

  /** 加载日报详情（优先读缓存） */
  async function loadDetail(reportDate: string): Promise<void> {
    upgradeRequired.value = false;
    // 先检查缓存（非当日内容）
    const cached = getCachedReportDetail<DailyReport>(reportDate);
    if (cached) {
      currentDetail.value = cached;
      return;
    }

    detailLoading.value = true;
    try {
      const data = await fetchReportDetail(reportDate);
      if (data) {
        currentDetail.value = data;
        cacheReportDetail(reportDate, data); // 非当日自动缓存
      }
    } catch (e) {
      if (isUpgradeRequired(e)) {
        // 服务端拦截当日内容：用列表轻量数据兜底渲染头部+摘要+付费墙
        upgradeRequired.value = true;
        currentDetail.value =
          list.value.find((r) => r.report_date === reportDate) ?? null;
      } else {
        throw e;
      }
    } finally {
      detailLoading.value = false;
    }
  }

  function clearDetail(): void {
    currentDetail.value = null;
    upgradeRequired.value = false;
  }

  return {
    list,
    currentDetail,
    loading,
    detailLoading,
    hasMore,
    upgradeRequired,
    loadFirstPage,
    loadNextPage,
    loadDetail,
    clearDetail,
  };
});
