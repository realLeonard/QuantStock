import type { Metadata, Viewport } from 'next';
import './globals.css';
import './mobile.css';

export const metadata: Metadata = {
  title: '观弈｜股票智能小助理',
  description: '静观市场弈局，理性辅助决策',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
