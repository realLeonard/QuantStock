'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { AppUser, PlanType } from '@quantstock/types';

interface Props {
  user: AppUser;
  onClose: () => void;
}

const PLAN_OPTIONS: { value: PlanType; label: string }[] = [
  { value: 'free', label: '免费' },
  { value: 'trial', label: '试用' },
  { value: 'monthly', label: '月付' },
  { value: 'quarterly', label: '季付' },
  { value: 'yearly', label: '年付' },
];

export default function AppUserModal({ user, onClose }: Props) {
  const { updateAppUserPlan } = useAppStore();

  const [planType, setPlanType] = useState<PlanType>(user.plan_type);
  // 将 UTC 毫秒转为 YYYY-MM-DD 字符串（北京时间）供 input[date] 使用
  const initDate = user.plan_expired_at
    ? new Date(user.plan_expired_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
    : '';
  const [expiredAt, setExpiredAt] = useState(initDate);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // 将日期字符串解析为北京时间 UTC 毫秒
    const planExpiredAt = expiredAt
      ? new Date(expiredAt + 'T23:59:59+08:00').getTime()
      : null;
    setSaving(true);
    try {
      await updateAppUserPlan(user.id, planType, planExpiredAt);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <div className="modal-title">编辑套餐 · {user.nickname ?? user.id.slice(0, 8)}</div>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <div className="form-group">
            <label className="form-label">套餐类型</label>
            <select
              className="form-input"
              value={planType}
              onChange={e => setPlanType(e.target.value as PlanType)}
              disabled={saving}
            >
              {PLAN_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">套餐到期日（留空表示永久）</label>
            <input
              className="form-input"
              type="date"
              value={expiredAt}
              onChange={e => setExpiredAt(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
