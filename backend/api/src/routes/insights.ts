import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { insightsInputSchema } from '@quantstock/validators';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const insights = new Hono<{ Variables: Variables }>();

// GET /api/insights - 近期掘金（单例）
insights.get('/insights', adminAuth, async (c) => {
  try {
    const data = await db.fetchRecentInsights();
    return c.json({ data });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PUT /api/insights - 更新近期掘金（仅 admin）
insights.put(
  '/insights',
  adminAuth,
  requireAdmin,
  zValidator('json', insightsInputSchema),
  async (c) => {
    const { thoughts, focus_direction } = c.req.valid('json');
    try {
      await db.updateRecentInsights(thoughts, focus_direction);
      return c.json({ data: null });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  }
);

// GET /api/gold-picks - 每日金股列表
insights.get('/gold-picks', adminAuth, async (c) => {
  try {
    const picks = await db.fetchDailyGoldPicks();
    return c.json({ data: picks });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default insights;
