import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  createEpochGuard,
  currentPath,
  emptyHistory,
  goBack,
  goForward,
  pushSelection,
} from "./navigation";

describe("选择历史（前进/后退与搜索/关联跳转共用一条历史）", () => {
  it("初始历史为空：无当前选择、不可前进后退", () => {
    const h = emptyHistory();
    expect(currentPath(h)).toBeNull();
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("首次选择入历史", () => {
    const h = pushSelection(emptyHistory(), "apps");
    expect(currentPath(h)).toBe("apps");
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("连续选择形成历史链，可逐级后退再前进", () => {
    let h = emptyHistory();
    h = pushSelection(h, "apps");
    h = pushSelection(h, "apps/main.tsx");
    h = pushSelection(h, "docs/README.md");
    expect(currentPath(h)).toBe("docs/README.md");
    expect(canGoBack(h)).toBe(true);

    h = goBack(h);
    expect(currentPath(h)).toBe("apps/main.tsx");
    h = goBack(h);
    expect(currentPath(h)).toBe("apps");
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(true);

    h = goForward(h);
    expect(currentPath(h)).toBe("apps/main.tsx");
    h = goForward(h);
    expect(currentPath(h)).toBe("docs/README.md");
    expect(canGoForward(h)).toBe(false);
  });

  it("后退后选择新路径：截断前进分支（经典浏览器语义）", () => {
    let h = emptyHistory();
    h = pushSelection(h, "a");
    h = pushSelection(h, "b");
    h = pushSelection(h, "c");
    h = goBack(h); // 当前 b
    h = pushSelection(h, "d");
    expect(currentPath(h)).toBe("d");
    expect(canGoForward(h)).toBe(false); // c 被截断
    h = goBack(h);
    expect(currentPath(h)).toBe("b");
  });

  it("重复选择当前路径不改写历史（前进分支与索引不动）", () => {
    let h = emptyHistory();
    h = pushSelection(h, "a");
    h = pushSelection(h, "b");
    const again = pushSelection(h, "b");
    expect(again).toEqual(h);
  });

  it("历史导航（goBack/goForward）不产生新条目", () => {
    let h = emptyHistory();
    h = pushSelection(h, "a");
    h = pushSelection(h, "b");
    const afterBack = goBack(h);
    expect(afterBack.entries).toEqual(["a", "b"]);
    expect(afterBack.index).toBe(0);
    const afterFwd = goForward(afterBack);
    expect(afterFwd.entries).toEqual(["a", "b"]);
    expect(afterFwd.index).toBe(1);
  });

  it("空历史与末端的越界导航保持原状", () => {
    const h = emptyHistory();
    expect(goBack(h)).toEqual(h);
    expect(goForward(h)).toEqual(h);
    let h2 = pushSelection(emptyHistory(), "only");
    h2 = goBack(h2);
    expect(goBack(h2)).toEqual(h2);
    expect(goForward(goForward(h2))).toEqual(h2);
  });
});

describe("世代门闩（epoch guard）：刷新后作废在途旧响应", () => {
  it("bump 之后旧票据失效、新票据有效", () => {
    const guard = createEpochGuard();
    const stale = guard.current();
    expect(guard.isCurrent(stale)).toBe(true);
    guard.bump();
    expect(guard.isCurrent(stale)).toBe(false);
    const fresh = guard.current();
    expect(guard.isCurrent(fresh)).toBe(true);
  });

  it("多次 bump 票据单调失效", () => {
    const guard = createEpochGuard();
    const t1 = guard.current();
    guard.bump();
    const t2 = guard.current();
    guard.bump();
    expect(guard.isCurrent(t1)).toBe(false);
    expect(guard.isCurrent(t2)).toBe(false);
    expect(guard.isCurrent(guard.current())).toBe(true);
  });
});
