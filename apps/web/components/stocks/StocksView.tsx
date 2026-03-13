'use client';

import { useState } from 'react';
import { useAppStore } from '@/store';
import { starStr } from '@/lib/utils';
import StockModal from './StockModal';
import type { Stock } from '@quantstock/types';

export default function StocksView() {
  const { themes, currentThemeId, setCurrentThemeId } = useAppStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<Stock | null>(null);

  const theme = themes.find(t => t.id === currentThemeId);
  const stocks = theme ? [...(theme.stocks || [])] : [];

  function openCreate() {
    setEditingStock(null);
    setModalOpen(true);
  }

  function openEdit(stock: Stock) {
    setEditingStock(stock);
    setModalOpen(true);
  }

  // 排序：按大类 > 子类 > 细分 > 星级降序
  const sorted = stocks.map(s => ({
    ...s,
    _c1: s.cat1 || '',
    _c2: s.cat2 || '',
    _c3: s.cat3 || '',
  })).sort((a, b) => {
    const noA = !a._c1, noB = !b._c1;
    if (noA !== noB) return noA ? 1 : -1;
    const r1 = a._c1.localeCompare(b._c1, 'zh');
    if (r1 !== 0) return r1;
    const r2 = a._c2.localeCompare(b._c2, 'zh');
    if (r2 !== 0) return r2;
    const r3 = a._c3.localeCompare(b._c3, 'zh');
    if (r3 !== 0) return r3;
    return b.stars - a.stars;
  });

  type SortedStock = typeof sorted[number];

  // rowspan 计算
  function spanAt(arr: SortedStock[], idx: number, keys: (keyof SortedStock)[]): number {
    let span = 0;
    const ref = keys.map(k => arr[idx][k]);
    for (let j = idx; j < arr.length; j++) {
      if (keys.every((k, i) => arr[j][k] === ref[i])) span++;
      else break;
    }
    return span;
  }

  function isFirst(arr: SortedStock[], idx: number, keys: (keyof SortedStock)[]): boolean {
    if (idx === 0) return true;
    return keys.some(k => arr[idx][k] !== arr[idx - 1][k]);
  }

  return (
    <>
      {/* 股票池工具栏 */}
      <div className="stocks-toolbar">
        <span className="stocks-back" onClick={() => setCurrentThemeId(null)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          返回主题
        </span>
        <span style={{ color: '#e2e8f0', margin: '0 4px' }}>|</span>
        <span className="stocks-title">{theme?.name} · 股票池</span>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn-primary" onClick={openCreate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            添加股票
          </button>
        </div>
      </div>

      {/* 股票表格 */}
      <div className="table-wrap">
        {sorted.length === 0 ? (
          <div className="empty-state">
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>📈</span>
            <p>暂无股票，点击「添加股票」</p>
          </div>
        ) : (
          <table className="stock-table">
            <thead>
              <tr>
                <th style={{ width: 72 }}>大类</th>
                <th style={{ width: 72 }}>子类</th>
                <th style={{ width: 72 }}>细分</th>
                <th style={{ width: 100 }}>个股</th>
                <th>相关性</th>
                <th style={{ width: 88 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s, i) => {
                const hlClass = s.highlight === 'red' ? ' hl-red' : s.highlight === 'orange' ? ' hl-orange' : '';
                const c1First = isFirst(sorted, i, ['_c1' as keyof SortedStock]);
                const c2First = isFirst(sorted, i, ['_c1' as keyof SortedStock, '_c2' as keyof SortedStock]);
                const c3First = isFirst(sorted, i, ['_c1' as keyof SortedStock, '_c2' as keyof SortedStock, '_c3' as keyof SortedStock]);
                return (
                  <tr key={s.id}>
                    {c1First && (
                      <td className="td-cat" rowSpan={spanAt(sorted, i, ['_c1' as keyof SortedStock])}>
                        {s._c1 || '—'}
                      </td>
                    )}
                    {c2First && (
                      <td className="td-cat" rowSpan={spanAt(sorted, i, ['_c1' as keyof SortedStock, '_c2' as keyof SortedStock])}>
                        {s._c2 || '—'}
                      </td>
                    )}
                    {c3First && (
                      <td className="td-cat" rowSpan={spanAt(sorted, i, ['_c1' as keyof SortedStock, '_c2' as keyof SortedStock, '_c3' as keyof SortedStock])}>
                        {s._c3 || '—'}
                      </td>
                    )}
                    <td>
                      <div className={`stock-name${hlClass}`}>{s.name}</div>
                      <div className="stock-code">{s.code}</div>
                      <div className="stock-stars">{starStr(s.stars)}</div>
                    </td>
                    <td className="td-relation">
                      {s.relation || <span style={{ color: '#94a3b8' }}>—</span>}
                    </td>
                    <td className="td-actions">
                      <button className="btn-icon" onClick={() => openEdit(s)} title="编辑">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <StockDeleteBtn stockId={s.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <StockModal
          stock={editingStock}
          themeId={currentThemeId!}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function StockDeleteBtn({ stockId }: { stockId: string }) {
  const { deleteStock } = useAppStore();

  async function handleDelete() {
    if (!confirm('确认删除该股票？')) return;
    await deleteStock(stockId);
  }

  return (
    <button className="btn-icon danger" onClick={handleDelete} title="删除">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    </button>
  );
}
