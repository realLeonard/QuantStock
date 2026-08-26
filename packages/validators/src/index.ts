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

// ===== 后台用户管理 =====
export const createAdminUserSchema = z.object({
  username: z.string().min(1, '请输入用户名').max(50, '用户名最多50字'),
  password: z.string().min(6, '密码至少6位').max(72, '密码最多72位'),
  role: z.enum(['viewer', 'editor', 'admin', 'member']),
});

export type CreateAdminUserSchema = z.infer<typeof createAdminUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(6, '密码至少6位').max(72, '密码最多72位'),
});

export type ResetPasswordSchema = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  newPassword: z.string().min(6, '密码至少6位').max(72, '密码最多72位'),
});

export type ChangePasswordSchema = z.infer<typeof changePasswordSchema>;

export const updateRoleSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin', 'member']),
});

export type UpdateRoleSchema = z.infer<typeof updateRoleSchema>;

// ===== App 版本管理 =====
export const versionInputSchema = z.object({
  version: z.string().min(1, '请输入版本号').max(20),
  is_force_update: z.boolean(),
  value_desc: z.string().max(1000).optional().default(''),
});

export type VersionInputSchema = z.infer<typeof versionInputSchema>;

export const versionPatchSchema = z.object({
  version: z.string().min(1).max(20).optional(),
  is_force_update: z.boolean().optional(),
  value_desc: z.string().max(1000).optional(),
});

export type VersionPatchSchema = z.infer<typeof versionPatchSchema>;

// ===== 近期掘金 =====
export const insightsInputSchema = z.object({
  thoughts: z.string().max(5000).default(''),
  focus_direction: z.string().max(5000).default(''),
});

export type InsightsInputSchema = z.infer<typeof insightsInputSchema>;

// ===== App 用户套餐调整 =====
export const planUpdateSchema = z.object({
  plan_type: z.enum(['free', 'trial', 'monthly', 'quarterly', 'yearly']),
  plan_expired_at: z.number().int().nullable(),
});

export type PlanUpdateSchema = z.infer<typeof planUpdateSchema>;
