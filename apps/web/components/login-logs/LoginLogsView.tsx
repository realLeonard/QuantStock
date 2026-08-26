'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import type { UserRole } from '@quantstock/types';

const ROLE_LABEL: Record<UserRole, string> = {
  admin: '管理员',
  editor: '编辑者',
  viewer: '观察者',
  member: '订阅会员',
};

const PAGE_SIZE = 20;

function fmtTime(utcMs: number): string {
  return new Date(utcMs).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export default function LoginLogsView() {
  const {
    loginLogs, loginLogTotal, loginLogPage, loginLogUsername, loginLogSummary,
    loadLoginLogs, isLoading,
  } = useAppStore();
  const [tab, setTab] = useState<'logs' | 'summary'>('logs');
  const [keyword, setKeyword] = useState('');

  const totalPages = Math.max(1, Math.ceil(loginLogTotal / PAGE_SIZE));

  function handleSearch() {
    loadLoginLogs(1, keyword);
  }

  return (
    <>
      <PageHeader
        title="登录日志"
        desc="记录后台每次登录（含失败尝试）。非 admin 账号已启用单会话互踢：新登录会强制旧会话下线。风险概览用于识别多人共用账号。"
      />

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className={tab === 'logs' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('logs')}
        >
          登录流水
        </button>
        <button
          className={tab === 'summary' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setTab('summary')}
        >
          风险概览（30 天）
        </button>
      </div>

      {tab === 'logs' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              className="form-input"
              style={{ width: 220 }}
              placeholder="按用户名筛选"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="btn-secondary" onClick={handleSearch}>查询</button>
            {loginLogUsername && (
              <button
                className="btn-secondary"
                onClick={() => { setKeyword(''); loadLoginLogs(1, ''); }}
              >
                清除筛选
              </button>
            )}
          </div>

          <div className="table-wrap">
            {loginLogs.length === 0 && !isLoading ? (
              <div className="empty-state">
                <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📋</span>
                <p>暂无登录记录</p>
              </div>
            ) : (
              <table className="stock-table">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>时间</th>
                    <th>账号</th>
                    <th style={{ width: 90 }}>角色</th>
                    <th style={{ width: 130 }}>IP</th>
                    <th style={{ width: 160 }}>归属地</th>
                    <th>浏览器 / 系统 / 设备</th>
                    <th style={{ width: 140 }}>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {loginLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ fontSize: 13, color: '#334155' }}>{fmtTime(log.login_at)}</td>
                      <td style={{ fontWeight: 600 }}>{log.username}</td>
                      <td style={{ fontSize: 13 }}>{log.role ? ROLE_LABEL[log.role] : '—'}</td>
                      <td style={{ fontSize: 13, color: '#64748b' }}>{log.ip ?? '—'}</td>
                      <td style={{ fontSize: 13, color: '#64748b' }}>{log.ip_region ?? '—'}</td>
                      <td style={{ fontSize: 13, color: '#64748b' }}>
                        {[log.browser, log.os, log.device_type].filter(Boolean).join(' / ') || '—'}
                      </td>
                      <td>
                        {log.success ? (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#047857', background: '#ecfdf5', borderRadius: 4, padding: '2px 8px' }}>
                            成功
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', background: '#fef2f2', borderRadius: 4, padding: '2px 8px' }}>
                            失败{log.fail_reason ? `·${log.fail_reason}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 分页 */}
          {loginLogTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>
                共 {loginLogTotal} 条 · 第 {loginLogPage}/{totalPages} 页
              </span>
              <button
                className="btn-secondary"
                disabled={loginLogPage <= 1 || isLoading}
                onClick={() => loadLoginLogs(loginLogPage - 1, loginLogUsername)}
              >
                上一页
              </button>
              <button
                className="btn-secondary"
                disabled={loginLogPage >= totalPages || isLoading}
                onClick={() => loadLoginLogs(loginLogPage + 1, loginLogUsername)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}

      {tab === 'summary' && (
        <div
          style={{
            fontSize: 13, color: '#475569', background: '#f8fafc',
            border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '10px 14px', marginBottom: 12, lineHeight: 1.9,
          }}
        >
          <div style={{ fontWeight: 600, color: '#334155' }}>风险判定规则（近 30 天成功登录）</div>
          <div>
            <span style={{ fontWeight: 600, color: '#dc2626' }}>疑似共用</span>
            ：① 24 小时内出现 ≥2 个不同地区的登录（不可能旅行）；或 ② 单日登录 ≥5 次且来自 ≥2 个不同
            IP（互踢导致的反复重登，覆盖同城共用）
          </div>
          <div>
            <span style={{ fontWeight: 600, color: '#b45309' }}>关注</span>
            ：③ 30 天内出现 ≥2 个不同省份（出差可能误报，请结合登录流水人工研判）
          </div>
          <div style={{ color: '#94a3b8' }}>
            IP 数 / 设备数 / 登录次数仅作参考，不参与判定；标记仅供研判，非实锤（本人多设备使用也会产生相似特征）
          </div>
        </div>
      )}

      {tab === 'summary' && (
        <div className="table-wrap">
          {loginLogSummary.length === 0 ? (
            <div className="empty-state">
              <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🛡️</span>
              <p>近 30 天暂无成功登录记录</p>
            </div>
          ) : (
            <table className="stock-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th style={{ width: 90 }}>角色</th>
                  <th style={{ width: 100 }}>登录次数</th>
                  <th style={{ width: 100 }}>不同 IP</th>
                  <th style={{ width: 100 }}>不同地区</th>
                  <th style={{ width: 100 }}>不同设备</th>
                  <th style={{ width: 170 }}>最近登录</th>
                  <th style={{ width: 110 }}>风险</th>
                </tr>
              </thead>
              <tbody>
                {loginLogSummary.map((s) => (
                  <tr
                    key={s.username}
                    style={
                      s.risk_level === 'high'
                        ? { background: '#fef2f2' }
                        : s.risk_level === 'watch'
                          ? { background: '#fffbeb' }
                          : undefined
                    }
                  >
                    <td style={{ fontWeight: 600 }}>{s.username}</td>
                    <td style={{ fontSize: 13 }}>{s.role ? ROLE_LABEL[s.role] : '—'}</td>
                    <td>{s.login_count}</td>
                    <td>{s.distinct_ips}</td>
                    <td>{s.distinct_regions}</td>
                    <td>{s.distinct_devices}</td>
                    <td style={{ fontSize: 13, color: '#334155' }}>{fmtTime(s.last_login_at)}</td>
                    <td>
                      {s.risk_level === 'high' && (
                        <span
                          title={s.risk_reasons.join('；')}
                          style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', background: '#fee2e2', borderRadius: 4, padding: '2px 8px' }}
                        >
                          疑似共用
                        </span>
                      )}
                      {s.risk_level === 'watch' && (
                        <span
                          title={s.risk_reasons.join('；')}
                          style={{ fontSize: 12, fontWeight: 600, color: '#b45309', background: '#fef3c7', borderRadius: 4, padding: '2px 8px' }}
                        >
                          关注
                        </span>
                      )}
                      {s.risk_level === 'normal' && (
                        <span style={{ fontSize: 12, color: '#047857' }}>正常</span>
                      )}
                      {s.risk_reasons.length > 0 && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                          {s.risk_reasons.join('；')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
