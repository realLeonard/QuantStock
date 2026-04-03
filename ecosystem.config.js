/**
 * PM2 进程管理配置
 * 用于阿里云宝塔部署，同时管理 Next.js 和 Hono API 两个进程
 *
 * 使用前确保已在服务器根目录创建 .env.server 文件（见 docs/deploy-alicloud.md）
 */
module.exports = {
  apps: [
    {
      // ===== Next.js 管理后台 =====
      name: 'quantstock-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // 崩溃后自动重启，最多重试 10 次
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      // ===== Hono RESTful API =====
      name: 'quantstock-api',
      cwd: './backend/api',
      script: 'dist/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        // 以下环境变量在 .env.server 中配置，PM2 通过 --env 或 env_file 加载
        // SUPABASE_URL=
        // SUPABASE_SERVICE_KEY=
        // JWT_SECRET=
        // ALLOWED_ORIGINS=http://120.77.156.253,http://120.77.156.253:3000
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
