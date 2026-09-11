/**
 * 键盘导航状态机（G10）：↑/↓ 移动选择、→ 展开/进入、← 折叠/跳父、
 * Home/End 直达首末。纯函数——副作用（拉子项、更新状态）由调用方执行。
 *
 * 约定：
 * - 占位行（entry 为 null，子项加载中）不可选中也不响应 →；
 * - → 对已展开目录 = 进入第一个子项（下一行）；
 * - ← 对折叠目录或文件 = 跳到父目录行；顶层行无父则无操作。
 */

import type { TreeRow } from "./treeRows";

export type KeyAction =
  | { type: "move"; index: number }
  | { type: "toggle"; path: string; open: boolean }
  | { type: "none" };

/** 按键 → 动作；selectedIndex 越界按未选中处理（防陈旧索引）。 */
export function handleTreeKey(
  key: string,
  rows: TreeRow[],
  expanded: ReadonlySet<string>,
  selectedIndex: number | null,
): KeyAction {
  if (rows.length === 0) return { type: "none" };
  const current = selectedIndex !== null && rows[selectedIndex] ? selectedIndex : null;
  const entry = current !== null ? rows[current].entry : null;

  switch (key) {
    case "ArrowDown":
      return { type: "move", index: Math.min((current ?? -1) + 1, rows.length - 1) };
    case "ArrowUp":
      return { type: "move", index: Math.max((current ?? 1) - 1, 0) };
    case "Home":
      return { type: "move", index: 0 };
    case "End":
      return { type: "move", index: rows.length - 1 };
    case "ArrowRight": {
      if (current === null || entry === null) return { type: "none" };
      if (entry.kind !== "dir") return { type: "none" };
      if (expanded.has(entry.path)) {
        // 已展开：进入第一个子项（下一行必为其子，占位行除外）
        const next = rows[current + 1];
        if (next && next.entry !== null) return { type: "move", index: current + 1 };
        return { type: "none" };
      }
      return { type: "toggle", path: entry.path, open: true };
    }
    case "ArrowLeft": {
      if (current === null || entry === null) return { type: "none" };
      if (entry.kind === "dir" && expanded.has(entry.path)) {
        return { type: "toggle", path: entry.path, open: false };
      }
      // 跳到父目录行：父路径 = 去掉最后一段
      const parentPath = entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "";
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].entry !== null && rows[i].path === parentPath) {
          return { type: "move", index: i };
        }
      }
      return { type: "none" };
    }
    default:
      return { type: "none" };
  }
}
