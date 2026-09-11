/**
 * 虚拟化目录树（G14）：扁平化可见行只渲染视口附近，
 * 十万条目展开也不会同时挂入 DOM。键盘事件由调用方（App）注入，
 * 本组件只负责行渲染与滚动跟随。
 */

import type { TreeRow as TreeRowModel } from "../treeRows";
import { VirtualList } from "./VirtualList";
import { TreeRowView } from "./TreeRow";

interface VirtualTreeProps {
  rows: TreeRowModel[];
  expanded: ReadonlySet<string>;
  selected: string | null;
  /** 键盘光标所在行（滚动跟随；null 不跟随） */
  selectedIndex: number | null;
  onRowClick: (path: string) => void;
  onToggle: (path: string) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}

export function VirtualTree({
  rows,
  expanded,
  selected,
  selectedIndex,
  onRowClick,
  onToggle,
  onKeyDown,
}: VirtualTreeProps) {
  return (
    <VirtualList
      count={rows.length}
      className="tree-viewport"
      estimateSize={28}
      overscan={10}
      scrollToIndex={selectedIndex}
      viewportProps={{
        role: "tree",
        tabIndex: 0,
        "aria-label": "目录树（↑↓ 选择，→ 展开，← 折叠）",
        onKeyDown,
      }}
      renderItem={(index) => (
        <TreeRowView
          row={rows[index]}
          expanded={expanded}
          selected={selected}
          onRowClick={onRowClick}
          onToggle={onToggle}
        />
      )}
    />
  );
}
