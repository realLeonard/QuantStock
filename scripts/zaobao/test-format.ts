import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { sendWxPush } from './notify.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../apps/web/.env.local') });

const testContent = `# 格式测试

## 一、粗体（当前用法）
**油气/煤化工** **电力/绿电** **商业航天**

## 二、三级标题
### 油气/煤化工
### 电力/绿电

## 三、引用块
> 油气/煤化工
> 电力/绿电

## 四、纯文字 + emoji
🔹 油气/煤化工
🔹 电力/绿电

## 五、行内代码
\`油气/煤化工\` \`电力/绿电\`

## 六、无格式纯文字
油气/煤化工  电力/绿电`;

async function main() {
  await sendWxPush('格式测试', testContent, '测试各种Markdown格式在黑色背景下的可读性');
}
main();
