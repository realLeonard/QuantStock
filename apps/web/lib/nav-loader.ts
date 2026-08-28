import { useAppStore, type NavItem } from '@/store';

/**
 * 导航切换 + 对应数据加载（PC 壳 AdminLayout 与移动壳 MobileLayout 共用）
 * 新增导航页时只需在此处补充加载分支，两壳自动获得
 */
export function navigateTo(nav: NavItem) {
  const s = useAppStore.getState();
  s.setCurrentThemeId(null);
  s.setCurrentReportId(null);
  s.setCurrentNav(nav);
  if (nav === 'dashboard') {
    s.loadThemes();
    s.loadRecentInsights();
    s.loadDailyGoldPicks();
    s.loadReports();
  }
  if (nav === 'users') {
    s.loadUsers();
  }
  if (nav === 'zaobao') {
    s.loadReports();
  }
  if (nav === 'breadth') {
    s.loadBreadth('recent30');
  }
  if (nav === 'news') {
    s.loadNewsItems();
  }
  if (nav === 'app-users') {
    s.loadAppUsers();
  }
  if (nav === 'app-feedback') {
    s.loadUserFeedbacks();
  }
  if (nav === 'app-events') {
    s.loadUserEvents();
  }
  if (nav === 'app-version') {
    s.loadAppVersions();
  }
  if (nav === 'daily-review') {
    s.loadDailyReviews();
  }
  if (nav === 'sector-prediction') {
    s.setCurrentSectorDate(null);
    s.loadSectorPredictionDays();
  }
  if (nav === 'gold') {
    s.loadRecentInsights();
    s.loadDailyGoldPicks();
    s.loadThemes();
    s.loadReports();
  }
  if (nav === 'stock-dict-sector') {
    s.loadSectorMasters();
  }
  if (nav === 'stock-dict-codes') {
    s.loadStockCodes();
  }
  if (nav === 'login-logs') {
    s.loadLoginLogs(1);
    s.loadLoginLogSummary();
  }
}

/** 从详情态返回列表态（主题股票池 → 早报详情 → 板块预测日期，依次判空） */
export function goBackFromDetail() {
  const s = useAppStore.getState();
  if (s.currentThemeId) {
    s.setCurrentThemeId(null);
  } else if (s.currentReportId) {
    s.setCurrentReportId(null);
  } else if (s.currentSectorDate) {
    s.setCurrentSectorDate(null);
  } else if (s.currentNav === 'themes') {
    s.setCurrentNav('dashboard');
  }
}
