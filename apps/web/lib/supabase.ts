import { createClient } from '@supabase/supabase-js';
import { QuantStockApiClient } from '@quantstock/api-client';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// 单例：Supabase 原生客户端（组件直接用 Supabase 时需要）
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 单例：封装好的 API 客户端
export const apiClient = new QuantStockApiClient(supabase);
