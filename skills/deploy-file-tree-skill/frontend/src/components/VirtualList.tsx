/**
 * 通用虚拟化列表容器（G14，基于 @tanstack/react-virtual）：
 * 只渲染视口附近行（estimateSize + overscan），其余行不进入 DOM。
 * 树视图与搜索结果共用；scrollToIndex 用于键盘移动/选中跟随滚动。
 */

import { type ReactNode, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualListProps {
  count: number;
  renderItem: (index: number) => ReactNode;
  /** 行高估计（px），用于总量与占位 */
  estimateSize?: number;
  /** 视口外预渲染行数（每侧） */
  overscan?: number;
  className?: string;
  /** 滚动容器附加属性（role/aria/tabIndex/onKeyDown 等） */
  viewportProps?: React.HTMLAttributes<HTMLDivElement> & { ref?: never };
  /** 滚动跟随目标（如键盘光标/选中行）；null 不跟随 */
  scrollToIndex?: number | null;
}

export function VirtualList({
  count,
  renderItem,
  estimateSize = 28,
  overscan = 10,
  className = "",
  viewportProps,
  scrollToIndex = null,
}: VirtualListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  useEffect(() => {
    if (scrollToIndex !== null && scrollToIndex >= 0 && scrollToIndex < count) {
      virtualizer.scrollToIndex(scrollToIndex, { align: "auto" });
    }
  }, [scrollToIndex, count, virtualizer]);

  return (
    <div ref={viewportRef} className={`virtual-viewport ${className}`.trim()} {...viewportProps}>
      <div
        className="virtual-spacer"
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            className="virtual-row"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start}px)`,
            }}
          >
            {renderItem(item.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
