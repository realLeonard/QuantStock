'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import type { AdminUser, UserRole } from '@quantstock/types';
import UserModal from './UserModal';

type UserRow = Omit<AdminUser, 'password_hash'>;

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '观察者',
};

export default function UsersView() {
  const { users, loadUsers, updateUserRole, deleteUser, currentUser, isLoading } = useAppStore();
  const [modalMode, setModalMode] = useState<'create' | 'reset-password' | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  function openCreate() {
    setSelectedUser(null);
    setModalMode('create');
  }

  function openResetPassword(user: UserRow) {
    setSelectedUser(user);
    setModalMode('reset-password');
  }

  async function handleRoleChange(user: UserRow, newRole: UserRole) {
    if (user.username === currentUser?.username) {
      alert('不能修改自己的角色');
      return;
    }
    await updateUserRole(user.id, newRole);
  }

  async function handleDelete(user: UserRow) {
    if (user.username === currentUser?.username) {
      alert('不能删除当前登录的自己');
      return;
    }
    if (!confirm(`确认删除用户「${user.username}」？此操作不可撤销。`)) return;
    await deleteUser(user.id);
  }

  return (
    <>
      <div className="section-header">
        <div>
          <div className="page-title">用户管理</div>
          <div className="page-desc" style={{ marginBottom: 0 }}>管理系统账号与角色分配</div>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          新增用户
        </button>
      </div>

      <div className="table-wrap">
        {users.length === 0 && !isLoading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>👤</span>
            <p>暂无用户</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th style={{ width: 130 }}>角色</th>
                <th style={{ width: 140 }}>创建时间</th>
                <th style={{ width: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isSelf = user.username === currentUser?.username;
                return (
                  <tr key={user.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{user.username}</span>
                      {isSelf && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '1px 6px' }}>
                          当前用户
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        className="form-input"
                        style={{ padding: '4px 8px', fontSize: 13 }}
                        value={user.role}
                        disabled={isSelf}
                        onChange={e => handleRoleChange(user, e.target.value as UserRole)}
                      >
                        <option value="viewer">观察者</option>
                        <option value="editor">编辑者</option>
                        <option value="admin">管理员</option>
                      </select>
                    </td>
                    <td style={{ color: '#64748b', fontSize: 13 }}>
                      {fmtDate(user.created_at)}
                    </td>
                    <td className="td-actions">
                      <button
                        className="btn-icon"
                        title="重置密码"
                        onClick={() => openResetPassword(user)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </button>
                      <button
                        className={`btn-icon danger${isSelf ? ' disabled' : ''}`}
                        title={isSelf ? '不能删除自己' : '删除用户'}
                        onClick={() => !isSelf && handleDelete(user)}
                        style={{ opacity: isSelf ? 0.4 : 1, cursor: isSelf ? 'not-allowed' : 'pointer' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modalMode && (
        <UserModal
          user={selectedUser}
          mode={modalMode}
          onClose={() => { setModalMode(null); setSelectedUser(null); }}
        />
      )}
    </>
  );
}
