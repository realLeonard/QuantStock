'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import { SUBSCRIPTION_PLANS } from '@quantstock/types';
import type { SessionUser, SubscriptionOrder, SubscriptionPlan } from '@quantstock/types';
import { remainingDays, formatExpireDate } from '@/lib/subscription';
import styles from './SubscriptionView.module.css';

const API_BASE = '/backend-api';

const STATUS_LABEL: Record<string, string> = {
  claimed: '待确认',
  confirmed: '已开通',
  rejected: '已拒绝',
};

function statusClass(status: string): string {
  if (status === 'claimed') return styles.badgeClaimed;
  if (status === 'confirmed') return styles.badgeConfirmed;
  return styles.badgeRejected;
}

function planLabel(plan: string): string {
  return SUBSCRIPTION_PLANS[plan as SubscriptionPlan]?.label ?? plan;
}

/** UTC 毫秒 → 北京时间「MM-DD HH:mm」 */
function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('admin_token') ?? '';
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export default function SubscriptionView() {
  const currentUser = useAppStore((s) => s.currentUser);
  if (currentUser?.role === 'admin') return <AdminOrdersView />;
  return <MemberSubscriptionView />;
}

// ===== admin：全部订单管理 =====

function AdminOrdersView() {
  const showToast = useAppStore((s) => s.showToast);
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectOrder, setRejectOrder] = useState<SubscriptionOrder | null>(null);
  const [resultMsg, setResultMsg] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/subscribe/orders`, { headers: authHeaders() });
      const json = (await res.json()) as { data?: SubscriptionOrder[]; error?: string };
      if (!res.ok || !json.data) throw new Error(json.error ?? '加载失败');
      setOrders(json.data);
      // 同步侧边栏「订阅订单」待确认徽标数
      useAppStore.setState({
        pendingOrderCount: json.data.filter((o) => o.status === 'claimed').length,
      });
    } catch (e) {
      showToast('❌ 加载订单失败：' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirm(order: SubscriptionOrder) {
    if (!confirm(`确认已收到 ${order.phone} 的 ¥${order.price}（${planLabel(order.plan)}）付款并开通订阅？`)) return;
    setBusyId(order.id);
    try {
      const res = await fetch(`${API_BASE}/subscribe/orders/${order.id}/confirm`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = (await res.json()) as {
        data?: { user_created: boolean; expires_at: number };
        error?: string;
      };
      if (!res.ok || !json.data) throw new Error(json.error ?? '操作失败');
      const { user_created, expires_at } = json.data;
      setResultMsg(
        user_created
          ? `已开通并自动创建账号。\n用户名：${order.phone}\n初始密码：${order.phone.slice(-6)}（手机号后 6 位）\n到期日：${formatExpireDate(expires_at)}\n请将账号信息告知用户。`
          : `已为 ${order.phone} 延期，新到期日：${formatExpireDate(expires_at)}`
      );
      await load();
    } catch (e) {
      showToast('❌ ' + (e as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <div className="section-header">
        <div>
          <PageHeader title="订阅订单" desc="待确认订单置顶，核对收款后一键开通" />
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>刷新</button>
      </div>

      <div className="table-wrap">
        {orders.length === 0 && !loading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🧾</span>
            <p>暂无订单</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th>手机号</th>
                <th style={{ width: 80 }}>套餐</th>
                <th style={{ width: 80 }}>金额</th>
                <th style={{ width: 90 }}>状态</th>
                <th style={{ width: 120 }}>下单时间</th>
                <th style={{ width: 120 }}>处理时间</th>
                <th>备注</th>
                <th style={{ width: 170 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className={order.status === 'claimed' ? styles.pendingRow : ''}>
                  <td style={{ fontWeight: 600 }}>{order.phone}</td>
                  <td>{planLabel(order.plan)}</td>
                  <td>¥{order.price}</td>
                  <td>
                    <span className={`${styles.badge} ${statusClass(order.status)}`}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </td>
                  <td className={styles.timeCell}>{fmtDateTime(order.created_at)}</td>
                  <td className={styles.timeCell}>{fmtDateTime(order.confirmed_at)}</td>
                  <td className={styles.noteCell}>{order.note ?? '—'}</td>
                  <td>
                    {order.status === 'claimed' ? (
                      <div className={styles.actionRow}>
                        <button
                          className="btn-primary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          disabled={busyId === order.id}
                          onClick={() => handleConfirm(order)}
                        >
                          {busyId === order.id ? '处理中…' : '确认开通'}
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          disabled={busyId === order.id}
                          onClick={() => setRejectOrder(order)}
                        >
                          拒绝
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rejectOrder && (
        <RejectModal
          order={rejectOrder}
          onClose={() => setRejectOrder(null)}
          onDone={() => { setRejectOrder(null); load(); }}
        />
      )}

      {resultMsg && (
        <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) setResultMsg(''); }}>
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">开通成功</div>
              <button className="modal-close-btn" onClick={() => setResultMsg('')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className={styles.resultBody}>{resultMsg}</div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setResultMsg('')}>知道了</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RejectModal({ order, onClose, onDone }: {
  order: SubscriptionOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useAppStore((s) => s.showToast);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setError('请填写拒绝原因'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/subscribe/orders/${order.id}/reject`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ note: note.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '操作失败');
      showToast('✅ 已拒绝该订单');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">拒绝订单 · {order.phone}</div>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <div className="form-group">
            <label className="form-label">拒绝原因（将记录在订单备注）</label>
            <textarea
              className="form-input"
              rows={3}
              maxLength={500}
              placeholder="如：未收到款项"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认拒绝'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== member（及 viewer/editor）：自己的订阅信息 + 历史订单 =====

function MemberSubscriptionView() {
  const { currentUser, setCurrentUser, showToast } = useAppStore();
  const [expiresAt, setExpiresAt] = useState<number | null>(currentUser?.subscription_expires_at ?? null);
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPwdModal, setShowPwdModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/subscribe/me`, { headers: authHeaders() });
        const json = (await res.json()) as {
          data?: { subscription_expires_at: number | null; orders: SubscriptionOrder[] };
          error?: string;
        };
        if (!res.ok || !json.data) throw new Error(json.error ?? '加载失败');
        setExpiresAt(json.data.subscription_expires_at);
        setOrders(json.data.orders);
        // 回写最新到期时间，修正登录快照陈旧问题
        const raw = sessionStorage.getItem('session_user');
        if (raw) {
          const user = JSON.parse(raw) as SessionUser;
          const fresh = { ...user, subscription_expires_at: json.data.subscription_expires_at };
          sessionStorage.setItem('session_user', JSON.stringify(fresh));
          setCurrentUser(fresh);
        }
      } catch (e) {
        showToast('❌ 加载订阅信息失败：' + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = remainingDays(expiresAt);
  const isMember = currentUser?.role === 'member';

  return (
    <>
      <PageHeader title="订阅订单" desc="我的订阅信息与历史订单" />

      <div className={styles.subCard}>
        {isMember && expiresAt != null && days != null ? (
          <>
            <div className={styles.subCardMain}>
              <div>
                <div className={styles.subCardLabel}>订阅到期日</div>
                <div className={styles.subCardDate}>{formatExpireDate(expiresAt)}</div>
              </div>
              <div>
                <div className={styles.subCardLabel}>剩余天数</div>
                <div className={`${styles.subCardDays} ${days <= 7 ? styles.daysWarn : ''}`}>
                  {days > 0 ? `${days} 天` : '已到期'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-secondary" onClick={() => setShowPwdModal(true)}>
                修改登录密码
              </button>
              <a className="btn-primary" href="/subscribe">立即续费</a>
            </div>
          </>
        ) : (
          <div className={styles.subCardMain}>
            <div>
              <div className={styles.subCardLabel}>当前账号</div>
              <div className={styles.subCardDate}>{currentUser?.username}（不受订阅限制）</div>
            </div>
          </div>
        )}
      </div>

      <div className="table-wrap">
        {orders.length === 0 && !loading ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🧾</span>
            <p>暂无历史订单</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>套餐</th>
                <th style={{ width: 100 }}>金额</th>
                <th style={{ width: 100 }}>状态</th>
                <th style={{ width: 140 }}>下单时间</th>
                <th style={{ width: 140 }}>处理时间</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{planLabel(order.plan)}</td>
                  <td>¥{order.price}</td>
                  <td>
                    <span className={`${styles.badge} ${statusClass(order.status)}`}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </td>
                  <td className={styles.timeCell}>{fmtDateTime(order.created_at)}</td>
                  <td className={styles.timeCell}>{fmtDateTime(order.confirmed_at)}</td>
                  <td className={styles.noteCell}>{order.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPwdModal && <ChangePasswordModal onClose={() => setShowPwdModal(false)} />}
    </>
  );
}

// ===== 本人修改登录密码弹窗（默认密码为手机号后 6 位，提供自助修改入口） =====

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const logout = useAppStore((s) => s.logout);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPassword) { setError('请输入原密码'); return; }
    if (newPassword.length < 6) { setError('新密码至少 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    if (newPassword === oldPassword) { setError('新密码不能与原密码相同'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '修改失败');
      alert('密码修改成功，请使用新密码重新登录');
      logout();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">修改登录密码</div>
          <button className="modal-close-btn" onClick={onClose} disabled={saving}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <div className="form-group">
            <label className="form-label">原密码</label>
            <input
              type="password"
              className="form-input"
              placeholder="开通时的初始密码为手机号后 6 位"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">新密码</label>
            <input
              type="password"
              className="form-input"
              placeholder="至少 6 位"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label className="form-label">确认新密码</label>
            <input
              type="password"
              className="form-input"
              placeholder="再次输入新密码"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={saving}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '提交中…' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
