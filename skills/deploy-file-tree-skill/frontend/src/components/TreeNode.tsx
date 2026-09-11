import type { ChildEntry } from "../types";
import { badgeTitle, entryFlags } from "../format";

interface TreeNodeProps {
  entry: ChildEntry;
  depth: number;
  expanded: ReadonlySet<string>;
  cache: ReadonlyMap<string, ChildEntry[]>;
  selected: string | null;
  onToggle: (entry: ChildEntry) => void;
  onSelect: (entry: ChildEntry) => void;
}

/** 树行组件：目录可展开（懒加载子项）、条目可选择；hidden 可见、collapsed 可展开。 */
export function TreeNode({
  entry,
  depth,
  expanded,
  cache,
  selected,
  onToggle,
  onSelect,
}: TreeNodeProps) {
  const isDir = entry.kind === "dir";
  const isOpen = isDir && expanded.has(entry.path);
  const flags = entryFlags(entry);
  const loadedChildren = isOpen ? cache.get(entry.path) : undefined;

  return (
    <div className="tree-node">
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
        onClick={() => onSelect(entry)}
      >
        {isDir ? (
          <button
            type="button"
            className="toggle"
            aria-label={isOpen ? `折叠 ${entry.name}` : `展开 ${entry.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(entry);
            }}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="toggle leaf" aria-hidden="true">
            ·
          </span>
        )}
        <span className={`icon ${entry.kind}`} aria-hidden="true">
          {isDir ? (isOpen ? "📂" : "📁") : "📄"}
        </span>
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
      {isOpen && (
        <div className="tree-children" role="group">
          {loadedChildren === undefined ? (
            <div className="tree-row loading-row" style={{ paddingLeft: (depth + 1) * 18 + 6 }}>
              <span className="toggle leaf" aria-hidden="true">
                ·
              </span>
              <span className="desc">加载中…</span>
            </div>
          ) : loadedChildren.length === 0 ? (
            <div className="tree-row empty-dir" style={{ paddingLeft: (depth + 1) * 18 + 6 }}>
              <span className="toggle leaf" aria-hidden="true">
                ·
              </span>
              <span className="desc">（空目录）</span>
            </div>
          ) : (
            loadedChildren.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                cache={cache}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
