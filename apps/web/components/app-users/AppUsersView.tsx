'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import type { AppUser } from '@quantstock/types';
import PageHeader from '@/components/ui/PageHeader';
import AppUserModal from './AppUserModal';

const PLAN_LABEL: Record<string, string> = {
  free: '免费',
  trial: '试用',
  monthly: '月付',
  quarterly: '季付',
  yearly: '年付',
};

export default function AppUsersView() {
  const { appUsers, isLoading } = useAppStore();
  const [editUser, setEditUser] = useState<AppUser | null>(null);

  return (
    <>
      <div className="section-header">
        <PageHeader title="APP用户管理" desc="查看和管理 App 端注册用户及套餐信息" />
      </div>

      <div className="table-wrap">
        {appUsers.length === 0 && !isLoading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📱</span>
            <p>暂无 App 用户</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>昵称</th>
                <th>手机号</th>
                <th style={{ width: 90 }}>套餐类型</th>
                <th style={{ width: 140 }}>套餐到期</th>
                <th style={{ width: 140 }}>注册时间</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {appUsers.map(user => (
                <tr key={user.id}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{user.nickname ?? '—'}</span>
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{user.phone ?? '—'}</td>
                  <td>
                    <span style={{
                      fontSize: 12,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: user.plan_type === 'free' ? '#f1f5f9' : '#eff6ff',
                      color: user.plan_type === 'free' ? '#64748b' : '#2563eb',
                      fontWeight: 500,
                    }}>
                      {PLAN_LABEL[user.plan_type] ?? user.plan_type}
                    </span>
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {user.plan_expired_at ? fmtDate(user.plan_expired_at) : '永久 / 无'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fmtDate(user.created_at)}</td>
                  <td className="td-actions">
                    <button
                      className="btn-icon"
                      title="编辑套餐"
                      onClick={() => setEditUser(user)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editUser && (
        <AppUserModal user={editUser} onClose={() => setEditUser(null)} />
      )}
    </>
  );
}
