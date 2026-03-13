import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '股海罗盘 · 后台管理',
  description: '投资主题与股票池管理系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
