"""Playwright 浏览器管理：共享单例，所有采集器复用同一个浏览器实例"""

from playwright.sync_api import sync_playwright, Browser, Page

_playwright = None
_browser: Browser | None = None
_page: Page | None = None


def get_page() -> Page:
    """获取或创建浏览器页面（单例）"""
    global _playwright, _browser, _page

    if _page and not _page.is_closed():
        return _page

    if not _playwright:
        _playwright = sync_playwright().start()

    if not _browser:
        _browser = _playwright.chromium.launch(headless=True)

    _page = _browser.new_page()
    # 导航到东财行情页，为 JSONP 提供正确的 origin/referer 上下文
    try:
        _page.goto('https://quote.eastmoney.com/center/gridlist.html',
                   wait_until='domcontentloaded', timeout=15000)
    except Exception:
        # 如果主页加载超时，用 about:blank 兜底
        _page.goto('about:blank')
    return _page


def close_browser():
    """关闭浏览器，释放资源"""
    global _playwright, _browser, _page

    if _page:
        try:
            _page.close()
        except Exception:
            pass
        _page = None

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
