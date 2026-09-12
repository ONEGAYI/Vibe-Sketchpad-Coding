import { describe, expect, it } from "vitest";
import { columnPaths } from "./ColumnBrowser";
import type { ChildEntry } from "../types";

describe("从共享选择推导列链", () => {
  const cache = new Map<string, ChildEntry[]>([["a", [{ path: "a/b", kind: "dir" } as ChildEntry]]]);
  it("未选中只有根列，目录追加子项列，文件止于父目录", () => {
    expect(columnPaths(null, cache, null)).toEqual([""]);
    expect(columnPaths("a/b", cache, null)).toEqual(["", "a", "a/b"]);
    expect(columnPaths("a/b/file.ts", cache, null)).toEqual(["", "a", "a/b"]);
  });
  it("切换分支移除旧列", () => {
    expect(columnPaths("other/leaf.ts", cache, null)).toEqual(["", "other"]);
  });
});
