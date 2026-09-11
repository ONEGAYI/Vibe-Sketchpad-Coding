// @vitest-environment jsdom
/** 虚拟化树（G14）：DOM 行数远小于总行数；滚动跟随不丢选中。 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualTree } from "./VirtualTree";
import { flattenVisibleRows } from "../treeRows";
import type { ChildEntry } from "../types";

// jsdom 无布局：给滚动容器确定尺寸——TanStack Virtual 的初次测量走
// element.offsetWidth/offsetHeight（见 virtual-core getRect）。scrollTo 为
// noop。ResizeObserver 缺失时 virtual-core 自动降级，仍 stub 防版本差异。
const originalRect = Element.prototype.getBoundingClientRect;
const originalScrollTo = Element.prototype.scrollTo;
let cleanupSize: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const sizeDesc = {
    configurable: true,
    get: function (this: HTMLElement) {
      return this === document.documentElement ? 0 : 640;
    },
  };
  const widthDesc = {
    configurable: true,
    get: function (this: HTMLElement) {
      return this === document.documentElement ? 0 : 480;
    },
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", sizeDesc);
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", widthDesc);
  // getMaxScrollOffset 走 scrollHeight - clientHeight：jsdom 无布局，
  // 用 spacer 的内联总高度充当内容高度、视口高度充当 clientHeight，
  // 否则 scrollToIndex 的目标偏移会被 clamp 到 0
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: function (this: HTMLElement) {
      const child = this.firstElementChild as HTMLElement | null;
      const h = child?.style?.height;
      return typeof h === "string" && h.endsWith("px") ? parseFloat(h) : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: function (this: HTMLElement) {
      return this === document.documentElement ? 0 : 640;
    },
  });
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 480,
      height: 640,
      top: 0,
      left: 0,
      bottom: 640,
      right: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
  // jsdom 的 scrollTo 不实现：stub 成"落 scrollTop + 派发 scroll 事件"，
  // 让 virtualizer 感知 scrollToIndex / 程序滚动产生的偏移变化
  Element.prototype.scrollTo = function (this: HTMLElement, args?: number | { top?: number }) {
    const top = typeof args === "number" ? args : args?.top ?? 0;
    if (this.scrollTop !== top) {
      this.scrollTop = top;
      this.dispatchEvent(new Event("scroll"));
    }
  };
  cleanupSize = () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    delete proto.offsetHeight;
    delete proto.offsetWidth;
    delete proto.scrollHeight;
    delete proto.clientHeight;
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  cleanupSize?.();
  cleanupSize = null;
  Element.prototype.getBoundingClientRect = originalRect;
  Element.prototype.scrollTo = originalScrollTo;
});

function dir(path: string): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "dir",
    desc: "",
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: 20,
  };
}

function file(path: string): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "file",
    desc: "",
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: null,
  };
}

/** 大样本：500 目录 × 20 文件，全展开 = 10500 行。 */
function bigFixture() {
  const root: ChildEntry[] = [];
  const cache = new Map<string, ChildEntry[]>([["", root]]);
  for (let i = 0; i < 500; i++) {
    const name = `d${String(i).padStart(3, "0")}`;
    const dirPath = name;
    root.push(dir(dirPath));
    cache.set(
      dirPath,
      Array.from({ length: 20 }, (_, j) => file(`${dirPath}/f${String(j).padStart(2, "0")}.ts`)),
    );
  }
  const expanded = new Set(cache.keys());
  return { cache, expanded };
}

/** 当前挂载行的下标集合（升序）；data-index 在虚拟化 wrapper 上，行元素向上取。 */
function mountedIndexes(): number[] {
  return Array.from(document.querySelectorAll("[data-tree-row]"))
    .map((el) => Number((el.closest("[data-index]") as HTMLElement | null)?.dataset.index ?? -1))
    .sort((a, b) => a - b);
}

describe("VirtualTree（TanStack Virtual 只渲染视口附近行）", () => {
  it("10500 行的展开树：DOM 行数远小于总行数", () => {
    const { cache, expanded } = bigFixture();
    const rows = flattenVisibleRows(cache, expanded);
    expect(rows).toHaveLength(500 + 500 * 20);

    render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={null}
        selectedIndex={null}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    const mounted = document.querySelectorAll("[data-tree-row]").length;
    expect(mounted).toBeGreaterThan(0);
    // 视口 640px / 行高 28px ≈ 23 行 + overscan，250 是宽裕上界
    expect(mounted).toBeLessThan(250);
    expect(mounted).toBeLessThan(rows.length / 10);
  });

  it("行集只覆盖连续窗口：不存在的大间隔不渲染", () => {
    const { cache, expanded } = bigFixture();
    const rows = flattenVisibleRows(cache, expanded);
    render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={null}
        selectedIndex={null}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    const indexes = mountedIndexes();
    expect(new Set(indexes).size).toBe(indexes.length);
    // 连续窗口：首屏应从 0 开始，相邻挂载下标无空洞
    expect(indexes[0]).toBe(0);
    const maxGap = Math.max(...indexes.slice(1).map((v, i) => v - indexes[i]));
    expect(maxGap).toBeLessThanOrEqual(1);
  });

  it("点击行回调路径；点击目录 toggle", () => {
    const { cache, expanded } = bigFixture();
    const rows = flattenVisibleRows(cache, expanded);
    const clicked: string[] = [];
    const toggled: string[] = [];
    render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected="d000/f00.ts"
        selectedIndex={null}
        onRowClick={(p) => clicked.push(p)}
        onToggle={(p) => toggled.push(p)}
      />,
    );
    const firstRow = document.querySelector('[data-path="d000"]') as HTMLElement;
    fireEvent.click(firstRow);
    expect(clicked).toEqual(["d000"]);
    const toggleBtn = firstRow.querySelector('button[aria-label^="折叠"]') as HTMLElement;
    fireEvent.click(toggleBtn);
    expect(toggled).toEqual(["d000"]);
    // 选中行盖章
    expect(
      (document.querySelector('[data-path="d000/f00.ts"]') as HTMLElement).dataset.selected,
    ).toBe("true");
  });

  it("滚动到深行（selectedIndex 变化跟随）：目标行进入视口且选中不丢", async () => {
    const { cache, expanded } = bigFixture();
    const rows = flattenVisibleRows(cache, expanded);
    const target = "d499/f19.ts";
    const targetIndex = rows.findIndex((r) => r.path === target);
    expect(targetIndex).toBeGreaterThan(9000);

    const { rerender } = render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={null}
        selectedIndex={null}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(document.querySelector(`[data-path="${target}"]`)).toBeNull();

    // 键盘/导航移动到深行：树滚动跟随，选中行在 DOM 中且盖章
    rerender(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={target}
        selectedIndex={targetIndex}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector(`[data-path="${target}"]`)).not.toBeNull();
    });
    const targetRow = document.querySelector(`[data-path="${target}"]`) as HTMLElement;
    expect(targetRow.dataset.selected).toBe("true");
    // 视口移走后总挂载数仍受控
    expect(document.querySelectorAll("[data-tree-row]").length).toBeLessThan(250);
  });

  it("手动滚动：挂载窗口移动、行集仍连续受控", async () => {
    const { cache, expanded } = bigFixture();
    const rows = flattenVisibleRows(cache, expanded);
    render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={null}
        selectedIndex={null}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    const viewport = document.querySelector(".tree-viewport") as HTMLElement;
    expect(viewport).not.toBeNull();
    viewport.scrollTop = 28 * 5000; // 滚到中部
    fireEvent.scroll(viewport);
    await waitFor(
      () => {
        const indexes = mountedIndexes();
        // 窗口已离开顶部（首行不再渲染；overscan 10 → 约 4990 起）
        expect(indexes[0]).toBeGreaterThan(4000);
      },
      { timeout: 2000 },
    );
    const indexes = mountedIndexes();
    expect(indexes.length).toBeGreaterThan(0);
    expect(indexes.length).toBeLessThan(250);
  });

  it("加载中占位行渲染提示且不可点击路径", () => {
    const cache = new Map<string, ChildEntry[]>([
      ["", [dir("lazy"), file("README.md")]],
    ]);
    const expanded = new Set(["lazy"]);
    const rows = flattenVisibleRows(cache, expanded);
    render(
      <VirtualTree
        rows={rows}
        expanded={expanded}
        selected={null}
        selectedIndex={null}
        onRowClick={() => {}}
        onToggle={() => {}}
      />,
    );
    expect(document.querySelector(".loading-row")).not.toBeNull();
  });
});
