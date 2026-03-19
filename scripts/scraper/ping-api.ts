import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({ timeout: 15000 });
const start = Date.now();
try {
  await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  console.log('API 响应耗时: ' + (Date.now() - start) + 'ms');
} catch(e) {
  console.log('API 失败: ' + (e as Error).message + ' (' + (Date.now() - start) + 'ms)');
}
