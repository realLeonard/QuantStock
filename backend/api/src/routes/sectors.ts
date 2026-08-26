import { Hono } from 'hono';
import { adminAuth } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const sectors = new Hono<{ Variables: Variables }>();

// GET /api/sectors/prediction-days - 预测日历（近 N 日全量打分）
sectors.get('/sectors/prediction-days', adminAuth, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 60, 1), 120);
  try {
    const rows = await db.listSectorPredictionDays(limit);
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sectors/scores/:date - 指定日期打分明细
sectors.get('/sectors/scores/:date', adminAuth, async (c) => {
  const { date } = c.req.param();
  if (!DATE_RE.test(date)) {
    return c.json({ error: '日期格式不正确' }, 400);
  }
  try {
    const rows = await db.getSectorScoresByDate(date);
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sectors/daily/:date - 指定日期板块行情
sectors.get('/sectors/daily/:date', adminAuth, async (c) => {
  const { date } = c.req.param();
  if (!DATE_RE.test(date)) {
    return c.json({ error: '日期格式不正确' }, 400);
  }
  try {
    const rows = await db.getSectorDailyByDate(date);
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sectors/rotation-map - 轮动关系图
sectors.get('/sectors/rotation-map', adminAuth, async (c) => {
  try {
    const rows = await db.getSectorRotationMap();
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sectors/masters - 板块主数据
sectors.get('/sectors/masters', adminAuth, async (c) => {
  try {
    const rows = await db.listSectorMasters();
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/stock-codes - 全量股票代码表（服务端分页循环取全量）
sectors.get('/stock-codes', adminAuth, async (c) => {
  try {
    const rows = await db.listStockCodes();
    return c.json({ data: rows });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default sectors;
