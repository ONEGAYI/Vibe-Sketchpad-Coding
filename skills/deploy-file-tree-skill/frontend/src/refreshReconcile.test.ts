import { describe, expect, it } from "vitest";
import { reconcileAfterRefresh } from "./refreshReconcile";

/** 用存在路径集合构造 exists 回调（模拟刷新后基于重建缓存/404 的判定）。 */
function existsIn(alive: string[]): (p: string) => boolean {
  const set = new Set(alive);
  return (p) => set.has(p);
}

describe("reconcileAfterRefresh（刷新后保留/回退规则）", () => {
  it("全部仍存在：展开目录与选中原样保留、无提示", () => {
    const result = reconcileAfterRefresh({
      expanded: ["apps", "apps/sub"],
      selected: "apps/sub/deep.ts",
      exists: existsIn(["apps", "apps/sub", "apps/sub/deep.ts"]),
    });
    expect(result.keptExpanded).toEqual(["apps", "apps/sub"]);
    expect(result.droppedExpanded).toEqual([]);
    expect(result.selected).toBe("apps/sub/deep.ts");
    expect(result.originalSelectedDeleted).toBe(false);
    expect(result.notice).toBeNull();
  });

  it("部分展开目录被删：保留存在的、丢弃不存在的", () => {
    const result = reconcileAfterRefresh({
      expanded: ["apps", "gone", "apps/sub"],
      selected: "apps",
      exists: existsIn(["apps", "apps/sub"]),
    });
    expect(result.keptExpanded).toEqual(["apps", "apps/sub"]);
    expect(result.droppedExpanded).toEqual(["gone"]);
    expect(result.selected).toBe("apps");
  });

  it("选中路径被删：回退到最近的仍存在祖先目录并提示", () => {
    const result = reconcileAfterRefresh({
      expanded: ["apps", "apps/sub"],
      selected: "apps/sub/deep.ts",
      exists: existsIn(["apps", "apps/sub"]), // deep.ts 已删
    });
    expect(result.selected).toBe("apps/sub");
    expect(result.originalSelectedDeleted).toBe(true);
    expect(result.notice).toContain("apps/sub/deep.ts");
    expect(result.notice).toContain("apps/sub");
  });

  it("祖先链也部分被删：回退到最深仍存在的一级", () => {
    const result = reconcileAfterRefresh({
      expanded: ["apps", "apps/sub"],
      selected: "apps/sub/deep.ts",
      exists: existsIn(["apps"]), // sub 与 deep.ts 都没了
    });
    expect(result.selected).toBe("apps");
    expect(result.originalSelectedDeleted).toBe(true);
    expect(result.notice).toContain("apps");
  });

  it("全链被删：清除选中并提示（不保留失效详情）", () => {
    const result = reconcileAfterRefresh({
      expanded: ["gone"],
      selected: "gone/x.ts",
      exists: existsIn([]),
    });
    expect(result.selected).toBeNull();
    expect(result.originalSelectedDeleted).toBe(true);
    expect(result.notice).toContain("gone/x.ts");
    expect(result.keptExpanded).toEqual([]);
    expect(result.droppedExpanded).toEqual(["gone"]);
  });

  it("无选中时只处理展开目录", () => {
    const result = reconcileAfterRefresh({
      expanded: ["a", "b"],
      selected: null,
      exists: existsIn(["a"]),
    });
    expect(result.selected).toBeNull();
    expect(result.originalSelectedDeleted).toBe(false);
    expect(result.notice).toBeNull();
    expect(result.keptExpanded).toEqual(["a"]);
    expect(result.droppedExpanded).toEqual(["b"]);
  });

  it("顶层选中被删且无祖先：清除选中并提示", () => {
    const result = reconcileAfterRefresh({
      expanded: [],
      selected: "README.md",
      exists: existsIn([]),
    });
    expect(result.selected).toBeNull();
    expect(result.notice).toContain("README.md");
  });

  it("回退目标仍存在的场景不提示（只有真删除才提示）", () => {
    const result = reconcileAfterRefresh({
      expanded: ["apps"],
      selected: "apps/main.tsx",
      exists: existsIn(["apps", "apps/main.tsx"]),
    });
    expect(result.notice).toBeNull();
    expect(result.originalSelectedDeleted).toBe(false);
  });
});
