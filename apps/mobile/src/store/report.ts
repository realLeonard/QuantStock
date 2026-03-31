import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DailyReport } from '../types';
import { fetchReportList, fetchReportDetail } from '../api/report';
import { cacheReportDetail, getCachedReportDetail } from '../utils/cache';

export const useReportStore = defineStore('report', () => {
  const list = ref<DailyReport[]>([]);
  const currentDetail = ref<DailyReport | null>(null);
  const loading = ref(false);
  const detailLoading = ref(false);
  const hasMore = ref(true);
  const currentPage = ref(1);
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
    } finally {
      detailLoading.value = false;
    }
  }

  function clearDetail(): void {
    currentDetail.value = null;
  }

  return {
    list,
    currentDetail,
    loading,
    detailLoading,
    hasMore,
    loadFirstPage,
    loadNextPage,
    loadDetail,
    clearDetail,
  };
});
