'use client';

interface DetailNavProps {
  /** 元信息内容（标签、时间、说明文字等） */
  children: React.ReactNode;
}

/**
 * 详情页元信息行（DetailBackBar 下方的说明区域）
 * 内部使用 .detail-nav-tag 和 .detail-nav-text 控制子元素样式
 *
 * 示例：
 * <DetailNav>
 *   <span className="detail-nav-tag">交易日早报</span>
 *   <span className="detail-nav-text">生成于 2026-03-22 08:01</span>
 * </DetailNav>
 */
export default function DetailNav({ children }: DetailNavProps) {
  return (
    <div className="detail-nav">
      {children}
    </div>
  );
}
