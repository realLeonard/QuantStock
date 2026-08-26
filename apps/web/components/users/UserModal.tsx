'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { AdminUser, UserRole } from '@quantstock/types';

interface Props {
  // null = 新增模式；有值 = 重置密码模式
  user: Omit<AdminUser, 'password_hash'> | null;
  mode: 'create' | 'reset-password';
  onClose: () => void;
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'viewer', label: '观察者' },
  { value: 'editor', label: '编辑者' },
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '订阅会员' },
];

export default function UserModal({ user, mode, onClose }: Props) {
  const { createUser, resetUserPassword } = useAppStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!password.trim()) { setError('密码不能为空'); return; }
    if (password !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    if (password.length < 6) { setError('密码长度不能少于 6 位'); return; }

    if (mode === 'create') {
      if (!username.trim()) { setError('用户名不能为空'); return; }
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await createUser(username.trim(), password, role);
      } else if (user) {
        await resetUserPassword(user.id, password);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'create' ? '新增用户' : `重置密码 · ${user?.username}`;

  return (
    <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          {mode === 'create' && (
            <div className="form-group">
              <label className="form-label">用户名</label>
              <input
                className="form-input"
                type="text"
                placeholder="请输入用户名"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={saving}
                autoFocus
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">{mode === 'create' ? '初始密码' : '新密码'}</label>
            <input
              className="form-input"
              type="password"
              placeholder="请输入密码（至少 6 位）"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={saving}
              autoFocus={mode === 'reset-password'}
            />
          </div>

          <div className="form-group">
            <label className="form-label">确认密码</label>
            <input
              className="form-input"
              type="password"
              placeholder="再次输入密码"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              disabled={saving}
            />
          </div>

          {mode === 'create' && (
            <div className="form-group">
              <label className="form-label">角色</label>
              <select
                className="form-input"
                value={role}
                onChange={e => setRole(e.target.value as UserRole)}
                disabled={saving}
              >
                {ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : '确认'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
