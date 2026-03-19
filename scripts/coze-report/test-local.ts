/**
 * 本地测试：自动发送消息到 Coze 并获取微信分享链接
 *
 * 第一次运行：弹出浏览器让你手动登录 coze.cn，60秒内完成登录
 * 后续运行：直接复用保存的 Cookie，全自动
 *
 * 运行命令：npx tsx test-local.ts
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const COZE_TASK_URL = 'https://www.coze.cn/task/7617469957413273871';
const TRIGGER_MESSAGE = '生成今日市场信息深度分析报告';
const COOKIE_FILE = path.join(__dirname, '.coze-cookies.json');
const MAX_WAIT_MS = 10 * 60 * 1000; // 最多等 10 分钟

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });

  const contextOptions: any = { viewport: { width: 1280, height: 800 } };
  if (fs.existsSync(COOKIE_FILE)) {
    contextOptions.storageState = COOKIE_FILE;
    console.log('✅ 已加载保存的登录态');
  } else {
    console.log('⚠️  未找到登录态，将弹出浏览器，请手动登录 coze.cn...');
  }

  const context = await browser.newContext(contextOptions);
  // 授予剪贴板权限
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();

  try {
    // ── 1. 打开首页，检查登录态 ──────────────────────────────
    await page.goto('https://www.coze.cn', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (!fs.existsSync(COOKIE_FILE) || currentUrl.includes('login') || currentUrl.includes('oauth')) {
      console.log('\n👉 请在弹出的浏览器中完成 coze.cn 登录（60秒内）...');
      await countdown(60);
      await context.storageState({ path: COOKIE_FILE });
      console.log('✅ 登录态已保存');
    }

    // ── 2. 进入任务页面 ──────────────────────────────────────
    console.log('导航到 Coze 任务页面...');
    await page.goto(COZE_TASK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'step1-loaded.png' });
    console.log('截图已保存：step1-loaded.png');

    // ── 3. 发送触发消息 ──────────────────────────────────────
    const inputBox = page.locator('[placeholder="发送消息..."], textarea, [contenteditable="true"]').first();
    await inputBox.waitFor({ state: 'visible', timeout: 15000 });
    await inputBox.click();
    await page.keyboard.type(TRIGGER_MESSAGE);
    await page.keyboard.press('Enter');
    console.log(`✅ 已发送：${TRIGGER_MESSAGE}`);

    // ── 4. 等待文字输出完成（停止按钮消失） ──────────────────
    console.log('等待 Bot 开始生成...');
    await page.locator('button[class*="stop"]').waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    console.log('Bot 正在输出文字，等待完成...');
    await page.locator('button[class*="stop"]').waitFor({ state: 'hidden', timeout: MAX_WAIT_MS }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'step2-text-done.png' });
    console.log('✅ 文字输出完成，截图：step2-text-done.png');

    // ── 5. 立刻点击分享（此时还在聊天视图，分享按钮可用） ───
    const shareUrl = await clickShareAndGetUrl(page);

    // ── 6. 等待文件卡片创建完成 ───────────────────────────────
    console.log('等待文件创建完成...');
    await page.waitForFunction(
      () => !document.body.innerText.includes('正在创建'),
      { timeout: MAX_WAIT_MS, polling: 5000 }
    ).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'step3-file-done.png' });
    console.log('✅ 文件创建完成，截图：step3-file-done.png');

    // ── 7. 输出结果 ───────────────────────────────────────────
    if (shareUrl) {
      console.log('\n🎉 微信分享链接：');
      console.log(shareUrl);
    } else {
      console.log('\n⚠️  未获取到分享链接，请检查截图');
    }

  } catch (err) {
    console.error('❌ 出错：', err);
    await page.screenshot({ path: 'error.png' });
  } finally {
    await browser.close();
  }
}

/**
 * 点击聊天页分享按钮，选择公开访问，复制链接
 */
async function clickShareAndGetUrl(page: any): Promise<string | null> {
  await page.screenshot({ path: 'step-before-share.png' });

  // 找右上角所有按钮（y < 60，x > 800）
  const topBtns = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .map(el => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter(r => r.y < 60 && r.y > 0 && r.x > 800 && r.w > 0)
      .sort((a: any, b: any) => b.x - a.x);  // 从右到左
  });
  console.log('右上角按钮：', topBtns);

  // 尝试每个按钮，找到能打开「分享公开对话」弹窗的那个
  for (let i = 0; i < Math.min(topBtns.length, 5); i++) {
    const btn = (topBtns as any[])[i];
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    console.log(`尝试第 ${i + 1} 个按钮 (${cx}, ${cy})...`);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(1500);

    const dialogVisible = await page.locator('text=分享公开对话').isVisible({ timeout: 1000 }).catch(() => false);
    if (dialogVisible) {
      console.log('✅ 分享弹窗已打开');
      await page.screenshot({ path: 'step-share-dialog.png' });
      return await getUrlFromDialog(page);
    }
    // 没打开弹窗，按 Escape 关闭可能打开的东西
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  console.log('⚠️  未能打开分享弹窗，截图：step-before-share.png');
  return null;
}

/**
 * 在已打开的分享弹窗中获取链接
 */
async function getUrlFromDialog(page: any): Promise<string | null> {
  // 确保「公开访问」已选中
  const publicOption = page.locator('text=公开访问').first();
  if (await publicOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await publicOption.click();
    await page.waitForTimeout(500);
  }

  // 监听网络请求，捕获分享 API 的响应
  let capturedUrl: string | null = null;
  const responseHandler = async (response: any) => {
    const url = response.url();
    if (url.includes('share') || url.includes('publish') || url.includes('public')) {
      try {
        const json = await response.json().catch(() => null);
        if (json) {
          const text = JSON.stringify(json);
          const match = text.match(/https?:\\\/\\\/[^"\\]+coze[^"\\]*/);
          if (match) capturedUrl = match[0].replace(/\\\//g, '/');
        }
      } catch {}
    }
  };
  page.on('response', responseHandler);

  // 点「复制链接」
  const copyBtn = page.locator('button:has-text("复制链接")').first();
  await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
  await copyBtn.click();
  await page.waitForTimeout(2000);
  page.off('response', responseHandler);

  // 策略1：从网络响应中拿到的 URL
  if (capturedUrl) {
    console.log('✅ 从网络请求获取链接');
    return capturedUrl;
  }

  // 策略2：读剪贴板
  const clipUrl = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText(); } catch { return null; }
  });
  if (clipUrl && clipUrl.startsWith('http')) {
    console.log('✅ 从剪贴板获取链接');
    return clipUrl;
  }

  // 策略3：用 JS 劫持 writeText，再点一次
  await page.evaluate(() => {
    (window as any).__copiedText = null;
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async (text: string) => {
      (window as any).__copiedText = text;
      return orig(text);
    };
  });
  await copyBtn.click();
  await page.waitForTimeout(1000);
  const hijackedUrl = await page.evaluate(() => (window as any).__copiedText);
  if (hijackedUrl && hijackedUrl.startsWith('http')) {
    console.log('✅ 从劫持剪贴板获取链接');
    return hijackedUrl;
  }

  return null;
}

async function countdown(seconds: number) {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r   剩余 ${String(i).padStart(2, '0')} 秒...`);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\r   倒计时结束，继续执行...   ');
}

main().catch(console.error);
