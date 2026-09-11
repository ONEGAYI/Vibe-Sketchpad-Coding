// @vitest-environment jsdom
/** 搜索结果列表同样虚拟化（G14）：一页 200 命中只挂视口附近行。 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchResults } from "./SearchResults";
import type { SearchResponse } from "../types";

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
  // TanStack Virtual 初次测量走 offsetWidth/offsetHeight（virtual-core getRect）；
  // getMaxScrollOffset 走 scrollHeight - clientHeight（jsdom 无布局需模拟）
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: function () {
      return this === document.documentElement ? 0 : 640;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: function () {
      return this === document.documentElement ? 0 : 480;
    },
  });
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
    get: function () {
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
  // jsdom 的 scrollTo 不实现：stub 成"落 scrollTop + 派发 scroll 事件"
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

function pageOfHits(n: number): SearchResponse {
  return {
    query: { kw: "f", tag: null, under: null, depth: null },
    total: n,
    total_pages: Math.ceil(n / 200),
    page: 1,
    page_size: 200,
    results: Array.from({ length: n }, (_, i) => ({
      path: `d${String(i).padStart(4, "0")}/file${i}.ts`,
      kind: "file" as const,
      desc: `样本 ${i}`,
      detail: [],
      rel: [],
      tags: [],
      collapsed: false,
      hidden: false,
      git_ignore: null,
    })),
  };
}

describe("SearchResults（虚拟化）", () => {
  it("一页 200 命中：DOM 行数远小于命中数", () => {
    const resp = pageOfHits(200);
    render(
      <SearchResults
        resp={resp}
        onPageChange={() => {}}
        onHitClick={() => {}}
        onBackToTree={() => {}}
        loading={false}
      />,
    );
    expect(document.querySelectorAll("[data-hit-row]").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-hit-row]").length).toBeLessThan(80);
  });

  it("命中信息与点击回调不因虚拟化丢失", () => {
    const resp = pageOfHits(200);
    const clicked: string[] = [];
    render(
      <SearchResults
        resp={resp}
        onPageChange={() => {}}
        onHitClick={(hit) => clicked.push(hit.path)}
        onBackToTree={() => {}}
        loading={false}
      />,
    );
    const first = document.querySelector("[data-hit-row]") as HTMLElement;
    fireEvent.click(first);
    expect(clicked).toEqual(["d0000/file0.ts"]);
    // 汇总信息在场（虚拟化只作用于列表主体）
    expect(document.querySelector(".search-meta")?.textContent).toContain("200");
  });

  it("空结果状态不受虚拟化影响", () => {
    render(
      <SearchResults
        resp={{
          query: { kw: "x", tag: null, under: null, depth: null },
          total: 0,
          total_pages: 0,
          page: 1,
          page_size: 200,
          results: [],
        }}
        onPageChange={() => {}}
        onHitClick={() => {}}
        onBackToTree={() => {}}
        loading={false}
      />,
    );
    expect(document.querySelector(".search-empty")).not.toBeNull();
    expect(document.querySelectorAll("[data-hit-row]").length).toBe(0);
  });
});
