"""Playwright 浏览器管理：共享单例，所有采集器复用同一个浏览器实例"""

from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page

_playwright = None
_browser: Browser | None = None
_context: BrowserContext | None = None
_page: Page | None = None


def _ensure_browser():
    """确保浏览器和 context 已启动"""
    global _playwright, _browser, _context

    if _browser:
        return

    if not _playwright:
        _playwright = sync_playwright().start()

    _browser = _playwright.chromium.launch(headless=True)
    _context = _browser.new_context()


def get_page() -> Page:
    """获取或创建浏览器页面（单例，用于 JSONP 调用）"""
    global _page

    _ensure_browser()

    if _page and not _page.is_closed():
        return _page

    _page = _context.new_page()
    # 导航到东财行情页，为 JSONP 提供正确的 origin/referer 上下文
    try:
        _page.goto('https://quote.eastmoney.com/center/gridlist.html',
                   wait_until='domcontentloaded', timeout=15000)
    except Exception:
        _page.goto('about:blank')
    return _page


def get_context() -> BrowserContext:
    """获取浏览器 context（用于 context.request HTTP 请求）"""
    _ensure_browser()
    return _context


def close_browser():
    """关闭浏览器，释放资源"""
    global _playwright, _browser, _context, _page

    if _page:
        try:
            _page.close()
        except Exception:
            pass
        _page = None

    if _context:
        try:
            _context.close()
        except Exception:
            pass
        _context = None

    if _browser:
        try:
            _browser.close()
        except Exception:
            pass
        _browser = None

    if _playwright:
        try:
            _playwright.stop()
        except Exception:
            pass
        _playwright = None
