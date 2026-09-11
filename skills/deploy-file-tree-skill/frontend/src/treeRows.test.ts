import { describe, expect, it } from "vitest";
import { flattenVisibleRows, rowIndexByPath } from "./treeRows";
import type { ChildEntry } from "./types";

function dir(path: string, desc = ""): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "dir",
    desc,
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: 0,
  };
}

function file(path: string, desc = ""): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "file",
    desc,
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: null,
  };
}

/** 构造两级夹具：根 3 目录 + 1 文件；apps 下 2 文件 + 1 子目录（孙 1 文件）。 */
function fixture() {
  const cache = new Map<string, ChildEntry[]>([
    [
      "",
      [dir("apps"), dir("中文目录"), dir("empty"), file("README.md")],
    ],
    [
      "apps",
      [file("apps/main.tsx"), file("apps/util.ts"), dir("apps/sub")],
    ],
    ["apps/sub", [file("apps/sub/deep.ts")]],
    ["中文目录", [file("中文目录/说明.md")]],
    ["empty", []],
  ]);
  return cache;
}

describe("flattenVisibleRows（当前展开的可见行扁平化）", () => {
  it("全部折叠：只有根级行，按 cache 顺序", () => {
    const rows = flattenVisibleRows(fixture(), new Set());
    expect(rows.map((r) => r.path)).toEqual([
      "apps",
      "中文目录",
      "empty",
      "README.md",
    ]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows.every((r) => r.entry !== null)).toBe(true);
  });

  it("展开目录追加其子项并递归下探，depth 逐级 +1", () => {
    const rows = flattenVisibleRows(fixture(), new Set(["apps", "apps/sub"]));
    expect(rows.map((r) => r.path)).toEqual([
      "apps",
      "apps/main.tsx",
      "apps/util.ts",
      "apps/sub",
      "apps/sub/deep.ts",
      "中文目录",
      "empty",
      "README.md",
    ]);
    expect(rows.find((r) => r.path === "apps")?.depth).toBe(0);
    expect(rows.find((r) => r.path === "apps/main.tsx")?.depth).toBe(1);
    expect(rows.find((r) => r.path === "apps/sub/deep.ts")?.depth).toBe(2);
  });

  it("展开但子项尚未加载的目录产生一个加载中占位行（entry 为 null）", () => {
    const cache = new Map<string, ChildEntry[]>([["", [dir("lazy")]]]);
    const rows = flattenVisibleRows(cache, new Set(["lazy"]));
    expect(rows).toHaveLength(2);
    expect(rows[0].path).toBe("lazy");
    expect(rows[0].entry).not.toBeNull();
    expect(rows[1].path).toBe("lazy");
    expect(rows[1].entry).toBeNull();
    expect(rows[1].depth).toBe(1);
  });

  it("空目录展开不产生子行（无占位）", () => {
    const rows = flattenVisibleRows(fixture(), new Set(["empty"]));
    expect(rows.map((r) => r.path)).toEqual([
      "apps",
      "中文目录",
      "empty",
      "README.md",
    ]);
  });

  it("根未加载时返回空数组", () => {
    expect(flattenVisibleRows(new Map(), new Set())).toEqual([]);
  });

  it("展开集含未知路径时不影响结果（容错）", () => {
    const rows = flattenVisibleRows(fixture(), new Set(["不存在的目录"]));
    expect(rows).toHaveLength(4);
  });
});

describe("rowIndexByPath（键盘/滚动定位：路径 → 行下标）", () => {
  it("命中返回下标，未命中返回 null", () => {
    const rows = flattenVisibleRows(fixture(), new Set(["apps", "apps/sub"]));
    expect(rowIndexByPath(rows, "apps")).toBe(0);
    expect(rowIndexByPath(rows, "apps/sub/deep.ts")).toBe(4);
    expect(rowIndexByPath(rows, "apps/nope.ts")).toBeNull();
    expect(rowIndexByPath(rows, "")).toBeNull();
  });

  it("占位行不匹配路径（entry 为 null 的行不可选中）", () => {
    const cache = new Map<string, ChildEntry[]>([["", [dir("lazy")]]]);
    const rows = flattenVisibleRows(cache, new Set(["lazy"]));
    expect(rows).toHaveLength(2);
    expect(rowIndexByPath(rows, "lazy")).toBe(0);
  });
});
