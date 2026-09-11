// @vitest-environment jsdom
/** 世代号混用窗口（PR #23 审查 Spec-2）：客户端 epoch 门闩只认"刷新点击
 * 序"，不认服务端 generation——refresh bump 后、服务端原子替换前发出的
 * 请求携带新 epoch 但内容属旧快照，晚到时照样通过 epoch 检查混入新界面。
 * 以下用例模拟该窗口：按 response.generation 比对已知世代，旧世代响应
 * （children 缓存回写 / search / detail）必须被丢弃，旧子项不得复活。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { ChildEntry } from "./types";

// ---- jsdom 无布局：TanStack Virtual 测量所需 stub（同 VirtualTree.test.tsx）----
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

// ---- fetch 编排：请求入队手动 resolve，测试精确控制响应到达顺序 ----

interface RespLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface PendingReq {
  method: string;
  path: string;
  query: URLSearchParams;
  resolve: (r: RespLike) => void;
}

let pending: PendingReq[] = [];

function jsonOk(payload: Record<string, unknown>): RespLike {
  return { ok: true, status: 200, json: async () => payload };
}

/** 等待匹配请求入队并取出（fetch 已发出）。 */
async function waitForReq(
  method: string,
  path: string,
  pred: (q: URLSearchParams) => boolean = () => true,
): Promise<PendingReq> {
  await waitFor(() => {
    expect(
      pending.find(
        (r) => r.method === method && r.path === path && pred(r.query),
      ),
    ).toBeDefined();
  });
  const index = pending.findIndex(
    (r) => r.method === method && r.path === path && pred(r.query),
  );
  const [req] = pending.splice(index, 1);
  return req;
}

beforeEach(() => {
  pending = [];
  vi.stubGlobal("fetch", (url: unknown, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(String(url), "http://viewer.test");
    const req: PendingReq = {
      method,
      path: parsed.pathname,
      query: new URLSearchParams(parsed.search),
      resolve: () => {},
    };
    pending.push(req);
    return new Promise<RespLike>((resolve) => {
      req.resolve = resolve;
    });
  });
});

// ---- fixture：gen1 旧快照与 gen2 新快照 ----

function dirEntry(path: string, desc: string, childCount: number): ChildEntry {
  return {
    name: path.split("/").pop() ?? "",
    path,
    kind: "dir",
    desc,
    hidden: false,
    collapsed: false,
    git_ignore: null,
    child_count: childCount,
  };
}

function fileEntry(path: string, desc: string): ChildEntry {
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

const ROOT_DIRX = dirEntry("dirX", "子目录", 1);
const ROOT_KEEP = fileEntry("keep.ts", "保留文件");

function rootInfoPayload(generation: number, files: number): Record<string, unknown> {
  return {
    generation,
    root: "演示仓库",
    tags: {},
    counts: { dirs: 1, files, total: 1 + files },
    source: "test-tree.json",
  };
}

/** 初始加载（gen1）：root + 根级子项。 */
async function loadInitialGen1() {
  const rootReq = await waitForReq("GET", "/api/root");
  const childrenReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
  rootReq.resolve(jsonOk(rootInfoPayload(1, 2)));
  childrenReq.resolve(
    jsonOk({ generation: 1, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
  );
  await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
}

/** resolve 刷新链路（gen2）：POST refresh + 重建根级缓存；返回刷新完成的 await。 */
async function settleRefreshGen2() {
  const refreshReq = await waitForReq("POST", "/api/refresh");
  refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
  const childrenReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
  childrenReq.resolve(
    jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
  );
  // 刷新按钮回到常态 = doRefresh 完成（setChildrenCache 已生效）
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());
}

describe("世代号混用窗口：旧世代响应按 generation 丢弃", () => {
  it("晚到的旧世代 children 响应不得写回缓存：重新展开重新拉取新世代子项", async () => {
    render(<App />);
    await loadInitialGen1();

    // 刷新在途（POST 挂起）→ 用户展开 dirX：请求发出时服务端仍是旧快照（gen1）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    const oldChildrenReq = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );

    // 服务端换代（gen2）：doRefresh 以点击刷新那一刻的展开集重建缓存（不含
    // dirX——闭包快照），随后旧世代响应才晚到：epoch 检查通过（bump 后发起），
    // 只有 generation 比对能拦下
    await settleRefreshGen2();
    oldChildrenReq.resolve(
      jsonOk({
        generation: 1,
        path: "dirX",
        children: [fileEntry("dirX/oldchild.ts", "旧世代子项")],
      }),
    );
    // 晚到响应处理完（若被错误写回，缓存即污染）
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "展开 dirX" })).toBeDefined(),
    );

    // 重新展开 dirX：缓存未污染时应重新发起请求并拿到 gen2 新子项
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    const newChildrenReq = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );
    newChildrenReq.resolve(
      jsonOk({
        generation: 2,
        path: "dirX",
        children: [fileEntry("dirX/newchild.ts", "新世代子项")],
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-path="dirX/newchild.ts"]')).not.toBeNull(),
    );
    // 旧世代子项不得出现在任何位置（复活即失败）
    expect(document.querySelector('[data-path="dirX/oldchild.ts"]')).toBeNull();
  });

  it("晚到的旧世代 search 响应被丢弃：左栏不切搜索视图", async () => {
    render(<App />);
    await loadInitialGen1();

    // 刷新在途时发起搜索：请求发出时服务端仍是旧快照（gen1）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "旧世代" },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchReq = await waitForReq("GET", "/api/search");

    await settleRefreshGen2();
    searchReq.resolve(
      jsonOk({
        generation: 1,
        query: { kw: "旧世代", tag: null, under: null, depth: null },
        total: 1,
        total_pages: 1,
        page: 1,
        page_size: 50,
        results: [
          {
            path: "keep.ts",
            kind: "file",
            desc: "旧世代命中",
            detail: [],
            rel: [],
            tags: [],
            collapsed: false,
            hidden: false,
            git_ignore: null,
          },
        ],
      }),
    );

    // 旧世代结果不得渲染：左栏仍是目录树（keep.ts 树行在），无"命中"字样
    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
    expect(screen.queryByText("旧世代命中")).toBeNull();
    expect(screen.queryByText(/条命中/)).toBeNull();
  });

  it("晚到的旧世代 detail 响应被丢弃：右栏不显示旧详情", async () => {
    render(<App />);
    await loadInitialGen1();

    // 刷新在途时点击文件条目：detail 请求发出时服务端仍是旧快照（gen1）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(screen.getByText("keep.ts"));
    const detailReq = await waitForReq("GET", "/api/detail");

    await settleRefreshGen2();
    detailReq.resolve(
      jsonOk({
        generation: 1,
        path: "keep.ts",
        name: "keep.ts",
        kind: "file",
        desc: "旧世代详情",
        detail: [],
        rel: [],
        backrefs: [],
        tags: [],
        collapsed: false,
        hidden: false,
        git_ignore: { explicit: null, effective: false },
        child_count: null,
      }),
    );

    // 右栏不得出现旧世代详情内容
    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
    expect(screen.queryByText("旧世代详情")).toBeNull();
  });
});
