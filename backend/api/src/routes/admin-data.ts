import { Hono } from 'hono';
import { adminAuth } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const adminData = new Hono<{ Variables: Variables }>();

// GET /api/themes/meta - 主题元信息（不含股票，列表页用）
adminData.get('/themes/meta', adminAuth, async (c) => {
  try {
    const themes = await db.loadThemesMeta();
    return c.json({ data: themes });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/reports?limit=30 - 每日早报列表
adminData.get('/reports', adminAuth, async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 30, 200);
  try {
    const reports = await db.listReports(limit);
    return c.json({ data: reports });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/breadth?mode=recent30|YYYY-MM - 市场涨跌家数
adminData.get('/breadth', adminAuth, async (c) => {
  const mode = c.req.query('mode') ?? 'recent30';
  if (mode !== 'recent30' && !/^\d{4}-\d{2}$/.test(mode)) {
    return c.json({ error: 'mode 格式不正确' }, 400);
  }
  try {
    const rows = await db.getBreadthByMonth(mode);
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/daily-reviews?limit=30 - 每日复盘列表
adminData.get('/daily-reviews', adminAuth, async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 30, 200);
  try {
    const reviews = await db.listDailyReviews(limit);
    return c.json({ data: reviews });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/limit-up-reasons/:date - 涨停原因
adminData.get('/limit-up-reasons/:date', adminAuth, async (c) => {
  const { date } = c.req.param();
  if (!DATE_RE.test(date)) {
    return c.json({ error: '日期格式不正确' }, 400);
  }
  try {
    const reasons = await db.getLimitUpReasonsByDate(date);
    return c.json({ data: reasons });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/news?date=YYYY-MM-DD - 当日资讯（服务端做北京时间日期→毫秒区间）
adminData.get('/news', adminAuth, async (c) => {
  const date = c.req.query('date') ?? '';
  if (!DATE_RE.test(date)) {
    return c.json({ error: '日期格式不正确' }, 400);
  }
  try {
    const startMs = new Date(`${date}T00:00:00+08:00`).getTime();
    const endMs = startMs + 24 * 3600 * 1000 - 1;
    const items = await db.listNewsItemsByRange(startMs, endMs);
    return c.json({ data: items });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default adminData;
