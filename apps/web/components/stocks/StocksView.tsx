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

  // 排序：若所有股票都有 sort_order（爬虫导入），按图片顺序显示；否则按 cat1→cat2→cat3→stars
  const hasSortOrder = stocks.length > 0 && stocks.every(s => s.sort_order != null);

  const sorted = stocks.map(s => ({
    ...s,
    _c1: s.cat1 || '',
    _c2: s.cat2 || '',
    _c3: s.cat3 || '',
  })).sort((a, b) => {
    if (hasSortOrder) {
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    }
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
  type RowCat = { c1: string; c2: string; c3: string };
  type SingleRow = { type: 'single'; stock: SortedStock };
  type MergedRow = { type: 'merged'; cat1: string; cat2: string; cat3: string; stocks: SortedStock[] };
  type DisplayRow = SingleRow | MergedRow;

  // 构建展示行：relation 为空且同 cat1+cat2+cat3 的多支股票合并为一行
  function buildDisplayRows(arr: SortedStock[]): DisplayRow[] {
    const rows: DisplayRow[] = [];
    let i = 0;
    while (i < arr.length) {
      const s = arr[i];
      if (s.relation) {
        rows.push({ type: 'single', stock: s });
        i++;
      } else {
        const { _c1, _c2, _c3 } = s;
        const group: SortedStock[] = [s];
        i++;
        while (i < arr.length) {
          const nx = arr[i];
          if (!nx.relation && nx._c1 === _c1 && nx._c2 === _c2 && nx._c3 === _c3) {
            group.push(nx); i++;
          } else break;
        }
        if (group.length === 1) {
          rows.push({ type: 'single', stock: group[0] });
        } else {
          rows.push({ type: 'merged', cat1: _c1, cat2: _c2, cat3: _c3, stocks: group });
        }
      }
    }
    return rows;
  }

  // rowspan 计算（基于展示行）
  function spanRows(cats: RowCat[], idx: number, keys: (keyof RowCat)[]): number {
    let span = 0;
    const ref = keys.map(k => cats[idx][k]);
    for (let j = idx; j < cats.length; j++) {
      if (keys.every((k, ki) => cats[j][k] === ref[ki])) span++;
      else break;
    }
    return span;
  }

  function isFirstRow(cats: RowCat[], idx: number, keys: (keyof RowCat)[]): boolean {
    if (idx === 0) return true;
    return keys.some(k => cats[idx][k] !== cats[idx - 1][k]);
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
                <th style={{ width: 100 }}>大类</th>
                <th style={{ width: 100 }}>子类</th>
                <th style={{ width: 72 }}>细分</th>
                <th style={{ width: 100 }}>个股</th>
                <th>相关性</th>
                <th style={{ width: 88 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const displayRows = buildDisplayRows(sorted);
                const rowCats: RowCat[] = displayRows.map(r =>
                  r.type === 'single'
                    ? { c1: r.stock._c1, c2: r.stock._c2, c3: r.stock._c3 }
                    : { c1: r.cat1, c2: r.cat2, c3: r.cat3 }
                );
                return displayRows.map((row, i) => {
                  const cats = rowCats[i];
                  const c1First = isFirstRow(rowCats, i, ['c1']);
                  const c2First = isFirstRow(rowCats, i, ['c1', 'c2']);
                  const c3First = isFirstRow(rowCats, i, ['c1', 'c2', 'c3']);
                  const catCells = (
                    <>
                      {c1First && <td className="td-cat" rowSpan={spanRows(rowCats, i, ['c1'])}>{cats.c1 || '—'}</td>}
                      {c2First && <td className="td-cat" rowSpan={spanRows(rowCats, i, ['c1', 'c2'])}>{cats.c2 || '—'}</td>}
                      {c3First && <td className="td-cat" rowSpan={spanRows(rowCats, i, ['c1', 'c2', 'c3'])}>{cats.c3 || '—'}</td>}
                    </>
                  );

                  if (row.type === 'merged') {
                    return (
                      <tr key={row.stocks.map(s => s.id).join('-')} className="tr-merged">
                        {catCells}
                        <td className="td-merged-stocks" colSpan={3}>
                          {row.stocks.map((s, si) => {
                            const hlClass = s.highlight === 'red' ? ' hl-red' : s.highlight === 'orange' ? ' hl-orange' : '';
                            return (
                              <span key={s.id} className="merged-stock-item">
                                <span className={`stock-name${hlClass}`}>{s.name}</span>
                                {si < row.stocks.length - 1 && <span className="merged-sep">、</span>}
                              </span>
                            );
                          })}
                        </td>
                      </tr>
                    );
                  }

                  const s = row.stock;
                  const hlClass = s.highlight === 'red' ? ' hl-red' : s.highlight === 'orange' ? ' hl-orange' : '';
                  return (
                    <tr key={s.id}>
                      {catCells}
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
                });
              })()}
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
