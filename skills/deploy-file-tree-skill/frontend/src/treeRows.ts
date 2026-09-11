/**
 * 可见行扁平化（G14）：把"子项缓存 + 展开集"折算成当前应显示的行序列，
 * 供虚拟列表只渲染视口附近行。展开但子项尚未加载的目录产生一个
 * entry 为 null 的加载中占位行（不可选中，仅提示加载状态）。
 */

import type { ChildEntry } from "./types";

export interface TreeRow {
  /** 行路径；占位行为其归属目录的路径 */
  path: string;
  /** 缩进层级（根级 0） */
  depth: number;
  /** null = 子项加载中占位行 */
  entry: ChildEntry | null;
}

/** 当前展开状态下的可见行序列（cache 顺序 = 后端 sort_key 规范序）。 */
export function flattenVisibleRows(
  cache: ReadonlyMap<string, ChildEntry[]>,
  expanded: ReadonlySet<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (entries: ChildEntry[] | undefined, depth: number) => {
    if (!entries) return;
    for (const entry of entries) {
      rows.push({ path: entry.path, depth, entry });
      if (entry.kind === "dir" && expanded.has(entry.path)) {
        const children = cache.get(entry.path);
        if (children === undefined) {
          // 展开请求已发出、响应未到：占位一行
          rows.push({ path: entry.path, depth: depth + 1, entry: null });
        } else {
          walk(children, depth + 1);
        }
      }
    }
  };
  walk(cache.get(""), 0);
  return rows;
}

/** 路径 → 行下标（键盘光标定位/滚动跟随用）；未命中或占位行为 null。 */
export function rowIndexByPath(rows: TreeRow[], path: string): number | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].entry !== null && rows[i].path === path) return i;
  }
  return null;
}
