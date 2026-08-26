import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { SUBSCRIPTION_PLANS } from '@quantstock/types';
import type { SubscriptionOrder, SubscriptionPlan } from '@quantstock/types';
import { adminAuth, adminAuthAllowExpired, requireAdmin } from '../middleware/auth';
import { hitAndCheck, clientIp } from '../middleware/rate-limit';
import { randomUUID } from 'crypto';

// ===== Supabase 客户端（service key，绕过 RLS——subscriptionOrders 表零 policy，只能走这里读写） =====
const supabase = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_KEY ?? ''
);

// ID 生成（密码学安全随机，防枚举）
function uid(): string {
  return randomUUID();
}

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const subscribe = new Hono<{ Variables: Variables }>();

// ===== 内存频率限制（实现见 middleware/rate-limit.ts） =====
const ipHits = new Map<string, number[]>();
const phoneHits = new Map<string, number[]>();

// ===== 1. 公开下单（无需登录） =====
const orderSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '手机号格式不正确'),
  plan: z.enum(['month', 'quarter', 'year']),
});

subscribe.post('/order', zValidator('json', orderSchema), async (c) => {
  const { phone, plan } = c.req.valid('json');

  const ip = clientIp(c.req.header('x-forwarded-for'));
  if (!hitAndCheck(ipHits, ip, 60_000, 3)) {
    return c.json({ error: '操作过于频繁，请稍后再试' }, 429);
  }
  if (!hitAndCheck(phoneHits, phone, 3600_000, 3)) {
    return c.json({ error: '该手机号提交次数过多，请稍后再试' }, 429);
  }

  try {
    // 同号存在待处理订单则禁止重复提交
    const { data: pending, error: pendingErr } = await supabase
      .from('subscriptionOrders')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'claimed')
      .limit(1);
    if (pendingErr) throw new Error(pendingErr.message);
    if (pending && pending.length > 0) {
      return c.json({ error: '已有待处理订单，请等待管理员开通' }, 409);
    }

    // 老用户下单时直接关联 user_id
    const { data: users } = await supabase
      .from('adminUsers')
      .select('id')
      .eq('username', phone)
      .limit(1);
    const userId = users && users.length > 0 ? users[0].id : null;

    // price 由服务端从常量取快照，不信前端传值
    const order = {
      id: uid(),
      phone,
      user_id: userId,
      plan,
      price: SUBSCRIPTION_PLANS[plan].price,
      status: 'claimed',
      note: null,
      created_at: Date.now(),
      confirmed_at: null,
    };
    const { error } = await supabase.from('subscriptionOrders').insert(order);
    if (error) throw new Error(error.message);

    return c.json({ data: { id: order.id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 2. member 查看自己的订阅信息 + 历史订单（允许已过期用户访问，供续费） =====
subscribe.get('/me', adminAuthAllowExpired, async (c) => {
  const payload = c.get('adminUser');
  const username = payload.username as string;

  try {
    const { data: user, error: userErr } = await supabase
      .from('adminUsers')
      .select('subscription_expires_at')
      .eq('id', payload.sub as string)
      .single();
    if (userErr || !user) {
      return c.json({ error: '用户不存在' }, 404);
    }

    // member 用户名即手机号，按手机号关联历史订单
    const { data: orders, error: ordersErr } = await supabase
      .from('subscriptionOrders')
      .select('*')
      .eq('phone', username)
      .order('created_at', { ascending: false });
    if (ordersErr) throw new Error(ordersErr.message);

    return c.json({
      data: {
        subscription_expires_at: user.subscription_expires_at as number | null,
        orders: (orders ?? []) as SubscriptionOrder[],
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 3. admin 查看全部订单（claimed 置顶，其余按下单时间倒序） =====
subscribe.get('/orders', adminAuth, requireAdmin, async (c) => {
  try {
    const { data, error } = await supabase
      .from('subscriptionOrders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const orders = (data ?? []) as SubscriptionOrder[];
    const sorted = [
      ...orders.filter((o) => o.status === 'claimed'),
      ...orders.filter((o) => o.status !== 'claimed'),
    ];
    return c.json({ data: sorted });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 4. admin 确认开通（幂等：条件更新占位，失败回滚） =====
subscribe.post('/orders/:id/confirm', adminAuth, requireAdmin, async (c) => {
  const { id } = c.req.param();

  try {
    // 条件更新 claimed → confirmed 作为幂等锁：0 行说明已被处理过
    const { data: locked, error: lockErr } = await supabase
      .from('subscriptionOrders')
      .update({ status: 'confirmed' })
      .eq('id', id)
      .eq('status', 'claimed')
      .select();
    if (lockErr) throw new Error(lockErr.message);
    if (!locked || locked.length === 0) {
      return c.json({ error: '订单不存在或已处理' }, 409);
    }
    const order = locked[0] as SubscriptionOrder;

    try {
      const now = Date.now();
      const planDays = SUBSCRIPTION_PLANS[order.plan as SubscriptionPlan].days;
      const durationMs = planDays * 24 * 3600 * 1000;

      const { data: users, error: userErr } = await supabase
        .from('adminUsers')
        .select('id, role, subscription_expires_at')
        .eq('username', order.phone)
        .limit(1);
      if (userErr) throw new Error(userErr.message);

      let userId: string;
      let userCreated = false;
      let expiresAt: number;

      if (!users || users.length === 0) {
        // 无账号 → 自动建号：用户名=手机号，初始密码=手机号后 6 位，角色=member
        userId = uid();
        expiresAt = now + durationMs;
        const passwordHash = await bcrypt.hash(order.phone.slice(-6), 10);
        const { error: createErr } = await supabase.from('adminUsers').insert({
          id: userId,
          username: order.phone,
          password_hash: passwordHash,
          role: 'member',
          subscription_expires_at: expiresAt,
          created_at: now,
        });
        if (createErr) throw new Error(createErr.message);
        userCreated = true;
      } else {
        // 有账号 → 延期：新到期日 = max(当前时间, 原到期日) + 套餐时长；不改动非 member 角色
        const user = users[0];
        userId = user.id as string;
        const prev = (user.subscription_expires_at as number | null) ?? 0;
        expiresAt = Math.max(now, prev) + durationMs;
        const { error: extendErr } = await supabase
          .from('adminUsers')
          .update({ subscription_expires_at: expiresAt })
          .eq('id', userId);
        if (extendErr) throw new Error(extendErr.message);
      }

      const { error: fillErr } = await supabase
        .from('subscriptionOrders')
        .update({ user_id: userId, confirmed_at: now })
        .eq('id', id);
      if (fillErr) throw new Error(fillErr.message);

      return c.json({ data: { user_created: userCreated, expires_at: expiresAt } });
    } catch (inner) {
      // 建号/延期失败则释放幂等锁，允许管理员重试
      await supabase
        .from('subscriptionOrders')
        .update({ status: 'claimed' })
        .eq('id', id);
      throw inner;
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 5. admin 拒绝订单（备注必填） =====
const rejectSchema = z.object({
  note: z.string().min(1, '请填写拒绝原因').max(500),
});

subscribe.post('/orders/:id/reject', adminAuth, requireAdmin, zValidator('json', rejectSchema), async (c) => {
  const { id } = c.req.param();
  const { note } = c.req.valid('json');

  try {
    const { data, error } = await supabase
      .from('subscriptionOrders')
      .update({ status: 'rejected', note, confirmed_at: Date.now() })
      .eq('id', id)
      .eq('status', 'claimed')
      .select();
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return c.json({ error: '订单不存在或已处理' }, 409);
    }
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default subscribe;
