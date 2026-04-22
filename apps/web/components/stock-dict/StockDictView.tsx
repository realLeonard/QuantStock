'use client';

import { useMemo, useState } from 'react';
import { useAppStore } from '@/store';
import PageHeader from '@/components/ui/PageHeader';
import styles from './StockDictView.module.css';

export default function StockDictView() {
  const { currentNav } = useAppStore();

  if (currentNav === 'stock-dict-sector') return <SectorMasterPanel />;
  if (currentNav === 'stock-dict-codes') return <StockCodesPanel />;
  return null;
}

// ===== 概念板块面板 =====
function SectorMasterPanel() {
  const { sectorMasters } = useAppStore();
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    if (!keyword.trim()) return sectorMasters;
    const q = keyword.trim().toLowerCase();
    return sectorMasters.filter(
      s => s.name.toLowerCase().includes(q) || s.bk_code.toLowerCase().includes(q)
    );
  }, [sectorMasters, keyword]);

  return (
    <>
      <PageHeader title="概念板块" desc="全量板块字典，数据来源 sector_master 表" />

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="搜索板块名称或 BK 代码..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <span className={styles.countTag}>
          共 {filtered.length} / {sectorMasters.length} 个板块
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>名称</th>
              <th>BK代码</th>
              <th>股票数</th>
              <th>涨跌幅%</th>
              <th>龙头股</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.bk_code}</td>
                <td>{s.stock_count}</td>
                <td className={
                  s.change_pct > 0 ? styles.up
                    : s.change_pct < 0 ? styles.down
                    : styles.flat
                }>
                  {s.change_pct > 0 ? '+' : ''}{s.change_pct.toFixed(2)}%
                </td>
                <td>{s.leading_stock || '-'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
                {sectorMasters.length === 0 ? '加载中...' : '无匹配结果'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ===== 股票代码面板 =====
function StockCodesPanel() {
  const { stockCodes } = useAppStore();
  const [keyword, setKeyword] = useState('');
  const [boardFilter, setBoardFilter] = useState('');
  const [exchangeFilter, setExchangeFilter] = useState('');

  const filtered = useMemo(() => {
    let list = stockCodes;
    if (boardFilter) {
      list = list.filter(s => s.board === boardFilter);
    }
    if (exchangeFilter) {
      list = list.filter(s => s.exchange === exchangeFilter);
    }
    if (keyword.trim()) {
      const q = keyword.trim().toLowerCase();
      list = list.filter(
        s => s.code.includes(q) || s.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [stockCodes, keyword, boardFilter, exchangeFilter]);

  return (
    <>
      <PageHeader title="股票代码" desc="全量 A 股代码字典，数据来源 stockCodes 表" />

      <div className={styles.toolbar}>
        <input
          className={styles.searchInput}
          placeholder="搜索代码或名称..."
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
        />
        <select
          className={styles.filterSelect}
          value={boardFilter}
          onChange={e => setBoardFilter(e.target.value)}
        >
          <option value="">全部板块</option>
          <option value="主板">主板</option>
          <option value="创业板">创业板</option>
          <option value="科创板">科创板</option>
          <option value="北交所">北交所</option>
        </select>
        <select
          className={styles.filterSelect}
          value={exchangeFilter}
          onChange={e => setExchangeFilter(e.target.value)}
        >
          <option value="">全部交易所</option>
          <option value="SH">上交所 (SH)</option>
          <option value="SZ">深交所 (SZ)</option>
          <option value="BJ">北交所 (BJ)</option>
        </select>
        <span className={styles.countTag}>
          共 {filtered.length} / {stockCodes.length} 只
        </span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>交易所</th>
              <th>板块</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.code}>
                <td>{s.code}</td>
                <td>{s.name}</td>
                <td><span className={styles.exchangeTag}>{s.exchange}</span></td>
                <td><span className={styles.boardTag}>{s.board}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
                {stockCodes.length === 0 ? '加载中...' : '无匹配结果'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
