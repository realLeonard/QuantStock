import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import { QuantStockApiClient } from '@quantstock/api-client';
import { themeInputSchema, stockInputSchema } from '@quantstock/validators';

// ===== 环境变量 =====
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';

// ===== 初始化 Supabase 客户端（使用 service key，服务端专用） =====
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const db = new QuantStockApiClient(supabase);

// ===== 简单 ID 生成 =====
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ===== Hono 应用 =====
const app = new Hono().basePath('/api');

// CORS（开发和生产都允许前端域名访问）
app.use('*', cors({
  origin: ['http://localhost:3000', 'https://quantstock.vercel.app'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// ===== 主题路由 =====

// GET /api/themes - 获取所有主题（含嵌套股票）
app.get('/themes', async (c) => {
  try {
    const themes = await db.loadThemes();
    return c.json({ data: themes });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// POST /api/themes - 新增主题
app.post('/themes', zValidator('json', themeInputSchema), async (c) => {
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
app.put('/themes/:id', zValidator('json', themeInputSchema), async (c) => {
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
app.delete('/themes/:id', async (c) => {
  const { id } = c.req.param();
  try {
    await db.deleteTheme(id);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// ===== 股票路由 =====

// POST /api/themes/:themeId/stocks - 新增股票
app.post('/themes/:themeId/stocks', zValidator('json', stockInputSchema), async (c) => {
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
    });
    return c.json({ data: { id } }, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// PUT /api/stocks/:id - 更新股票
app.put('/stocks/:id', zValidator('json', stockInputSchema), async (c) => {
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
    });
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// DELETE /api/stocks/:id - 删除股票
app.delete('/stocks/:id', async (c) => {
  const { id } = c.req.param();
  try {
    await db.deleteStock(id);
    return c.json({ data: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

export default app;
