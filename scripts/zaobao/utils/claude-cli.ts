import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';

/**
 * 通过 Claude CLI 调用模型，返回生成内容
 * @param prompt 完整 prompt（system + user 拼接）
 * @param label 标签，用于临时文件命名和错误信息
 */
export function callClaude(prompt: string, label: string): string {
  const promptPath = `/tmp/${label}-${Date.now()}.txt`;
  fs.writeFileSync(promptPath, prompt);

  const cliInput =
    `请用 Read 工具读取文件 ${promptPath}，然后严格按照文件中的指令要求输出内容。直接输出内容，不要输出 markdown 代码块包裹。`;

  const startMs = Date.now();
  const result = spawnSync('claude', [
    '-p', '--no-session-persistence',
    '--allowedTools', 'Read',
    '--model', 'claude-opus-4-6',
  ], {
    timeout: 600_000,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    input: cliInput,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });

  const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`  [claude-cli] ${label} 完成，耗时 ${elapsedSec}s，退出码 ${result.status}`);

  try { fs.unlinkSync(promptPath); } catch {}

  if (result.status !== 0) {
    const errMsg = (result.stderr || result.stdout || '').slice(-500);
    throw new Error(`Claude CLI 失败 (${label}, 退出码 ${result.status}): ${errMsg}`);
  }

  return result.stdout.trim();
}
