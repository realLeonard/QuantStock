import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import {
  createAdminUserSchema,
  resetPasswordSchema,
  updateRoleSchema,
} from '@quantstock/validators';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const adminUsers = new Hono<{ Variables: Variables }>();

// 用户管理全部接口仅 admin 可用
adminUsers.use('*', adminAuth, requireAdmin);

// GET /api/admin-users - 用户列表（不含 password_hash）
adminUsers.get('/', async (c) => {
  try {
    const users = await db.listUsers();
    return c.json({ data: users });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/admin-users - 新建用户（bcrypt 在服务端计算）
adminUsers.post('/', zValidator('json', createAdminUserSchema), async (c) => {
  const { username, password, role } = c.req.valid('json');
  try {
    const existing = await db.findUserByUsername(username);
    if (existing) {
      return c.json({ error: '用户名已存在' }, 409);
    }
    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.createUser(id, username, passwordHash, role);
    return c.json({ data: { id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PATCH /api/admin-users/:id/role - 修改角色
adminUsers.patch('/:id/role', zValidator('json', updateRoleSchema), async (c) => {
  const { id } = c.req.param();
  const { role } = c.req.valid('json');
  const payload = c.get('adminUser');
  if (payload.sub === id && role !== 'admin') {
    return c.json({ error: '不能降级自己的管理员角色' }, 400);
  }
  try {
    await db.updateUserRole(id, role);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/admin-users/:id/reset-password - 重置密码（附带吊销旧 token）
adminUsers.post('/:id/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
  const { id } = c.req.param();
  const { password } = c.req.valid('json');
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    await db.resetUserPassword(id, passwordHash);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/admin-users/:id - 删除用户（禁止删除自己）
adminUsers.delete('/:id', async (c) => {
  const { id } = c.req.param();
  const payload = c.get('adminUser');
  if (payload.sub === id) {
    return c.json({ error: '不能删除自己' }, 400);
  }
  try {
    await db.deleteUser(id);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default adminUsers;
