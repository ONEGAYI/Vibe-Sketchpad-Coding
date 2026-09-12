import { useEffect, useRef, useState } from "react";
import type { ChildEntry, EntryDetail } from "../types";
import type { ChildrenLoadState } from "../useTreeBrowser";
import { EntryIcon } from "./EntryIcon";
import { VirtualList } from "./VirtualList";

export function columnPaths(selected: string | null, cache: ReadonlyMap<string, ChildEntry[]>, detail: EntryDetail | null) {
  const paths = [""];
  if (!selected) return paths;
  const parts = selected.split("/");
  for (let i = 1; i < parts.length; i++) paths.push(parts.slice(0, i).join("/"));
  const parent = parts.slice(0, -1).join("/");
  const entry = cache.get(parent)?.find((item) => item.path === selected);
  if (entry?.kind === "dir" || (detail?.path === selected && detail.kind === "dir")) paths.push(selected);
  return paths;
}

interface ColumnBrowserProps {
  selected: string | null;
  detail: EntryDetail | null;
  cache: ReadonlyMap<string, ChildEntry[]>;
  states: ReadonlyMap<string, ChildrenLoadState>;
  ensureChildren: (path: string) => Promise<boolean>;
  onSelect: (path: string) => void;
}

/** 多列只投影共享缓存与选中路径；列内焦点属于瞬时交互状态。 */
export function ColumnBrowser({ selected, detail, cache, states, ensureChildren, onSelect }: ColumnBrowserProps) {
  const paths = columnPaths(selected, cache, detail);
  const pathKey = JSON.stringify(paths);
  const viewport = useRef<HTMLDivElement>(null);
  const columns = useRef(new Map<string, HTMLElement>());
  const [focusPath, setFocusPath] = useState<string | null>(null);

  useEffect(() => {
    for (const path of paths) {
      if (!cache.has(path) && !states.has(path)) void ensureChildren(path).catch(() => {});
    }
  }, [pathKey, cache, states, ensureChildren]);

  useEffect(() => {
    const container = viewport.current;
    const last = columns.current.get(paths[paths.length - 1]);
    if (!container || !last) return;
    const left = last.offsetLeft - container.offsetLeft;
    const right = left + last.offsetWidth;
    if (right > container.scrollLeft + container.clientWidth) container.scrollTo({ left: right - container.clientWidth });
    else if (left < container.scrollLeft) container.scrollTo({ left });
    // 只有列链变化时跟随；请求完成、详情更新不抢用户手动横滚。
  }, [pathKey]);

  useEffect(() => {
    if (focusPath === null) return;
    const element = columns.current.get(focusPath);
    if (element) { element.focus({ preventScroll: true }); setFocusPath(null); }
  }, [focusPath, pathKey]);

  return (
    <div className="column-browser" ref={viewport} aria-label="层级文件选择器">
      {paths.map((path, columnIndex) => {
        const entries = cache.get(path);
        const state = states.get(path);
        const selectedIndex = entries?.findIndex((entry) => selected === entry.path || selected?.startsWith(`${entry.path}/`)) ?? -1;
        return (
          <section className="browser-column" key={path} data-column-path={path} tabIndex={0}
            aria-label={path || "根目录"} ref={(element) => { if (element) columns.current.set(path, element); else columns.current.delete(path); }}
            onKeyDown={(event) => {
              // 重试等内部按钮保留自身 Enter/Space 行为，不让列导航吞键。
              if (event.target !== event.currentTarget) return;
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
              event.preventDefault();
              if (event.key === "ArrowLeft") {
                if (columnIndex > 0) { onSelect(path); setFocusPath(paths[columnIndex - 1]); }
                return;
              }
              if (!entries?.length) return;
              if (event.key === "ArrowRight" || event.key === "Enter") {
                const entry = entries[selectedIndex < 0 ? 0 : selectedIndex];
                onSelect(entry.path);
                if (entry.kind === "dir") setFocusPath(entry.path);
                return;
              }
              const index = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
                : Math.max(0, Math.min(entries.length - 1, selectedIndex + (event.key === "ArrowDown" ? 1 : -1)));
              onSelect(entries[index].path);
            }}>
            <header className="column-heading" title={path || "根目录"}>{path.split("/").pop() || "根目录"}</header>
            {entries === undefined ? (
              state?.status === "error" || state?.status === "missing" ?
                <div className="column-message" role="status">
                  <p>{state.status === "missing" ? "目录不在当前快照中" : "加载失败"}</p>
                  <p className="muted">{state.message}</p>
                  <button type="button" className="link-button" onClick={() => void ensureChildren(path).catch(() => {})}>重试</button>
                </div> : <p className="column-message muted" role="status">加载中…</p>
            ) : entries.length === 0 ? <p className="column-message muted">空目录</p> : (
              <VirtualList count={entries.length} estimateSize={34} overscan={8} className="column-viewport"
                scrollToIndex={selectedIndex < 0 ? null : selectedIndex}
                viewportProps={{ role: "listbox", "aria-label": `${path || "根目录"}的子项` }}
                renderItem={(index) => {
                  const entry = entries[index];
                  return <button type="button" tabIndex={-1} role="option" aria-selected={index === selectedIndex}
                    className={`column-entry${index === selectedIndex ? " selected" : ""}${entry.hidden ? " is-hidden" : ""}`}
                    title={`${entry.path}${entry.desc ? ` — ${entry.desc}` : ""}`} data-column-entry={entry.path}
                    onClick={() => { columns.current.get(path)?.focus({ preventScroll: true }); onSelect(entry.path); }}>
                    <EntryIcon kind={entry.kind} /><span className="name">{entry.name}</span>
                    {entry.kind === "dir" && <span className="column-chevron" aria-hidden="true">›</span>}
                  </button>;
                }} />
            )}
          </section>
        );
      })}
    </div>
  );
}
