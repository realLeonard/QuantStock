import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'crypto';
import { versionInputSchema, versionPatchSchema } from '@quantstock/validators';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const versions = new Hono<{ Variables: Variables }>();

// 版本管理仅 admin 可用
versions.use('*', adminAuth, requireAdmin);

// GET /api/versions - 版本列表
versions.get('/', async (c) => {
  try {
    const list = await db.listVersions();
    return c.json({ data: list });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/versions - 新建版本（id/created_at 服务端生成）
versions.post('/', zValidator('json', versionInputSchema), async (c) => {
  const { version, is_force_update, value_desc } = c.req.valid('json');
  try {
    const id = randomUUID();
    await db.createVersion({
      id,
      version,
      is_force_update,
      value_desc,
      created_at: Date.now(),
    });
    return c.json({ data: { id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PATCH /api/versions/:id - 更新版本
versions.patch('/:id', zValidator('json', versionPatchSchema), async (c) => {
  const { id } = c.req.param();
  const patch = c.req.valid('json');
  try {
    await db.updateVersion(id, patch);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default versions;
