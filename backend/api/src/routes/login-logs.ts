import { Hono } from 'hono';
import type { LoginLogSummary, UserRole } from '@quantstock/types';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const loginLogs = new Hono<{ Variables: Variables }>();

// 登录日志全部接口仅 admin 可用
loginLogs.use('*', adminAuth, requireAdmin);

// GET /api/login-logs?page=1&pageSize=20&username=xxx - 登录流水（分页，倒序）
loginLogs.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const username = c.req.query('username')?.trim() || undefined;
  try {
    const { items, total } = await db.listLoginLogs(page, pageSize, username);
    return c.json({ data: { items, total } });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/login-logs/summary?days=30 - 按账号聚合近 N 天成功登录的风险指标
loginLogs.get('/summary', async (c) => {
  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '30', 10) || 30));
  try {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const logs = await db.listLoginLogsSince(since);

    const acc = new Map<
      string,
      {
        role: UserRole | null;
        count: number;
        ips: Set<string>;
        regions: Set<string>;
        devices: Set<string>;
        lastAt: number;
      }
    >();
    for (const log of logs) {
      let entry = acc.get(log.username);
      if (!entry) {
        entry = { role: log.role, count: 0, ips: new Set(), regions: new Set(), devices: new Set(), lastAt: 0 };
        acc.set(log.username, entry);
      }
      entry.count += 1;
      if (log.ip) entry.ips.add(log.ip);
      if (log.ip_region) entry.regions.add(log.ip_region);
      const device = [log.browser, log.os, log.device_type].filter(Boolean).join(' / ');
      if (device) entry.devices.add(device);
      if (log.login_at > entry.lastAt) {
        entry.lastAt = log.login_at;
        entry.role = log.role;
      }
    }

    const summary: LoginLogSummary[] = [...acc.entries()]
      .map(([username, e]) => ({
        username,
        role: e.role,
        login_count: e.count,
        distinct_ips: e.ips.size,
        distinct_regions: e.regions.size,
        distinct_devices: e.devices.size,
        last_login_at: e.lastAt,
      }))
      .sort((a, b) => b.last_login_at - a.last_login_at);

    return c.json({ data: summary });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default loginLogs;
