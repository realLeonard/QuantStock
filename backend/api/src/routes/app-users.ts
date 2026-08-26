import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { planUpdateSchema } from '@quantstock/validators';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const appUsers = new Hono<{ Variables: Variables }>();

// App 用户/反馈/事件均为后台管理数据，仅 admin 可用。
// 注意：本子应用挂载在根路径（app.route('/', appUsers)），use('*') 会泄漏到
// 之后注册的所有路由（/themes 等对非 admin 误 403），因此逐路由挂中间件
appUsers.use('/app-users', adminAuth, requireAdmin);
appUsers.use('/app-users/*', adminAuth, requireAdmin);
appUsers.use('/feedbacks', adminAuth, requireAdmin);
appUsers.use('/events', adminAuth, requireAdmin);

// GET /api/app-users - App 用户列表
appUsers.get('/app-users', async (c) => {
  try {
    const users = await db.listAppUsers();
    return c.json({ data: users });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PATCH /api/app-users/:id/plan - 调整用户套餐
appUsers.patch('/app-users/:id/plan', zValidator('json', planUpdateSchema), async (c) => {
  const { id } = c.req.param();
  const { plan_type, plan_expired_at } = c.req.valid('json');
  try {
    await db.updateAppUserPlan(id, plan_type, plan_expired_at);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/feedbacks - 用户反馈列表
appUsers.get('/feedbacks', async (c) => {
  try {
    const feedbacks = await db.listUserFeedbacks();
    return c.json({ data: feedbacks });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/events?limit=200 - 用户行为事件
appUsers.get('/events', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 200, 1000);
  try {
    const events = await db.listUserEvents(limit);
    return c.json({ data: events });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default appUsers;
