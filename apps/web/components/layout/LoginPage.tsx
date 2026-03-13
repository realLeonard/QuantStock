'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { setLoggedIn, loadThemes } = useAppStore();

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (username.trim() === 'admin' && password === '123456') {
      sessionStorage.setItem('admin_logged_in', '1');
      setLoggedIn(true);
      loadThemes();
    } else {
      setError('账号或密码错误，请重试');
      setPassword('');
    }
  }

  return (
    <div className="page-login">
      <div className="login-card">
        <div className="login-logo">
          <div className="login-logo-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
              <polyline points="16 7 22 7 22 13"/>
            </svg>
          </div>
          <span className="login-logo-name">股海罗盘</span>
        </div>
        <div className="login-subtitle">投资主题与股票池管理后台</div>

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
            />
          </div>

          <button className="login-btn" type="submit">登录</button>
        </form>

        <p className="login-error">{error}</p>
        <div className="login-hint">
          演示账号：<b>admin</b> &nbsp;/&nbsp; 密码：<b>123456</b>
        </div>
      </div>
    </div>
  );
}
