'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import type { Stock, StockHighlight } from '@quantstock/types';

interface Props {
  stock: Stock | null;
  themeId: string;
  onClose: () => void;
}

export default function StockModal({ stock, themeId, onClose }: Props) {
  const [code, setCode] = useState(stock?.code ?? '');
  const [name, setName] = useState(stock?.name ?? '');
  const [cat1, setCat1] = useState(stock?.cat1 ?? '');
  const [cat2, setCat2] = useState(stock?.cat2 ?? '');
  const [cat3, setCat3] = useState(stock?.cat3 ?? '');
  const [relation, setRelation] = useState(stock?.relation ?? '');
  const [stars, setStars] = useState(stock?.stars ?? 3);
  const [hoverStars, setHoverStars] = useState(0);
  const [highlight, setHighlight] = useState<StockHighlight>(stock?.highlight ?? '');

  const { createStock, updateStock, showToast } = useAppStore();

  async function handleSave() {
    if (!code.trim() || !name.trim()) {
      showToast('⚠️ 请填写股票代码和名称');
      return;
    }
    const input = {
      code: code.trim(),
      name: name.trim(),
      cat1: cat1.trim(),
      cat2: cat2.trim(),
      cat3: cat3.trim(),
      relation: relation.trim(),
      stars,
      highlight,
      sort_order: null,
    };
    if (stock) {
      await updateStock(stock.id, input);
    } else {
      await createStock(themeId, input);
    }
    onClose();
  }

  const displayStars = hoverStars || stars;

  return (
    <div className="modal-overlay show" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box wide">
        <div className="modal-header">
          <span className="modal-title">{stock ? '编辑股票' : '添加股票'}</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {/* 代码 + 名称 */}
          <div className="form-row cols-2" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">股票代码 <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                className="form-control"
                placeholder="如：600519"
                value={code}
                onChange={e => setCode(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">股票名称 <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                className="form-control"
                placeholder="如：贵州茅台"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
          </div>

          {/* 分类 */}
          <div className="form-row cols-3" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">大类 <span className="opt">（可选）</span></label>
              <input className="form-control" placeholder="如：上游材料" value={cat1} onChange={e => setCat1(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">子类 <span className="opt">（可选）</span></label>
              <input className="form-control" placeholder="如：光芯片" value={cat2} onChange={e => setCat2(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">细分 <span className="opt">（可选）</span></label>
              <input className="form-control" placeholder="如：CPO" value={cat3} onChange={e => setCat3(e.target.value)} />
            </div>
          </div>

          {/* 相关性 */}
          <div className="form-group">
            <label className="form-label">
              相关性说明 <span className="opt">（可选，200字内）</span>
            </label>
            <textarea
              className="form-control"
              rows={3}
              maxLength={200}
              placeholder="说明该股票与本主题的关联逻辑..."
              value={relation}
              onChange={e => setRelation(e.target.value)}
            />
            <div className="char-count">{relation.length}/200</div>
          </div>

          {/* 星级 + 高亮 */}
          <div className="form-row cols-2">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">重要性</label>
              <div className="star-picker">
                {[1, 2, 3, 4, 5].map(v => (
                  <i
                    key={v}
                    className={displayStars >= v ? 'lit' : ''}
                    onClick={() => setStars(v)}
                    onMouseEnter={() => setHoverStars(v)}
                    onMouseLeave={() => setHoverStars(0)}
                    style={{ fontStyle: 'normal' }}
                  >★</i>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">高亮标记</label>
              <div className="hl-group">
                {(['', 'red', 'orange'] as StockHighlight[]).map(hl => (
                  <span
                    key={hl}
                    className={`hl-opt${highlight === hl ? ' active' : ''}`}
                    data-hl={hl}
                    onClick={() => setHighlight(hl)}
                  >
                    {hl === '' ? '无' : hl === 'red' ? '红色' : '橙色'}
                  </span>
                ))}
              </div>
            </div>
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
