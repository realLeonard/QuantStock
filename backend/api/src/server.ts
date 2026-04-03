import { serve } from '@hono/node-server';
import app from './index';

const PORT = Number(process.env.PORT) || 3001;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`API 服务已启动，端口：${info.port}`);
});
