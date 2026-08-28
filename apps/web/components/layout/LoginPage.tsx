'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import NeuralBackground from './NeuralBackground';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loadThemes, loadReports, loadDailyReviews } = useAppStore();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      const ok = await login(username.trim(), password);
      if (ok) {
        loadThemes();
        loadReports();
        loadDailyReviews();
      } else {
        setError('账号或密码错误，请重试');
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-login">
      <NeuralBackground />

      <div className="login-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="观弈" className="login-hero-logo" />
        <div className="login-hero-text">
          <div className="login-hero-row">
            <h1 className="login-hero-title">观弈</h1>
            <span className="login-hero-sub">股票智能小助理</span>
          </div>
          <div className="login-slogan">静观市场弈局&nbsp;·&nbsp;理性辅助决策</div>
        </div>
      </div>

      <div className="login-card">
        <form onSubmit={handleLogin}>
          <label className="login-label">账号</label>
          <div className="login-input-wrap">
            <span className="login-input-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </span>
            <input
              className="login-input"
              type="text"
              placeholder="请输入账号"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              disabled={loading}
            />
          </div>

          <label className="login-label">密码</label>
          <div className="login-input-wrap">
            <span className="login-input-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input
              className="login-input"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              disabled={loading}
            />
          </div>

          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="login-error">{error}</p>

        <div className="login-subscribe-hint">
          如果还没有账号，请前往订阅获得账号权限
          <a className="login-subscribe-link" href="/subscribe">&gt;&gt;&gt;去订阅&gt;&gt;&gt;</a>
        </div>
      </div>

      <footer className="login-footer">
        ⚠️本产品仅为信息辅助工具，不构成任何投资建议，所有交易决策请用户自行负责，投资有风险，入市需谨慎
      </footer>
    </div>
  );
}
