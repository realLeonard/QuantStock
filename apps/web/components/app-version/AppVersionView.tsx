'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import type { AppVersionControl } from '@quantstock/types';
import PageHeader from '@/components/ui/PageHeader';
import AppVersionModal from './AppVersionModal';

export default function AppVersionView() {
  const { appVersions, isLoading } = useAppStore();
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editVersion, setEditVersion] = useState<AppVersionControl | null>(null);

  function openCreate() {
    setEditVersion(null);
    setModalMode('create');
  }

  function openEdit(v: AppVersionControl) {
    setEditVersion(v);
    setModalMode('edit');
  }

  return (
    <>
      <div className="section-header">
        <div>
          <PageHeader title="管理控制" desc="管理 App 版本发布与强制升级策略" />
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          发布新版本
        </button>
      </div>

      <div className="table-wrap">
        {appVersions.length === 0 && !isLoading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🚀</span>
            <p>暂无版本记录</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>版本号</th>
                <th style={{ width: 110 }}>强制升级</th>
                <th>版本说明</th>
                <th style={{ width: 140 }}>创建时间</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {appVersions.map(v => (
                <tr key={v.id}>
                  <td>
                    <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{v.version}</span>
                  </td>
                  <td>
                    {v.is_force_update ? (
                      <span style={{ fontSize: 12, background: '#fee2e2', color: '#dc2626', borderRadius: 4, padding: '2px 8px', fontWeight: 500 }}>
                        强制升级
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, background: '#f1f5f9', color: '#64748b', borderRadius: 4, padding: '2px 8px' }}>
                        可选升级
                      </span>
                    )}
                  </td>
                  <td style={{ color: '#374151', fontSize: 13, maxWidth: 320, wordBreak: 'break-all' }}>
                    {v.value_desc || '—'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fmtDate(v.created_at)}</td>
                  <td className="td-actions">
                    <button
                      className="btn-icon"
                      title="编辑"
                      onClick={() => openEdit(v)}
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

      {modalMode && (
        <AppVersionModal
          mode={modalMode}
          version={editVersion}
          onClose={() => { setModalMode(null); setEditVersion(null); }}
        />
      )}
    </>
  );
}
