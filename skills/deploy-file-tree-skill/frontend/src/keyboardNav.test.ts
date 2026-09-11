import { describe, expect, it } from "vitest";
import { handleTreeKey } from "./keyboardNav";
import { flattenVisibleRows } from "./treeRows";
import type { ChildEntry } from "./types";

function entry(path: string, kind: "dir" | "file"): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind,
    desc: "",
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: kind === "dir" ? 0 : null,
  };
}

/** 夹具行序：apps(目录) / apps/a.ts / apps/sub(目录) / apps/sub/b.ts / README.md */
function rowsFixture() {
  const cache = new Map<string, ChildEntry[]>([
    ["", [entry("apps", "dir"), entry("README.md", "file")]],
    [
      "apps",
      [entry("apps/a.ts", "file"), entry("apps/sub", "dir")],
    ],
    ["apps/sub", [entry("apps/sub/b.ts", "file")]],
  ]);
  return flattenVisibleRows(cache, new Set(["apps", "apps/sub"]));
}

const KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  right: "ArrowRight",
  left: "ArrowLeft",
  home: "Home",
  end: "End",
};

describe("handleTreeKey（键盘选择/展开/折叠状态机）", () => {
  it("↓ 从未选中选中首行；连续 ↓ 逐行下移并在末行停住", () => {
    const rows = rowsFixture();
    expect(handleTreeKey(KEYS.down, rows, new Set(), null)).toEqual({
      type: "move",
      index: 0,
    });
    let a = handleTreeKey(KEYS.down, rows, new Set(), 0);
    expect(a).toEqual({ type: "move", index: 1 });
    a = handleTreeKey(KEYS.down, rows, new Set(), 3);
    expect(a).toEqual({ type: "move", index: 4 });
    a = handleTreeKey(KEYS.down, rows, new Set(), 4);
    expect(a).toEqual({ type: "move", index: 4 });
  });

  it("↑ 逐行上移并在首行停住", () => {
    const rows = rowsFixture();
    expect(handleTreeKey(KEYS.up, rows, new Set(), 3)).toEqual({
      type: "move",
      index: 2,
    });
    expect(handleTreeKey(KEYS.up, rows, new Set(), 0)).toEqual({
      type: "move",
      index: 0,
    });
    expect(handleTreeKey(KEYS.up, rows, new Set(), null)).toEqual({
      type: "move",
      index: 0,
    });
  });

  it("→ 折叠目录=展开请求（toggle open）", () => {
    const rows = rowsFixture();
    const allCollapsed = new Set<string>();
    const action = handleTreeKey(KEYS.right, rows, allCollapsed, 0);
    expect(action).toEqual({ type: "toggle", path: "apps", open: true });
  });

  it("→ 已展开目录=进入第一个子项（move 到下一行）", () => {
    const rows = rowsFixture();
    const expanded = new Set(["apps", "apps/sub"]);
    expect(handleTreeKey(KEYS.right, rows, expanded, 0)).toEqual({
      type: "move",
      index: 1,
    });
  });

  it("→ 文件行无操作", () => {
    const rows = rowsFixture();
    const expanded = new Set(["apps", "apps/sub"]);
    expect(handleTreeKey(KEYS.right, rows, expanded, 4)).toEqual({ type: "none" });
  });

  it("← 已展开目录=折叠请求（toggle close）", () => {
    const rows = rowsFixture();
    const expanded = new Set(["apps", "apps/sub"]);
    expect(handleTreeKey(KEYS.left, rows, expanded, 0)).toEqual({
      type: "toggle",
      path: "apps",
      open: false,
    });
    expect(handleTreeKey(KEYS.left, rows, expanded, 2)).toEqual({
      type: "toggle",
      path: "apps/sub",
      open: false,
    });
  });

  it("← 折叠目录或文件=跳到父目录行", () => {
    const rows = rowsFixture();
    const expanded = new Set(["apps", "apps/sub"]);
    // apps/a.ts（行1）→ 父 apps（行0）
    expect(handleTreeKey(KEYS.left, rows, expanded, 1)).toEqual({
      type: "move",
      index: 0,
    });
    // apps/sub/b.ts（行3）→ 父 apps/sub（行2）
    expect(handleTreeKey(KEYS.left, rows, expanded, 3)).toEqual({
      type: "move",
      index: 2,
    });
  });

  it("← 顶层行无父可跳：无操作", () => {
    const rows = rowsFixture();
    expect(handleTreeKey(KEYS.left, rows, new Set(), 0)).toEqual({ type: "none" });
    expect(handleTreeKey(KEYS.left, rows, new Set(), 4)).toEqual({ type: "none" });
  });

  it("Home/End 直达首末行", () => {
    const rows = rowsFixture();
    expect(handleTreeKey(KEYS.home, rows, new Set(), 3)).toEqual({
      type: "move",
      index: 0,
    });
    expect(handleTreeKey(KEYS.end, rows, new Set(), 1)).toEqual({
      type: "move",
      index: 4,
    });
  });

  it("无关按键与空行集：无操作", () => {
    const rows = rowsFixture();
    for (const key of ["Enter", "a", "Escape", " ", "Tab"]) {
      expect(handleTreeKey(key, rows, new Set(), 0)).toEqual({ type: "none" });
    }
    expect(handleTreeKey(KEYS.down, [], new Set(), null)).toEqual({ type: "none" });
    expect(handleTreeKey(KEYS.end, [], new Set(), 0)).toEqual({ type: "none" });
  });

  it("选中下标越界时按未选中处理（防陈旧索引崩溃）", () => {
    const rows = rowsFixture();
    expect(handleTreeKey(KEYS.down, rows, new Set(), 99)).toEqual({
      type: "move",
      index: 0,
    });
  });

  it("占位行（加载中）不可进入、不响应 →", () => {
    const cache = new Map<string, ChildEntry[]>([
      ["", [entry("apps", "dir"), entry("README.md", "file")]],
    ]);
    const rows = flattenVisibleRows(cache, new Set(["apps"]));
    expect(rows).toHaveLength(3); // apps / 占位 / README.md
    expect(rows[1].entry).toBeNull();
    // → 在占位行上：无展开语义（不可进入未加载内容）
    expect(handleTreeKey(KEYS.right, rows, new Set(["apps"]), 1)).toEqual({
      type: "none",
    });
  });
});
