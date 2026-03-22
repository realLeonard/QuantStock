'use client';

interface DetailBackBarProps {
  onBack: () => void;
  /** 返回按钮文字，默认"返回列表" */
  backLabel?: string;
  /** 当前详情页标题 */
  title: string;
  /** 右侧操作区（按钮等） */
  actions?: React.ReactNode;
}

/**
 * 详情页顶部返回栏（详情页统一规范）
 * 样式：深色工具栏，左侧「← 返回列表 | 页面标题」，右侧可选操作按钮
 */
export default function DetailBackBar({
  onBack,
  backLabel = '返回列表',
  title,
  actions,
}: DetailBackBarProps) {
  return (
    <div className="detail-back-bar">
      <span className="detail-back-btn" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        {backLabel}
      </span>
      <span className="detail-back-sep">|</span>
      <span className="detail-back-title">{title}</span>
      {actions && <div style={{ marginLeft: 'auto' }}>{actions}</div>}
    </div>
  );
}
