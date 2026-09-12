// @vitest-environment jsdom
/** 世代号混用窗口（PR #23 审查 Spec-2）：客户端 epoch 门闩只认"刷新点击
 * 序"，不认服务端 generation——refresh bump 后、服务端原子替换前发出的
 * 请求携带新 epoch 但内容属旧快照，晚到时照样通过 epoch 检查混入新界面。
 * 以下用例模拟该窗口：按 response.generation 比对已知世代，旧世代响应
 * （children 缓存回写 / search / detail）必须被丢弃，旧子项不得复活。 */
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function jsonErr(status: number, message: string): RespLike {
  return { ok: false, status, json: async () => ({ error: message }) };
}

function searchPayload(
  generation: number,
  kw: string,
  hitDesc: string,
  hitPath = "keep.ts",
): Record<string, unknown> {
  return {
    generation,
    query: { kw, tag: null, under: null, depth: null },
    total: 1,
    total_pages: 1,
    page: 1,
    page_size: 50,
    results: [
      {
        path: hitPath,
        kind: "file",
        desc: hitDesc,
        detail: [],
        rel: [],
        tags: [],
        collapsed: false,
        hidden: false,
        git_ignore: null,
      },
    ],
  };
}

function detailPayload(generation: number, path: string, desc: string): Record<string, unknown> {
  return {
    generation,
    path,
    name: path.split("/").pop() ?? "",
    kind: "file",
    desc,
    detail: [],
    rel: [],
    backrefs: [],
    tags: [],
    collapsed: false,
    hidden: false,
    git_ignore: { explicit: null, effective: false },
    child_count: null,
  };
}

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

describe("浏览布局与控制层页面契约", () => {
  it("刷新期间新搜索先返回旧世代，换代后保留结果并重查最新意图", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refresh = await waitForReq("POST", "/api/refresh");
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "刷新中的查询" } });
    fireEvent.submit(screen.getByRole("search"));
    (await waitForReq("GET", "/api/search")).resolve(jsonOk(searchPayload(1, "刷新中的查询", "旧代用户结果")));
    await screen.findByText("旧代用户结果");
    refresh.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    const renewed = await waitForReq("GET", "/api/search", (q) => q.get("kw") === "刷新中的查询");
    expect(screen.getByText("旧代用户结果")).toBeDefined();
    expect(renewed.query.get("page")).toBe("1");
    renewed.resolve(jsonOk(searchPayload(2, "刷新中的查询", "已换代用户结果")));
    await screen.findByText("已换代用户结果");
    expect(screen.queryByText("旧代用户结果")).toBeNull();
  });

  it("刷新期间新搜索晚回旧世代，重试不会覆盖之后的新世代查询", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refresh = await waitForReq("POST", "/api/refresh");
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "查询A" } });
    fireEvent.submit(screen.getByRole("search"));
    const late = await waitForReq("GET", "/api/search");
    refresh.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    await screen.findByRole("button", { name: "刷新" });
    late.resolve(jsonOk(searchPayload(1, "查询A", "迟到旧结果")));
    const retry = await waitForReq("GET", "/api/search", (q) => q.get("kw") === "查询A");
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "查询B" } });
    fireEvent.submit(screen.getByRole("search"));
    (await waitForReq("GET", "/api/search", (q) => q.get("kw") === "查询B")).resolve(jsonOk(searchPayload(2, "查询B", "最新B结果")));
    await screen.findByText("最新B结果");
    retry.resolve(jsonOk(searchPayload(2, "查询A", "过时A重试")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("最新B结果")).toBeDefined();
    expect(screen.queryByText("过时A重试")).toBeNull();
    expect(screen.queryByText("迟到旧结果")).toBeNull();
    expect(screen.getByRole("button", { name: "搜索" })).toBeDefined();
  });

  it("刷新重建目录遇到旧世代不能提交混合缓存", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/kept.ts", "现有数据")] }));
    await screen.findByText("kept.ts");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    (await waitForReq("POST", "/api/refresh")).resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/mixed.ts", "不可提交的旧代目录")] }));
    await screen.findByText(/刷新失败/);
    expect(screen.queryByText("mixed.ts")).toBeNull();
    expect(screen.getByText("kept.ts")).toBeDefined();
  });
  it("关联导航A等待目录期间改选B，迟到A不能覆盖B", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk({ ...detailPayload(1, "keep.ts", "当前B"), rel: [{ path: "dirX/a.ts", exists: true }] }));
    await screen.findByText("当前B");
    fireEvent.click(screen.getByRole("button", { name: "dirX/a.ts" }));
    const late = await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX");
    fireEvent.click(document.querySelector('[data-path="keep.ts"]')!);
    late.resolve(jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/a.ts", "候选A")] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('[data-path="keep.ts"]')?.getAttribute("aria-selected")).toBe("true");
    expect(pending.some((request) => request.path === "/api/detail" && request.query.get("path") === "dirX/a.ts")).toBe(false);
  });

  it("刷新重建当前目录子列，即使普通树未展开该目录", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "层级浏览" }));
    fireEvent.click(screen.getByRole("option", { name: /dirX/ }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/old.ts", "旧项")] }));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk({ ...detailPayload(1, "dirX", "目录职责"), kind: "dir", child_count: 1 }));
    await screen.findByRole("option", { name: /old.ts/ });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    (await waitForReq("POST", "/api/refresh")).resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({ generation: 2, path: "dirX", children: [fileEntry("dirX/new.ts", "新项")] }));
    await screen.findByRole("option", { name: /new.ts/ });
    expect(screen.queryByRole("option", { name: /old.ts/ })).toBeNull();
    expect(screen.getByRole("button", { name: "收起层级" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("刷新期间原选中被删且用户改选，保留用户的新选中", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "keep.ts", "将删除")));
    await screen.findByText("将删除");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refresh = await waitForReq("POST", "/api/refresh");
    fireEvent.click(screen.getByText("dirX"));
    const current = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX");
    refresh.resolve(jsonOk({ ...rootInfoPayload(2, 0), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX] }));
    await screen.findByRole("button", { name: "刷新" });
    current.resolve(jsonOk(detailPayload(2, "dirX", "当前新选择")));
    await screen.findByText("当前新选择");
    expect(document.querySelector('[data-path="dirX"]')?.getAttribute("aria-selected")).toBe("true");
  });

  it("失效历史项404回到根概览，不停留无限加载", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByText("dirX"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "dirX", "先前目录")));
    await screen.findByText("先前目录");
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "keep.ts", "文件详情")));
    await screen.findByText("文件详情");
    fireEvent.click(screen.getByRole("button", { name: "← 后退" }));
    (await waitForReq("GET", "/api/detail")).resolve(jsonErr(404, "已不存在"));
    await screen.findByText(/已回退到根概览/);
    expect((screen.getByRole("button", { name: "复制路径" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("加载中…")).toBeNull();
  });

  it("切换浏览布局保留搜索结果及输入草稿", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "keep" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    (await waitForReq("GET", "/api/search")).resolve(jsonOk(searchPayload(1, "keep", "搜索命中")));
    await screen.findByText("搜索命中");
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "未提交草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "层级浏览" }));
    expect(screen.getByText("搜索命中")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "收起层级" }));
    expect(screen.getByText("搜索命中")).toBeDefined();
    expect((screen.getByLabelText("关键词") as HTMLInputElement).value).toBe("未提交草稿");
  });
  it("列目录请求失败可重试，空目录区别于加载失败", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "层级浏览" }));
    fireEvent.click(screen.getByRole("option", { name: /dirX/ }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonErr(500, "读取暂时失败"));
    await screen.findByText("加载失败");
    const retry = screen.getByRole("button", { name: "重试" });
    const enter = createEvent.keyDown(retry, { key: "Enter", bubbles: true, cancelable: true });
    fireEvent(retry, enter);
    expect(enter.defaultPrevented).toBe(false);
    fireEvent.click(retry);
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({ generation: 1, path: "dirX", children: [] }));
    await screen.findByText("空目录");
    expect(screen.queryByText("加载失败")).toBeNull();
  });

  it("列键盘进入和返回时转移真实焦点，大目录保持虚拟化", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByRole("button", { name: "层级浏览" }));
    const rootColumn = document.querySelector('[data-column-path=""]') as HTMLElement;
    rootColumn.focus();
    fireEvent.keyDown(rootColumn, { key: "Home" });
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(jsonOk({
      generation: 1, path: "dirX", children: Array.from({ length: 100000 }, (_, i) => fileEntry(`dirX/file-${i}.ts`, "说明")),
    }));
    fireEvent.keyDown(rootColumn, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-column-path")).toBe("dirX"));
    await screen.findByRole("option", { name: /file-0.ts/ });
    expect(document.querySelectorAll("[data-column-entry]").length).toBeLessThan(100);
    const childColumn = document.activeElement as HTMLElement;
    fireEvent.keyDown(childColumn, { key: "End" });
    await waitFor(() => expect(document.querySelector('[data-column-entry="dirX/file-99999.ts"]')?.getAttribute("aria-selected")).toBe("true"));
    fireEvent.keyDown(childColumn, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-column-path")).toBe(""));
  });

  it("层级切换保留选中和历史，晚到子项不能恢复旧分支", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "keep.ts", "原选中")));
    await screen.findByText("原选中");
    fireEvent.click(screen.getByRole("button", { name: "层级浏览" }));
    fireEvent.click(screen.getByRole("option", { name: /dirX/ }));
    const late = await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX");
    const oldDetail = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX");
    fireEvent.click(screen.getByRole("option", { name: /keep.ts/ }));
    oldDetail.resolve(jsonOk(detailPayload(1, "dirX", "迟到详情")));
    late.resolve(jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/late.ts", "旧分支")] }));
    await waitFor(() => expect(document.querySelector('[data-column-path="dirX"]')).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "收起层级" }));
    expect(document.querySelector('[data-tree-row][data-path="keep.ts"]')?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "← 后退" }));
    const restored = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX");
    restored.resolve(jsonOk(detailPayload(1, "dirX", "历史中的目录")));
    await screen.findByText("历史中的目录");
  });
  it("根面包屑进入概览和历史，不请求虚构根详情", async () => {
    render(<App />);
    await loadInitialGen1();
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "keep.ts", "第一个详情")));
    await screen.findByText("第一个详情");
    fireEvent.click(screen.getByText("dirX"));
    (await waitForReq("GET", "/api/detail")).resolve(jsonOk(detailPayload(1, "dirX", "第二个详情")));
    await screen.findByText("第二个详情");
    fireEvent.click(screen.getByRole("button", { name: "← 后退" }));
    const back = await waitForReq("GET", "/api/detail");
    expect(back.query.get("path")).toBe("keep.ts");
    back.resolve(jsonOk(detailPayload(1, "keep.ts", "历史详情")));
    await screen.findByText("历史详情");
    fireEvent.click(screen.getByRole("button", { name: "演示仓库" }));
    expect(screen.queryByText("历史详情")).toBeNull();
    expect((screen.getByRole("button", { name: "复制路径" }) as HTMLButtonElement).disabled).toBe(true);
    expect(pending.some((request) => request.path === "/api/detail" && request.query.get("path") === "")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "← 后退" }));
    const forward = await waitForReq("GET", "/api/detail");
    expect(forward.query.get("path")).toBe("keep.ts");
    forward.resolve(jsonOk(detailPayload(1, "keep.ts", "恢复第二个详情")));
    await screen.findByText("恢复第二个详情");
    fireEvent.click(screen.getByRole("button", { name: "前进 →" }));
    expect(screen.queryByText("恢复第二个详情")).toBeNull();
  });
});

describe("世代号混用窗口：旧世代响应按 generation 丢弃", () => {
  it("刷新期间展开的目录换代后保留展开，晚到旧世代 children 不写回缓存", async () => {
    render(<App />);
    await loadInitialGen1();

    // 刷新在途（POST 挂起）→ 用户展开 dirX：请求发出时服务端仍是旧快照（gen1）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    const staleReq = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );

    // 换代（gen2）：重建循环按实时展开集（expandedRef）纳入 dirX，而非闭包快照；
    // 旧世代响应晚到时 epoch 检查通过（bump 后发起），只有 generation 比对能拦下
    const refreshReq = await waitForReq("POST", "/api/refresh");
    refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    const topReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    topReq.resolve(
      jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
    );
    const rebuildReq = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );
    rebuildReq.resolve(
      jsonOk({
        generation: 2,
        path: "dirX",
        children: [fileEntry("dirX/newchild.ts", "新世代子项")],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "刷新" })).toBeDefined(),
    );

    // 旧世代响应晚到：不得写回缓存污染新世代子项
    staleReq.resolve(
      jsonOk({
        generation: 1,
        path: "dirX",
        children: [fileEntry("dirX/oldchild.ts", "旧世代子项")],
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-path="dirX/newchild.ts"]')).not.toBeNull(),
    );
    // 刷新期间的展开被保留（不回滚为折叠）；旧世代子项不得出现在任何位置
    expect(screen.queryByRole("button", { name: "展开 dirX" })).toBeNull();
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

// PR #23 审查修复：刷新与并发状态机（A1/A2/A3/B1–B5）。
// 各用例模拟审查指出的具体时序：在途请求被刷新作废后必须有复位或重拉路径，
// 世代门必须覆盖初始加载与重建循环，刷新期间的用户新操作不得被静默清除。
describe("刷新与并发状态机修复（A1/A2/A3/B1–B5）", () => {
  it("A1：刷新作废在途详情后，成功且选中保留时重拉新世代详情（loading 不卡死）", async () => {
    render(<App />);
    await loadInitialGen1();

    // 选中 keep.ts：详情请求在途（不 resolve）
    fireEvent.click(screen.getByText("keep.ts"));
    const detailReq1 = await waitForReq("GET", "/api/detail");

    // 手动刷新成功换代（keep.ts 在 gen2 仍存在）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh");
    refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    const topReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    topReq.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    // 选中未变（effect 不重跑）时必须主动重拉详情
    const detailReq2 = await waitForReq("GET", "/api/detail");
    // 被作废的旧请求此刻才晚到：内容必须被丢弃
    detailReq1.resolve(jsonOk(detailPayload(1, "keep.ts", "作废旧详情")));
    detailReq2.resolve(jsonOk(detailPayload(2, "keep.ts", "刷新后新详情")));
    await waitFor(() => expect(screen.getByText("刷新后新详情")).toBeDefined());
    expect(screen.queryByText("作废旧详情")).toBeNull();
  });

  it("A1：刷新失败时被作废的在途详情重拉（右栏不永久占位）", async () => {
    render(<App />);
    await loadInitialGen1();

    fireEvent.click(screen.getByText("keep.ts"));
    const detailReq1 = await waitForReq("GET", "/api/detail");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh");
    refreshReq.resolve(jsonErr(500, "模拟刷新失败"));
    await waitFor(() => expect(screen.getByText(/刷新失败/)).toBeDefined());

    // 失败路径旧数据仍有效：当前选中详情应重拉（服务端未换代，仍 gen1）
    const detailReq2 = await waitForReq("GET", "/api/detail");
    detailReq1.resolve(jsonOk(detailPayload(1, "keep.ts", "作废旧详情")));
    detailReq2.resolve(jsonOk(detailPayload(1, "keep.ts", "失败后重拉详情")));
    await waitFor(() => expect(screen.getByText("失败后重拉详情")).toBeDefined());
    expect(screen.queryByText("作废旧详情")).toBeNull();
  });

  it("A2：首次搜索在途时刷新完成，searchLoading 必须复位", async () => {
    render(<App />);
    await loadInitialGen1();

    // 首次搜索（searchResult 仍 null）在途不 resolve
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "首搜" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await waitForReq("GET", "/api/search");

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await settleRefreshGen2();

    // 搜索按钮回到常态且可点击（loading 复位；卡死时按钮文案是"搜索中…"）
    const searchBtn = screen.getByRole("button", { name: "搜索" }) as HTMLButtonElement;
    expect(searchBtn.disabled).toBe(false);
  });

  it("A3/B1：初始加载 root 与 children 世代不一致时重取到一致", async () => {
    render(<App />);

    // 第一轮：root=gen1（旧）、children=gen2（新）——跨标签页刷新夹在两次读之间
    const rootReq1 = await waitForReq("GET", "/api/root");
    const childrenReq1 = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    rootReq1.resolve(jsonOk(rootInfoPayload(1, 2)));
    childrenReq1.resolve(
      jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
    );

    // 必须发起第二轮重取（不得直接混用两个世代）
    const rootReq2 = await waitForReq("GET", "/api/root");
    const childrenReq2 = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    rootReq2.resolve(jsonOk(rootInfoPayload(2, 2)));
    childrenReq2.resolve(
      jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
    );

    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
  });

  it("B2：重建期间他人并发刷新换代（children 世代更新）→ 世代门随之升级，旧世代详情被拦", async () => {
    render(<App />);
    await loadInitialGen1();

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh");
    refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    const topReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    // 他人并发刷新：refresh 响应 gen2，children 已读到 gen3
    topReq.resolve(jsonOk({ generation: 3, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    // gen3 树中选中 keep.ts；晚到的 gen2 详情属旧世代，不得混入展示
    fireEvent.click(screen.getByText("keep.ts"));
    const detailReq = await waitForReq("GET", "/api/detail");
    detailReq.resolve(jsonOk(detailPayload(2, "keep.ts", "旧世代详情")));

    await new Promise((r) => setTimeout(r, 50)); // 等待晚到响应处理完
    expect(screen.getAllByText("keep.ts").length).toBeGreaterThan(0); // 树仍在
    expect(screen.queryByText("旧世代详情")).toBeNull();
  });

  it("B3：刷新期间用户新搜索已显示，刷新结束不得清除", async () => {
    render(<App />);
    await loadInitialGen1();

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh"); // 刷新在途，稍后 resolve

    // 刷新期间用户搜索（服务端尚未换代，gen1 即当前数据，正常显示）
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "用户词" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchReq = await waitForReq("GET", "/api/search");
    searchReq.resolve(jsonOk(searchPayload(1, "用户词", "用户搜索命中")));
    await waitFor(() => expect(screen.getByText("用户搜索命中")).toBeDefined());

    // 刷新完成（成功换代）：用户搜索结果必须保留
    refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    const topReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    topReq.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    await new Promise((r) => setTimeout(r, 50)); // 等待可能的延迟清除暴露出来
    expect(screen.getByText("用户搜索命中")).toBeDefined();
  });

  it("B4：刷新失败时被作废的展开目录重新拉取（不永久加载）", async () => {
    render(<App />);
    await loadInitialGen1();

    // 展开 dirX：子项请求在途（不 resolve）
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    const childrenReq1 = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );

    // 刷新失败：旧数据保留，但 dirX 的在途请求已被 epoch bump 作废
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh");
    refreshReq.resolve(jsonErr(500, "模拟刷新失败"));
    await waitFor(() => expect(screen.getByText(/刷新失败/)).toBeDefined());

    // 失败路径必须重发 dirX 子项请求
    const childrenReq2 = await waitForReq(
      "GET",
      "/api/children",
      (q) => q.get("path") === "dirX",
    );
    childrenReq1.resolve(
      jsonOk({
        generation: 1,
        path: "dirX",
        children: [fileEntry("dirX/old.ts", "作废子项")],
      }),
    );
    childrenReq2.resolve(
      jsonOk({
        generation: 1,
        path: "dirX",
        children: [fileEntry("dirX/child.ts", "重拉子项")],
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-path="dirX/child.ts"]')).not.toBeNull(),
    );
    // 作废请求的结果不得复活
    expect(document.querySelector('[data-path="dirX/old.ts"]')).toBeNull();
  });

  it("B5：同代并发搜索，旧请求晚到不得覆盖新结果", async () => {
    render(<App />);
    await loadInitialGen1();

    // 首搜在途（按钮禁用），用户改词后回车再搜（form 提交不受按钮禁用影响）
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "第一次" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchReqA = await waitForReq(
      "GET",
      "/api/search",
      (q) => q.get("kw") === "第一次",
    );

    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "第二次" } });
    fireEvent.submit(screen.getByRole("search"));
    const searchReqB = await waitForReq(
      "GET",
      "/api/search",
      (q) => q.get("kw") === "第二次",
    );

    // 新请求先返回并显示
    searchReqB.resolve(jsonOk(searchPayload(1, "第二次", "新搜索命中")));
    await waitFor(() => expect(screen.getByText("新搜索命中")).toBeDefined());

    // 旧请求晚到：不得覆盖新结果
    searchReqA.resolve(jsonOk(searchPayload(1, "第一次", "旧搜索命中")));
    await waitFor(() => expect(screen.getByText("新搜索命中")).toBeDefined());
    expect(screen.queryByText("旧搜索命中")).toBeNull();
  });
});

describe("第 3 轮复核回归（N1/N2）", () => {
  it("N1：刷新在途期间改选，成功后不得为旧选中重拉（右栏不永久占位）", async () => {
    render(<App />);
    await loadInitialGen1();

    // 旧选中 A=keep.ts，详情已显示
    fireEvent.click(screen.getByText("keep.ts"));
    const detailA1 = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "keep.ts");
    detailA1.resolve(jsonOk(detailPayload(1, "keep.ts", "A 的旧详情")));
    await waitFor(() => expect(screen.getByText("A 的旧详情")).toBeDefined());

    // 刷新在途（POST 挂起）→ 用户改选 B=dirX：B 的详情请求在途（epoch 为刷新后）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    const refreshReq = await waitForReq("POST", "/api/refresh");
    fireEvent.click(screen.getByText("dirX"));
    const detailB = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX");

    // 刷新成功换代（A/B 均存在），重建根级缓存
    refreshReq.resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    const topReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    topReq.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    // B 的在途详情到达（新世代）：应显示 B；为旧选中 A 的重拉不得作废它
    detailB.resolve(jsonOk(detailPayload(2, "dirX", "B 的新详情")));
    await waitFor(() => expect(screen.getByText("B 的新详情")).toBeDefined());
    expect(screen.queryByText(/加载中/)).toBeNull();
  });

  it("N2：详情响应被世代门拦下时按当前世代重拉一次（右栏不永久占位）", async () => {
    render(<App />);
    await loadInitialGen1();

    // 先完成一次刷新换代（世代门 known=2，无选中不触发详情重拉）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await settleRefreshGen2();

    // 点击 keep.ts：详情请求在换代的极窄窗口被旧快照应答（晚到的 gen1 响应）
    fireEvent.click(screen.getByText("keep.ts"));
    const staleReq = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "keep.ts");
    staleReq.resolve(jsonOk(detailPayload(1, "keep.ts", "过期内容")));

    // 拦下后必须按当前世代重拉并显示
    const retryReq = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "keep.ts");
    retryReq.resolve(jsonOk(detailPayload(2, "keep.ts", "新世代详情")));
    await waitFor(() => expect(screen.getByText("新世代详情")).toBeDefined());
    expect(screen.queryByText("过期内容")).toBeNull();
  });
});

describe("第二轮审查回归（R1/R4/R7/R10/R11）", () => {
  it("R1：折叠选中项祖先后再触发懒加载完成，折叠不被弹回", async () => {
    render(<App />);
    // 初始：dirX、dirY 两个目录（dirY 用于触发 childrenCache 引用变化）
    const rootReq = await waitForReq("GET", "/api/root");
    const childrenReq = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    rootReq.resolve(jsonOk(rootInfoPayload(1, 2)));
    childrenReq.resolve(
      jsonOk({
        generation: 1,
        path: "",
        children: [ROOT_DIRX, dirEntry("dirY", "另一目录", 1), ROOT_KEEP],
      }),
    );
    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());

    // 选中 dirX/deep.ts：revealSelection 补齐祖先（此时祖先已展开，应为无变化操作）
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(
      jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/deep.ts", "深层文件")] }),
    );
    await waitFor(() => expect(screen.getByText("deep.ts")).toBeDefined());
    fireEvent.click(screen.getByText("deep.ts"));
    (await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX/deep.ts")).resolve(
      jsonOk(detailPayload(1, "dirX/deep.ts", "深层详情")),
    );
    await screen.findByText("深层详情");

    // 用户显式折叠祖先 dirX
    fireEvent.click(screen.getByRole("button", { name: "折叠 dirX" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "展开 dirX" })).toBeDefined());

    // 另一目录懒加载完成（childrenCache 引用变化）
    fireEvent.click(screen.getByRole("button", { name: "展开 dirY" }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirY")).resolve(
      jsonOk({ generation: 1, path: "dirY", children: [fileEntry("dirY/other.ts", "其他文件")] }),
    );
    await waitFor(() => expect(screen.getByText("other.ts")).toBeDefined());

    // dirX 必须保持折叠：revealSelection 只在选中变化时补齐祖先，
    // 不随缓存变化重放并把用户折叠弹回
    expect(screen.getByRole("button", { name: "展开 dirX" })).toBeDefined();
  });

  it("R4：初始加载响应迟到且刷新已换代时，旧世代初始数据不得覆盖界面", async () => {
    render(<App />);
    const initRoot = await waitForReq("GET", "/api/root");
    const initChildren = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");

    // 初始请求在途时用户刷新并完成换代（gen2）
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    (await waitForReq("POST", "/api/refresh")).resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(
      jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    // 初始 gen1 响应迟到：epoch 已被刷新作废，不得覆盖 gen2 的缓存与根信息
    initRoot.resolve(jsonOk(rootInfoPayload(1, 2)));
    initChildren.resolve(jsonOk({ generation: 1, path: "", children: [fileEntry("stale.ts", "旧世代条目")] }));
    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
    expect(screen.queryByText("stale.ts")).toBeNull();
  });

  it("R7：navigateTo 链上子项被世代门拦下时给出提示而非静默", async () => {
    render(<App />);
    await loadInitialGen1();

    // 本页刷新换代：世代门 known=2
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    (await waitForReq("POST", "/api/refresh")).resolve(jsonOk({ ...rootInfoPayload(2, 2), refreshed: true }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "")).resolve(
      jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeDefined());

    // 搜索（gen2 响应）→ 点击命中 → 链上 loadChildren(dirX) 被旧世代（gen1）应答
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "深层" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    (await waitForReq("GET", "/api/search")).resolve(jsonOk(searchPayload(2, "深层", "深层文件", "dirX/deep.ts")));
    await waitFor(() => expect(screen.getByText("dirX/deep.ts")).toBeDefined());
    fireEvent.click(screen.getByText("dirX/deep.ts"));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(
      jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/deep.ts", "深层文件")] }),
    );

    // 不得静默返回：应有"快照已更新"提示引导用户重试
    await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
    expect(screen.getByRole("status").textContent).toContain("快照已更新");
  });

  it("R10：树容器聚焦时 Alt+← 触发历史后退，不被树键盘导航吞掉", async () => {
    render(<App />);
    await loadInitialGen1();

    // 历史：keep.ts → dirX/deep.ts
    fireEvent.click(screen.getByText("keep.ts"));
    (await waitForReq("GET", "/api/detail", (q) => q.get("path") === "keep.ts")).resolve(
      jsonOk(detailPayload(1, "keep.ts", "保留文件")),
    );
    await screen.findByText("保留文件");
    fireEvent.click(screen.getByRole("button", { name: "展开 dirX" }));
    (await waitForReq("GET", "/api/children", (q) => q.get("path") === "dirX")).resolve(
      jsonOk({ generation: 1, path: "dirX", children: [fileEntry("dirX/deep.ts", "深层文件")] }),
    );
    await waitFor(() => expect(screen.getByText("deep.ts")).toBeDefined());
    fireEvent.click(screen.getByText("deep.ts"));
    (await waitForReq("GET", "/api/detail", (q) => q.get("path") === "dirX/deep.ts")).resolve(
      jsonOk(detailPayload(1, "dirX/deep.ts", "深层详情")),
    );
    await screen.findByText("深层详情");

    // Alt+← 在树容器上：冒泡到 window 触发后退 → 选中回到 keep.ts；
    // 若与树键盘导航冲突（← 跳父），选中会变成 dirX 而非 keep.ts
    fireEvent.keyDown(document.querySelector(".tree-viewport")!, { key: "ArrowLeft", altKey: true });
    const backDetail = await waitForReq("GET", "/api/detail", (q) => q.get("path") === "keep.ts");
    backDetail.resolve(jsonOk(detailPayload(1, "keep.ts", "历史详情")));
    await screen.findByText("历史详情");
  });

  it("R11：初始加载连续三轮世代不一致时以 children 世代兜底取 root", async () => {
    render(<App />);
    // 初次 + 两轮重取：root 与 children 世代始终不一致（gen1 vs gen2）
    const root1 = await waitForReq("GET", "/api/root");
    const children1 = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    root1.resolve(jsonOk(rootInfoPayload(1, 2)));
    children1.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    const root2 = await waitForReq("GET", "/api/root");
    const children2 = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    root2.resolve(jsonOk(rootInfoPayload(1, 2)));
    children2.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));
    const root3 = await waitForReq("GET", "/api/root");
    const children3 = await waitForReq("GET", "/api/children", (q) => q.get("path") === "");
    root3.resolve(jsonOk(rootInfoPayload(1, 2)));
    children3.resolve(jsonOk({ generation: 2, path: "", children: [ROOT_DIRX, ROOT_KEEP] }));

    // 重试超限仍不一致 → 兜底：以 children 世代为准单独重取 root
    const root4 = await waitForReq("GET", "/api/root");
    root4.resolve(jsonOk(rootInfoPayload(2, 2)));
    await waitFor(() => expect(screen.getByText("dirX")).toBeDefined());
    // 兜底后收敛，不再无限重取
    expect(pending.filter((r) => r.path === "/api/root")).toHaveLength(0);
  });
});
