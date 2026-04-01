'use client';

import { useAppStore } from '@/store';
import { fmtDate } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';

export default function AppFeedbackView() {
  const { userFeedbacks, isLoading } = useAppStore();

  return (
    <>
      <div className="section-header">
        <PageHeader title="用户反馈" desc="查看 App 端用户提交的反馈内容（只读）" />
      </div>

      <div className="table-wrap">
        {userFeedbacks.length === 0 && !isLoading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>💬</span>
            <p>暂无用户反馈</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>用户ID</th>
                <th>反馈内容</th>
                <th style={{ width: 140 }}>联系方式</th>
                <th style={{ width: 90 }}>平台</th>
                <th style={{ width: 140 }}>提交时间</th>
              </tr>
            </thead>
            <tbody>
              {userFeedbacks.map(fb => (
                <tr key={fb.id}>
                  <td style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace' }}>
                    {fb.user_id ? fb.user_id.slice(0, 12) + '…' : '—'}
                  </td>
                  <td style={{ maxWidth: 320, wordBreak: 'break-all' }}>{fb.content}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fb.contact ?? '—'}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fb.platform ?? '—'}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>{fmtDate(fb.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
