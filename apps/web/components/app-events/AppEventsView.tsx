'use client';

import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';

export default function AppEventsView() {
  const { userEvents, isLoading } = useAppStore();

  return (
    <>
      <div className="section-header">
        <PageHeader title="用户行为" desc="查看 App 端用户行为事件记录（只读，最多显示200条）" />
      </div>

      <div className="table-wrap">
        {userEvents.length === 0 && !isLoading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📊</span>
            <p>暂无用户行为记录</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>用户ID</th>
                <th style={{ width: 140 }}>事件类型</th>
                <th style={{ width: 140 }}>目标ID</th>
                <th style={{ width: 90 }}>时长(ms)</th>
                <th style={{ width: 90 }}>平台</th>
                <th style={{ width: 140 }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {userEvents.map(ev => (
                <tr key={ev.id}>
                  <td style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace' }}>
                    {ev.user_id ? ev.user_id.slice(0, 12) + '…' : '—'}
                  </td>
                  <td>
                    <span style={{ fontSize: 12, background: '#f1f5f9', borderRadius: 4, padding: '2px 6px' }}>
                      {ev.event_type}
                    </span>
                  </td>
                  <td style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace' }}>
                    {ev.target_id ? ev.target_id.slice(0, 12) + '…' : '—'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{ev.duration_ms ?? '—'}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{ev.platform ?? '—'}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fmtDate(ev.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
