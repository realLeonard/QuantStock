"""K 线连通性测试：只拉 3 个板块验证 JSONP 是否正常，不写 DB"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from browser import get_page, close_browser

TEST_SECTORS = [
    ('CPO概念', 'BK0927'),
    ('人工智能', 'BK1127'),
    ('军工', 'BK0478'),
]


def main():
    print('K 线 JSONP 连通性测试')
    print('=' * 40)

    page = get_page()
    print(f'浏览器页面: {page.url[:50]}')

    success = 0
    for name, bk_code in TEST_SECTORS:
        try:
            result = page.evaluate('''({ bkCode }) => {
                return new Promise((resolve, reject) => {
                    const cb = 'kl_' + bkCode + '_' + Date.now();
                    window[cb] = (data) => {
                        delete window[cb];
                        try { document.head.removeChild(s); } catch(e) {}
                        if (data && data.data && data.data.klines) {
                            const kl = data.data.klines;
                            resolve({ count: kl.length, last: kl.slice(-1)[0] });
                        } else {
                            resolve({ count: 0 });
                        }
                    };
                    const s = document.createElement('script');
                    s.src = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?cb=' + cb
                        + '&secid=90.' + bkCode
                        + '&fields1=f1,f2,f3,f4,f5,f6'
                        + '&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'
                        + '&klt=101&fqt=0&lmt=5&end=20500101'
                        + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
                    s.onerror = () => {
                        delete window[cb];
                        try { document.head.removeChild(s); } catch(e) {}
                        reject('load_error');
                    };
                    document.head.appendChild(s);
                    setTimeout(() => {
                        if (window[cb]) { delete window[cb]; reject('timeout'); }
                    }, 10000);
                });
            }''', {'bkCode': bk_code})

            if result.get('count', 0) > 0:
                print(f'  ✓ {name}({bk_code}): {result["count"]}条, 最新={result["last"]}')
                success += 1
            else:
                print(f'  ✗ {name}({bk_code}): 无数据')
        except Exception as e:
            print(f'  ✗ {name}({bk_code}): {e}')

    close_browser()

    print('=' * 40)
    print(f'结果: {success}/{len(TEST_SECTORS)} 成功')

    if success == 0:
        print('[FAIL] K 线 JSONP 完全不可用')
        sys.exit(1)
    elif success < len(TEST_SECTORS):
        print('[WARN] 部分失败')
    else:
        print('[PASS] 全部通过')


if __name__ == '__main__':
    main()
