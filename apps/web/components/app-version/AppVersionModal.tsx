'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { AppVersionControl } from '@quantstock/types';

interface Props {
  mode: 'create' | 'edit';
  version: AppVersionControl | null;
  onClose: () => void;
}

export default function AppVersionModal({ mode, version, onClose }: Props) {
  const { createAppVersion, updateAppVersion } = useAppStore();

  const [versionStr, setVersionStr] = useState(version?.version ?? '');
  const [isForceUpdate, setIsForceUpdate] = useState(version?.is_force_update ?? false);
  const [valueDesc, setValueDesc] = useState(version?.value_desc ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!versionStr.trim()) {
      setError('版本号不能为空');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await createAppVersion(versionStr.trim(), isForceUpdate, valueDesc.trim());
      } else if (version) {
        await updateAppVersion(version.id, {
          version: versionStr.trim(),
          is_force_update: isForceUpdate,
          value_desc: valueDesc.trim(),
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'create' ? '发布新版本' : `编辑版本 · ${version?.version}`;

  return (
    <div className="modal-mask" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close-btn" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <div className="form-group">
            <label className="form-label">版本号</label>
            <input
              className="form-input"
              type="text"
              placeholder="如 1.0.0"
              value={versionStr}
              onChange={e => setVersionStr(e.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isForceUpdate}
                onChange={e => setIsForceUpdate(e.target.checked)}
                disabled={saving}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />
              强制升级（用户必须更新才能使用）
            </label>
          </div>

          <div className="form-group">
            <label className="form-label">版本说明</label>
            <textarea
              className="form-input"
              placeholder="描述本次版本更新内容…"
              rows={4}
              value={valueDesc}
              onChange={e => setValueDesc(e.target.value)}
              disabled={saving}
              style={{ resize: 'vertical' }}
            />
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer" style={{ paddingInline: 0 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>取消</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : mode === 'create' ? '发布' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
