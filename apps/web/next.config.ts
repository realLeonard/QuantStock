import type { NextConfig } from 'next';

// Hono API 地址（Vercel/服务器环境变量注入，默认本地 3001）
const API_ORIGIN = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  // 将 packages/* 的 TypeScript 源码通过 Transpile 编译
  transpilePackages: [
    '@quantstock/types',
    '@quantstock/api-client',
    '@quantstock/validators',
  ],
  // 反向代理 Hono API，规避 Vercel HTTPS → 阿里云 HTTP 的 Mixed Content 限制
  async rewrites() {
    return [
      {
        source: '/backend-api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
