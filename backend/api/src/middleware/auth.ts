import type { MiddlewareHandler } from 'hono';
import { createClient } from '@supabase/supabase-js';

// ===== context 变量类型（与 index.ts 保持一致） =====
type Env = {
  Variables: {
    authUid: string;
    authPhone: string;
    adminUser: Record<string, unknown>;
  };
};

// ===== 管理后台 JWT 鉴权中间件 =====
// token 由 POST /api/auth/login 签发，secret 存在环境变量 JWT_SECRET
// member 角色每次请求查库校验订阅有效期（JWT 有效期 7 天，不能信 payload 快照，
// 否则到期后凭旧 token 仍可访问 7 天）；allowExpired 供 /subscribe/me 等续费相关接口豁免
function makeAdminAuth(allowExpired: boolean): MiddlewareHandler<Env> {
  return async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: '未授权，缺少 Authorization header' }, 401);
    }

    const token = authHeader.slice(7);
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return c.json({ error: '服务端配置错误：缺少 JWT_SECRET' }, 500);
    }

    let payload: Record<string, unknown>;
    try {
      // 使用 Web Crypto API 验证 HS256 JWT（Node.js 18+ 原生支持）
      payload = await verifyJwt(token, secret);
    } catch {
      return c.json({ error: '无效或过期的 token' }, 401);
    }

    if (!allowExpired && payload.role === 'member') {
      const supabaseUrl = process.env.SUPABASE_URL ?? '';
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? '';
      if (!supabaseUrl || !supabaseServiceKey) {
        return c.json({ error: '服务端配置错误：缺少 Supabase 环境变量' }, 500);
      }
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data, error } = await supabase
        .from('adminUsers')
        .select('subscription_expires_at')
        .eq('id', payload.sub as string)
        .single();
      if (error || !data) {
        return c.json({ error: '用户不存在' }, 401);
      }
      const expiresAt = data.subscription_expires_at as number | null;
      if (typeof expiresAt === 'number' && expiresAt < Date.now()) {
        return c.json({ error: '订阅已到期', code: 'SUBSCRIPTION_EXPIRED' }, 403);
      }
    }

    c.set('adminUser', payload);
    await next();
  };
}

export const adminAuth = makeAdminAuth(false);
export const adminAuthAllowExpired = makeAdminAuth(true);

// ===== 管理员角色校验中间件（需在 adminAuth 之后使用） =====
export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const payload = c.get('adminUser');
  if (payload?.role !== 'admin') {
    return c.json({ error: '需要管理员权限' }, 403);
  }
  await next();
};

// ===== 移动端 Supabase JWT 鉴权中间件 =====
// token 是 Supabase Auth 签发的 access_token，通过 supabase.auth.getUser() 验证
export const mobileAuth: MiddlewareHandler<Env> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '未授权，缺少 Authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY ?? '';

  if (!supabaseUrl || !supabaseServiceKey) {
    return c.json({ error: '服务端配置错误：缺少 Supabase 环境变量' }, 500);
  }

  try {
    // 用 service_key 初始化的 client 调用 getUser，可验证任意用户 token
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return c.json({ error: '无效的 Supabase token' }, 401);
    }
    // 将 auth uid 注入 context，供下游路由读取
    c.set('authUid', data.user.id);
    c.set('authPhone', data.user.phone ?? '');
    await next();
  } catch {
    return c.json({ error: '鉴权失败，请重新登录' }, 401);
  }
};

// ===== HS256 JWT 工具函数 =====

/** 签发 JWT（HS256，默认 7 天有效期） */
export async function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSeconds = 7 * 24 * 3600
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(
    JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds })
  );
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

/** 验证 JWT，返回 payload；失败抛异常 */
export async function verifyJwt(
  token: string,
  secret: string
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('格式无效');

  const [header, body, sig] = parts;
  const expectedSig = await hmacSign(`${header}.${body}`, secret);
  if (sig !== expectedSig) throw new Error('签名校验失败');

  const payload = JSON.parse(base64urlDecode(body)) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) {
    throw new Error('token 已过期');
  }
  return payload;
}

// ===== 内部工具 =====

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString('base64url');
}
