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

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startMs = Date.now();
    const result = spawnSync('claude', [
      '-p', '--no-session-persistence',
      '--allowedTools', 'Read',
      '--model', 'claude-opus-4-6',
    ], {
      timeout: 900_000,
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

    if (result.status === 0) {
      try { fs.unlinkSync(promptPath); } catch {}
      return result.stdout.trim();
    }

    const errMsg = (result.stderr || result.stdout || '').slice(-500);
    const isRetryable = /\b(499|timeout|timed out|ECONNRESET|ECONNREFUSED|5\d\d)\b/i.test(errMsg);
    if (attempt < maxAttempts && isRetryable) {
      console.log(`  [claude-cli] ${label} 可重试错误，30s 后第 ${attempt + 1} 次尝试...`);
      spawnSync('sleep', ['30']);
      continue;
    }

    try { fs.unlinkSync(promptPath); } catch {}
    throw new Error(`Claude CLI 失败 (${label}, 退出码 ${result.status}): ${errMsg}`);
  }

  try { fs.unlinkSync(promptPath); } catch {}
  throw new Error(`Claude CLI 失败 (${label}): 重试耗尽`);
}
