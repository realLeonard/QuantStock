import { reactive } from 'vue';
import type { DailyReport } from '../types';
import { fetchReportList, fetchReportDetail } from '../api/report';
import { cacheReportDetail, getCachedReportDetail } from '../utils/cache';

const PAGE_SIZE = 20;

// 直接返回 reactive 对象，模板里可直接响应，无需 .value
const store = reactive({
  list: [] as DailyReport[],
  currentDetail: null as DailyReport | null,
  loading: false,
  detailLoading: false,
  hasMore: true,
  currentPage: 1,

  async loadFirstPage() {
    store.loading = true;
    try {
      const data = await fetchReportList(1, PAGE_SIZE);
      store.list = data;
      store.currentPage = 1;
      store.hasMore = data.length === PAGE_SIZE;
    } finally {
      store.loading = false;
    }
  },

  async loadNextPage() {
    if (!store.hasMore || store.loading) return;
    store.loading = true;
    try {
      const nextPage = store.currentPage + 1;
      const data = await fetchReportList(nextPage, PAGE_SIZE);
      store.list = [...store.list, ...data];
      store.currentPage = nextPage;
      store.hasMore = data.length === PAGE_SIZE;
    } finally {
      store.loading = false;
    }
  },

  async loadDetail(reportDate: string) {
    const cached = getCachedReportDetail<DailyReport>(reportDate);
    if (cached) {
      store.currentDetail = cached;
      return;
    }
    store.detailLoading = true;
    try {
      const data = await fetchReportDetail(reportDate);
      if (data) {
        store.currentDetail = data;
        cacheReportDetail(reportDate, data);
      }
    } finally {
      store.detailLoading = false;
    }
  },

  clearDetail() {
    store.currentDetail = null;
  },
});

export function useReportStore() {
  return store;
}
