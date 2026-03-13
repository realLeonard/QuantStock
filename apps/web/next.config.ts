import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 将 packages/* 的 TypeScript 源码通过 Transpile 编译
  transpilePackages: [
    '@quantstock/types',
    '@quantstock/api-client',
    '@quantstock/validators',
  ],
};

export default nextConfig;
