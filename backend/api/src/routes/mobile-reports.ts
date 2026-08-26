import { Hono } from 'hono';
import { mobileAuth } from '../middleware/auth';
import { db } from '../db';
import { checkTodayAccess, getTodayBj } from '../utils/permission';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CONFIG_KEY_RE = /^[\w.-]{1,64}$/;

const mobileReports = new Hono<{ Variables: Variables }>();

mobileReports.use('*', mobileAuth);

// GET /api/mobile/reports?page=1&pageSize=20 - 日报列表（轻量字段）
mobileReports.get('/reports', async (c) => {
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const pageSize = Math.min(Math.max(Number(c.req.query('pageSize')) || 20, 1), 50);
  try {
    const reports = await db.listReportsLight(page, pageSize);
    return c.json({ data: reports });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/mobile/reports/latest - 最新一篇（轻量字段，须定义在 /reports/:date 之前）
mobileReports.get('/reports/latest', async (c) => {
  try {
    const reports = await db.listReportsLight(1, 1);
    return c.json({ data: reports[0] ?? null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/mobile/reports/:date - 日报详情（当日内容做服务端会员校验）
mobileReports.get('/reports/:date', async (c) => {
  const { date } = c.req.param();
  if (!DATE_RE.test(date)) {
    return c.json({ error: '日期格式不正确' }, 400);
  }

  try {
    // 权限矩阵：非当日全文所有人可见；当日全文仅试用期内/有效会员可见
    if (date === getTodayBj()) {
      const authUid = c.get('authUid');
      const appUser = await db.getAppUserByAuthId(authUid);
      const access = checkTodayAccess(appUser);
      if (!access.allowed) {
        return c.json(
          { error: '当日内容需要会员权限', code: 'UPGRADE_REQUIRED' },
          403
        );
      }
    }

    const report = await db.getReportByDate(date);
    return c.json({ data: report });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/mobile/config/:key - App 配置读取
mobileReports.get('/config/:key', async (c) => {
  const { key } = c.req.param();
  if (!CONFIG_KEY_RE.test(key)) {
    return c.json({ error: '配置键格式不正确' }, 400);
  }
  try {
    const value = await db.getAppConfigValue(key);
    return c.json({ data: value === null ? null : { key, value } });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default mobileReports;
