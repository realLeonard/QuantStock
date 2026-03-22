'use client';

interface PageHeaderProps {
  title: string;
  desc?: string;
  /** 右侧操作区（按钮、搜索框等），传入时自动启用左右布局 */
  actions?: React.ReactNode;
}

/**
 * 页面标题 + 说明文字（列表页顶部统一规范）
 * 有 actions 时自动切换为左右布局（section-header）
 */
export default function PageHeader({ title, desc, actions }: PageHeaderProps) {
  if (actions) {
    return (
      <div className="section-header">
        <div>
          <div className="page-title">{title}</div>
          {desc && <div className="page-desc" style={{ marginBottom: 0 }}>{desc}</div>}
        </div>
        <div>{actions}</div>
      </div>
    );
  }

  return (
    <>
      <div className="page-title">{title}</div>
      {desc && <div className="page-desc">{desc}</div>}
    </>
  );
}
