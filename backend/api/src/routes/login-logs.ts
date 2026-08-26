import { Hono } from 'hono';
import type { LoginLogSummary, LoginRiskLevel, UserRole } from '@quantstock/types';
import { adminAuth, requireAdmin } from '../middleware/auth';
import { db } from '../db';

type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

const loginLogs = new Hono<{ Variables: Variables }>();

const DAY_MS = 24 * 60 * 60 * 1000;
const KICK_WAR_DAILY_LOGINS = 5; // 单日登录次数阈值（互踢战特征）

// "中国 广东省 深圳市" → "广东省"；"内网" 等单段字符串原样返回
function provinceOf(region: string): string {
  const parts = region.split(' ');
  return parts[1] ?? parts[0];
}

// 北京时间日期键（DB 存 UTC 毫秒，按东八区切天）
function beijingDateKey(utcMs: number): string {
  return new Date(utcMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 两级风险判定：
// 🔴 high（疑似共用）——共用账号的两个直接特征：
//   ① 24h 内出现 ≥2 个不同地区的登录（不可能旅行）
//   ② 单日登录 ≥5 次且来自 ≥2 个不同 IP（互踢战：两人共用会互相踢下线、被迫反复重登）
// 🟡 watch（关注）——③ 跨省 ≥2，弱信号需人工看流水（同省跨市多为基站漂移/通勤，不计）
// IP 数/设备数不参与判定：正常人家里+公司+手机流量即有 3+ 个 IP，误报率过高
function assessRisk(
  logins: { at: number; ip: string | null; region: string | null }[],
): { level: LoginRiskLevel; reasons: string[] } {
  const sorted = [...logins].sort((a, b) => a.at - b.at);
  const reasons: string[] = [];

  // ① 24h 滑动窗口内跨地区：记录每个地区最近出现时间，与当前登录比对
  const lastSeenByRegion = new Map<string, number>();
  let crossRegion24h = false;
  for (const l of sorted) {
    if (!l.region) continue;
    for (const [region, at] of lastSeenByRegion) {
      if (region !== l.region && l.at - at <= DAY_MS) {
        crossRegion24h = true;
        break;
      }
    }
    if (crossRegion24h) break;
    lastSeenByRegion.set(l.region, l.at);
  }
  if (crossRegion24h) reasons.push('24小时内出现跨地区登录');

  // ② 互踢战：按北京时间切天，单日 ≥5 次且 ≥2 个 IP
  const byDay = new Map<string, { count: number; ips: Set<string> }>();
  for (const l of sorted) {
    const key = beijingDateKey(l.at);
    let day = byDay.get(key);
    if (!day) {
      day = { count: 0, ips: new Set() };
      byDay.set(key, day);
    }
    day.count += 1;
    if (l.ip) day.ips.add(l.ip);
  }
  const kickWar = [...byDay.values()].some(
    (d) => d.count >= KICK_WAR_DAILY_LOGINS && d.ips.size >= 2,
  );
  if (kickWar) reasons.push(`单日登录≥${KICK_WAR_DAILY_LOGINS}次且来自多个IP`);

  if (reasons.length > 0) return { level: 'high', reasons };

  // ③ 跨省
  const provinces = new Set(
    sorted.filter((l) => l.region).map((l) => provinceOf(l.region as string)),
  );
  if (provinces.size >= 2) return { level: 'watch', reasons: ['存在跨省登录'] };

  return { level: 'normal', reasons: [] };
}

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
        logins: { at: number; ip: string | null; region: string | null }[];
      }
    >();
    for (const log of logs) {
      let entry = acc.get(log.username);
      if (!entry) {
        entry = {
          role: log.role, count: 0, ips: new Set(), regions: new Set(),
          devices: new Set(), lastAt: 0, logins: [],
        };
        acc.set(log.username, entry);
      }
      entry.count += 1;
      if (log.ip) entry.ips.add(log.ip);
      if (log.ip_region) entry.regions.add(log.ip_region);
      const device = [log.browser, log.os, log.device_type].filter(Boolean).join(' / ');
      if (device) entry.devices.add(device);
      entry.logins.push({ at: log.login_at, ip: log.ip, region: log.ip_region });
      if (log.login_at > entry.lastAt) {
        entry.lastAt = log.login_at;
        entry.role = log.role;
      }
    }

    const RISK_ORDER: Record<LoginRiskLevel, number> = { high: 0, watch: 1, normal: 2 };
    const summary: LoginLogSummary[] = [...acc.entries()]
      .map(([username, e]) => {
        const { level, reasons } = assessRisk(e.logins);
        return {
          username,
          role: e.role,
          login_count: e.count,
          distinct_ips: e.ips.size,
          distinct_regions: e.regions.size,
          distinct_devices: e.devices.size,
          last_login_at: e.lastAt,
          risk_level: level,
          risk_reasons: reasons,
        };
      })
      .sort(
        (a, b) =>
          RISK_ORDER[a.risk_level] - RISK_ORDER[b.risk_level] || b.last_login_at - a.last_login_at,
      );

    return c.json({ data: summary });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default loginLogs;
