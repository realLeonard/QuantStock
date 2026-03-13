'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { Theme } from '@quantstock/types';

interface Props {
  theme: Theme | null;  // null = 新增模式
  onClose: () => void;
}

export default function ThemeModal({ theme, onClose }: Props) {
  const [name, setName] = useState(theme?.name ?? '');
  const [overview, setOverview] = useState(theme?.overview ?? '');
  const { createTheme, updateTheme, showToast } = useAppStore();

  async function handleSave() {
    if (!name.trim()) {
      showToast('⚠️ 请输入主题名称');
      return;
    }
    if (theme) {
      await updateTheme(theme.id, name.trim(), overview.trim());
    } else {
      await createTheme(name.trim(), overview.trim());
    }
    onClose();
  }

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <div className="modal-header">
          <span className="modal-title">{theme ? '编辑主题' : '新增主题'}</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">
              主题名称 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              className="form-control"
              placeholder="如：AI算力、光通信/CPO"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">
              概述 <span className="opt">（可选）</span>
            </label>
            <textarea
              className="form-control"
              rows={3}
              placeholder="描述该主题的投资逻辑、行业背景、核心驱动力..."
              value={overview}
              onChange={e => setOverview(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>取消</button>
          <button className="btn-primary" onClick={handleSave}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
