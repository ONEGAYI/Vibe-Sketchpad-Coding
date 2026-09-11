/**
 * 树行渲染（G06/G14）：单个可见行（目录可折叠、文件叶节点、加载中占位）。
 * 行本身不递归——树的层级结构由扁平化行序列（treeRows.ts）+ 虚拟列表承载。
 */

import type { ChildEntry } from "../types";
import type { TreeRow as TreeRowModel } from "../treeRows";
import { badgeTitle, entryFlags } from "../format";
import { EntryIcon } from "./EntryIcon";

interface TreeRowViewProps {
  row: TreeRowModel;
  expanded: ReadonlySet<string>;
  selected: string | null;
  onRowClick: (path: string) => void;
  onToggle: (path: string) => void;
}

export function TreeRowView({ row, expanded, selected, onRowClick, onToggle }: TreeRowViewProps) {
  if (row.entry === null) {
    return (
      <div className="tree-row loading-row" style={{ paddingLeft: row.depth * 18 + 6 }}>
        <span className="toggle leaf" aria-hidden="true">
          ·
        </span>
        <span className="desc">加载中…</span>
      </div>
    );
  }
  return (
    <TreeRowEntry
      entry={row.entry}
      depth={row.depth}
      expanded={expanded}
      selected={selected}
      onRowClick={onRowClick}
      onToggle={onToggle}
    />
  );
}

function TreeRowEntry({
  entry,
  depth,
  expanded,
  selected,
  onRowClick,
  onToggle,
}: {
  entry: ChildEntry;
  depth: number;
  expanded: ReadonlySet<string>;
  selected: string | null;
  onRowClick: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isDir = entry.kind === "dir";
  const isOpen = isDir && expanded.has(entry.path);
  const flags = entryFlags(entry);

  return (
    <div
      className={[
        "tree-row",
        selected === entry.path ? "selected" : "",
        entry.hidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ paddingLeft: depth * 18 + 6 }}
      role="treeitem"
      aria-selected={selected === entry.path}
      aria-expanded={isDir ? isOpen : undefined}
      aria-level={depth + 1}
      data-tree-row
      title={`${entry.path}${entry.desc ? ` — ${entry.desc}` : ""}`}
      data-path={entry.path}
      data-selected={selected === entry.path ? "true" : undefined}
      onClick={() => onRowClick(entry.path)}
    >
      {isDir ? (
        <button
          type="button"
          className="toggle"
          aria-label={isOpen ? `折叠 ${entry.name}` : `展开 ${entry.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(entry.path);
          }}
        >
          {isOpen ? "▾" : "▸"}
        </button>
      ) : (
        <span className="toggle leaf" aria-hidden="true">
          ·
        </span>
      )}
      <EntryIcon kind={entry.kind} />
      <span className="name">{entry.name}</span>
      {entry.desc && <span className="desc">{entry.desc}</span>}
      {flags.map((flag) => (
        <span key={flag} className={`badge badge-${flag}`} title={badgeTitle(flag)}>
          {flag}
        </span>
      ))}
      {isDir && entry.child_count === 0 && (
        <span className="badge badge-empty" title="空目录：children 为空对象">
          空
        </span>
      )}
    </div>
  );
}
