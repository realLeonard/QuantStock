import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { themeInputSchema, stockInputSchema } from '@quantstock/validators';
import { adminAuth, mobileAuth, signJwt } from './middleware/auth';
import { hitAndCheck, clientIp } from './middleware/rate-limit';
import { db, supabase } from './db';
import subscribe from './routes/subscribe';
import adminData from './routes/admin-data';
import sectors from './routes/sectors';
import adminUsers from './routes/admin-users';
import appUsers from './routes/app-users';
import versions from './routes/versions';
import insights from './routes/insights';
import mobileReports from './routes/mobile-reports';
import loginLogs from './routes/login-logs';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { UAParser } from 'ua-parser-js';
import IP2Region from 'ip2region';
import type { LoginLog, UserRole } from '@quantstock/types';

// ===== 环境变量 =====
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const JWT_SECRET = process.env.JWT_SECRET ?? '';

// ===== ID 生成（密码学安全随机，防枚举） =====
function uid(): string {
  return randomUUID();
}

// ===== Hono context 变量类型 =====
type Variables = {
  authUid: string;
  authPhone: string;
  adminUser: Record<string, unknown>;
};

// ===== Hono 应用 =====
const app = new Hono<{ Variables: Variables }>().basePath('/api');

// CORS（允许管理后台和移动端访问）
app.use('*', cors({
  origin: [
    'http://localhost:3000',
    'https://quantstock.vercel.app',
    // 阿里云服务器（通过 ALLOWED_ORIGINS 环境变量注入）
    ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []),
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// ===== 健康检查 =====
app.get('/health', (c) => c.json({ status: 'ok', ts: Date.now() }));

// ===== 管理后台登录接口（不需要鉴权） =====
// 修复安全漏洞：password_hash 不再传给前端，比对在服务端完成
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// 登录防爆破限流：同 IP 每分钟 5 次，同用户名每小时 10 次
const loginIpHits = new Map<string, number[]>();
const loginUserHits = new Map<string, number[]>();

// ===== 登录日志辅助（ip2region 离线库 + UA 解析，任何失败都不阻塞登录） =====
let ipRegionSearcher: IP2Region | null | undefined;
function parseIpRegion(ip: string): string | null {
  try {
    if (ipRegionSearcher === undefined) {
      ipRegionSearcher = new IP2Region();
    }
    const r = ipRegionSearcher?.search(ip);
    if (!r) return null;
    const region = [r.country, r.province, r.city]
      .filter((s) => s && s !== '0')
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .join(' ');
    return region || null;
  } catch {
    ipRegionSearcher = null;
    return null;
  }
}

interface LoginAttempt {
  user_id: string | null;
  username: string;
  role: UserRole | null;
  ip: string;
  userAgent: string | null;
  success: boolean;
  fail_reason: string | null;
}

// 写日志失败只丢审计记录，绝不影响登录主流程
async function logLogin(attempt: LoginAttempt): Promise<void> {
  try {
    const ua = attempt.userAgent ? new UAParser(attempt.userAgent).getResult() : null;
    const log: LoginLog = {
      id: randomUUID(),
      user_id: attempt.user_id,
      username: attempt.username,
      role: attempt.role,
      login_at: Date.now(),
      ip: attempt.ip || null,
      ip_region: attempt.ip ? parseIpRegion(attempt.ip) : null,
      user_agent: attempt.userAgent,
      browser: ua?.browser.name ? `${ua.browser.name} ${ua.browser.version ?? ''}`.trim() : null,
      os: ua?.os.name ? `${ua.os.name} ${ua.os.version ?? ''}`.trim() : null,
      device_type: ua ? (ua.device.type ?? 'desktop') : null,
      success: attempt.success,
      fail_reason: attempt.fail_reason,
    };
    await db.createLoginLog(log);
  } catch {
    // 吞错：审计缺口可接受，登录可用性优先
  }
}

app.post('/auth/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  const ip = clientIp(c.req.header('x-forwarded-for'));
  const ipOk = hitAndCheck(loginIpHits, ip, 60_000, 5);
  const userOk = hitAndCheck(loginUserHits, username, 3600_000, 10);
  if (!ipOk || !userOk) {
    return c.json({ error: '尝试次数过多，请稍后再试' }, 429);
  }

  if (!JWT_SECRET) {
    return c.json({ error: '服务端配置错误：缺少 JWT_SECRET' }, 500);
  }

  const userAgent = c.req.header('user-agent') ?? null;

  try {
    const user = await db.findUserByUsername(username);
    if (!user) {
      await logLogin({
        user_id: null, username, role: null, ip, userAgent,
        success: false, fail_reason: '用户不存在',
      });
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      await logLogin({
        user_id: user.id, username, role: user.role, ip, userAgent,
        success: false, fail_reason: '密码错误',
      });
      return c.json({ error: '用户名或密码错误' }, 401);
    }

    // 单会话互踢：先落库再签 token，防止"库里 jti 与 token 不一致→自踢"。
    // admin 也写列但校验时豁免（见 middleware/auth.ts）
    const jti = randomUUID();
    await db.updateUserSession(user.id, jti);

    const token = await signJwt(
      { sub: user.id, username: user.username, role: user.role, jti },
      JWT_SECRET
    );

    await logLogin({
      user_id: user.id, username, role: user.role, ip, userAgent,
      success: true, fail_reason: null,
    });

    // subscription_expires_at 仅供前端展示（剩余天数/黄条提醒），
    // 权威校验在 adminAuth 每次查库，不放入 JWT payload
    return c.json({
      data: {
        token,
        user: {
          username: user.username,
          role: user.role,
          subscription_expires_at: user.subscription_expires_at ?? null,
        },
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 订阅路由（下单公开，其余带鉴权，详见 routes/subscribe.ts） =====
app.route('/subscribe', subscribe);

// ===== 后台数据读取路由（adminAuth，详见各 routes/*.ts） =====
app.route('/', adminData);
app.route('/', sectors);
app.route('/', appUsers);
app.route('/', insights);
app.route('/admin-users', adminUsers);
app.route('/login-logs', loginLogs);
app.route('/versions', versions);

// ===== 移动端日报/配置路由（mobileAuth + 服务端会员校验） =====
app.route('/mobile', mobileReports);

// ===== 主题路由（受管理员 JWT 保护） =====

// GET /api/themes - 获取所有主题（含嵌套股票）
app.get('/themes', adminAuth, async (c) => {
  try {
    const themes = await db.loadThemes();
    return c.json({ data: themes });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/themes - 新增主题
app.post('/themes', adminAuth, zValidator('json', themeInputSchema), async (c) => {
  const { name, overview } = c.req.valid('json');
  try {
    const id = uid();
    await db.createTheme(id, name, overview ?? '', Date.now());
    return c.json({ data: { id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PUT /api/themes/:id - 更新主题
app.put('/themes/:id', adminAuth, zValidator('json', themeInputSchema), async (c) => {
  const { id } = c.req.param();
  const { name, overview } = c.req.valid('json');
  try {
    await db.updateTheme(id, name, overview ?? '');
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/themes/:id - 删除主题（级联删除股票）
app.delete('/themes/:id', adminAuth, async (c) => {
  const { id } = c.req.param();
  try {
    await db.deleteTheme(id);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 股票路由（受管理员 JWT 保护） =====

// POST /api/themes/:themeId/stocks - 新增股票
app.post('/themes/:themeId/stocks', adminAuth, zValidator('json', stockInputSchema), async (c) => {
  const { themeId } = c.req.param();
  const input = c.req.valid('json');
  try {
    const id = uid();
    await db.createStock(themeId, id, {
      ...input,
      cat1: input.cat1 ?? '',
      cat2: input.cat2 ?? '',
      cat3: input.cat3 ?? '',
      relation: input.relation ?? '',
      highlight: input.highlight ?? '',
      sort_order: null,
    });
    return c.json({ data: { id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PUT /api/stocks/:id - 更新股票
app.put('/stocks/:id', adminAuth, zValidator('json', stockInputSchema), async (c) => {
  const { id } = c.req.param();
  const input = c.req.valid('json');
  try {
    await db.updateStock(id, {
      ...input,
      cat1: input.cat1 ?? '',
      cat2: input.cat2 ?? '',
      cat3: input.cat3 ?? '',
      relation: input.relation ?? '',
      highlight: input.highlight ?? '',
      sort_order: null,
    });
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/stocks/:id - 删除股票
app.delete('/stocks/:id', adminAuth, async (c) => {
  const { id } = c.req.param();
  try {
    await db.deleteStock(id);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 移动端路由（受 Supabase JWT 保护） =====

// POST /api/mobile/user/sync - 首次登录后同步/创建用户，激活试用
app.post('/mobile/user/sync', mobileAuth, async (c) => {
  const authUid = c.get('authUid') as string;
  const authPhone = c.get('authPhone') as string;

  try {
    // 先查是否已存在
    const { data: existingList } = await supabase
      .from('appUsers')
      .select('*')
      .eq('auth_id', authUid)
      .limit(1);

    if (existingList && existingList.length > 0) {
      // 已存在，更新最后登录时间
      await supabase
        .from('appUsers')
        .update({ last_login_at: Date.now() })
        .eq('auth_id', authUid);
      return c.json({ data: { ...existingList[0], last_login_at: Date.now() } });
    }

    // 新用户：创建并激活 3 天试用
    const now = Date.now();
    const trialExpiredAt = now + 3 * 24 * 60 * 60 * 1000;
    const newUser = {
      id: uid(),
      auth_id: authUid,
      phone: authPhone,
      plan_type: 'trial',
      plan_expired_at: trialExpiredAt,
      last_login_at: now,
      created_at: now,
    };

    const { data: created, error } = await supabase
      .from('appUsers')
      .insert(newUser)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return c.json({ data: created }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/mobile/user/me - 获取当前用户信息
app.get('/mobile/user/me', mobileAuth, async (c) => {
  const authUid = c.get('authUid') as string;

  try {
    const { data, error } = await supabase
      .from('appUsers')
      .select('*')
      .eq('auth_id', authUid)
      .single();

    if (error || !data) {
      return c.json({ error: '用户不存在' }, 404);
    }
    return c.json({ data });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PATCH /api/mobile/user/profile - 更新昵称/头像
const profileSchema = z.object({
  nickname: z.string().max(50).optional(),
  // 头像仅允许本站 Supabase Storage 公开桶地址，防外链/未来 SSRF
  avatar_url: z
    .string()
    .url()
    .max(500)
    .refine(
      (u) => u.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`),
      '头像地址必须为本站存储'
    )
    .optional(),
});

app.patch('/mobile/user/profile', mobileAuth, zValidator('json', profileSchema), async (c) => {
  const authUid = c.get('authUid') as string;
  const patch = c.req.valid('json');

  try {
    const { error } = await supabase
      .from('appUsers')
      .update(patch)
      .eq('auth_id', authUid);

    if (error) throw new Error(error.message);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/mobile/events - 上报行为事件
const eventSchema = z.object({
  event_type: z.string().min(1),
  target_id: z.string().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  platform: z.string().optional(),
});

app.post('/mobile/events', mobileAuth, zValidator('json', eventSchema), async (c) => {
  const authUid = c.get('authUid') as string;
  const body = c.req.valid('json');

  // 静默处理，事件上报失败不返回错误
  try {
    await supabase.from('userEvents').insert({
      id: uid(),
      user_id: authUid,
      event_type: body.event_type,
      target_id: body.target_id ?? null,
      duration_ms: body.duration_ms ?? null,
      platform: body.platform ?? 'android',
      created_at: Date.now(),
    });
  } catch {
    // 忽略错误
  }

  return c.json({ data: null });
});

// POST /api/mobile/feedback - 提交用户反馈
const feedbackSchema = z.object({
  content: z.string().min(1).max(2000),
  contact: z.string().max(100).optional(),
  platform: z.string().optional(),
});

app.post('/mobile/feedback', mobileAuth, zValidator('json', feedbackSchema), async (c) => {
  const authUid = c.get('authUid') as string;
  const body = c.req.valid('json');

  try {
    const { error } = await supabase.from('userFeedback').insert({
      id: uid(),
      user_id: authUid,
      content: body.content,
      contact: body.contact ?? null,
      platform: body.platform ?? 'android',
      created_at: Date.now(),
    });

    if (error) throw new Error(error.message);
    return c.json({ data: null }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/mobile/version - 获取最新版本控制信息
app.get('/mobile/version', mobileAuth, async (c) => {
  try {
    const { data, error } = await supabase
      .from('appVersionControl')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return c.json({ data: null });
    }
    return c.json({ data });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ─── 东财 API 代理（供 GitHub Actions 采集脚本使用） ───

app.get('/proxy/eastmoney', async (c) => {
  const key = c.req.header('X-Proxy-Key');
  const expected = process.env.PROXY_API_KEY;
  if (!expected || key !== expected) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  // 只透传东财 clist 接口的已知参数，其余丢弃
  const ALLOWED_PARAMS = new Set([
    'cb', 'secid', 'ut', 'fields', 'pn', 'pz', 'po', 'np',
    'fltt', 'invt', 'fid', 'fid0', 'fs', 'stat',
  ]);
  const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
  for (const [k, v] of Object.entries(c.req.query())) {
    if (ALLOWED_PARAMS.has(k)) {
      url.searchParams.set(k, v);
    }
  }

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        'Referer': 'https://data.eastmoney.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    const text = await resp.text();
    return c.text(text, resp.status as 200);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

export default app;
