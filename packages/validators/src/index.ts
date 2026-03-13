import { z } from 'zod';

// ===== 主题验证 =====
export const themeInputSchema = z.object({
  name: z.string().min(1, '主题名称不能为空').max(50, '主题名称最多50字'),
  overview: z.string().max(500, '概述最多500字').optional().default(''),
});

export type ThemeInputSchema = z.infer<typeof themeInputSchema>;

// ===== 股票验证 =====
export const stockInputSchema = z.object({
  code: z.string().min(1, '股票代码不能为空').max(10, '代码最多10位'),
  name: z.string().min(1, '股票名称不能为空').max(20, '名称最多20字'),
  cat1: z.string().max(20).optional().default(''),
  cat2: z.string().max(20).optional().default(''),
  cat3: z.string().max(20).optional().default(''),
  relation: z.string().max(200, '相关性说明最多200字').optional().default(''),
  stars: z.number().int().min(1).max(5).default(3),
  highlight: z.enum(['', 'red', 'orange']).default(''),
});

export type StockInputSchema = z.infer<typeof stockInputSchema>;

// ===== 登录验证 =====
export const loginSchema = z.object({
  username: z.string().min(1, '请输入账号'),
  password: z.string().min(1, '请输入密码'),
});

export type LoginSchema = z.infer<typeof loginSchema>;
