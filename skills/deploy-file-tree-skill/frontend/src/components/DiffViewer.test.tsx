// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { DiffViewer } from "./DiffViewer";

vi.mock("../api", () => ({ api: { diff: vi.fn() } }));

const first = {
  generation: 1,
  schema_version: 1,
  status: "ok" as const,
  comparison_id: "pair-id",
  summary: { by_status: { added: 0, removed: 0, modified: 2 }, by_scope: { root: 0, tag: 0, view: 0, entry: 2 } },
  filters: { status: [], scope: [], under: null },
  total: 2,
  total_pages: 2,
  page: 1,
  page_size: 50,
  results: [{ scope: "entry" as const, path: "a.md", status: "modified" as const,
              before: { kind: "file", desc: "旧简介" }, after: { kind: "file", desc: "新简介" } }],
};
const second = { ...first, page: 2, results: [{ scope: "entry" as const, path: "b.md",
  status: "modified" as const, before: { kind: "file", desc: "旧 B" }, after: { kind: "file", desc: "新 B" } }] };

describe("DiffViewer", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(api.diff).mockImplementation(async (_filters, page) => page === 2 ? second : first);
  });

  it("shows paged changes and before/after details", async () => {
    render(<DiffViewer oldSource="old.json" newSource="new.json" generation={1}
      refreshing={false} onRefresh={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /a\.md/ }));
    expect(screen.getByText(/旧简介/)).toBeTruthy();
    expect(screen.getByText(/新简介/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(api.diff).toHaveBeenCalledWith(expect.anything(), 2));
    expect(await screen.findByRole("button", { name: /b\.md/ })).toBeTruthy();
  });

  it("shows an empty result without a zero-page label after filtering", async () => {
    vi.mocked(api.diff).mockImplementation(async (filters) => filters.status === "added"
      ? { ...first, filters: { status: ["added"], scope: [], under: null },
          total: 0, total_pages: 0, results: [] }
      : first);
    render(<DiffViewer oldSource="old.json" newSource="new.json" generation={1}
      refreshing={false} onRefresh={vi.fn()} />);
    await screen.findByRole("button", { name: /a\.md/ });
    fireEvent.change(screen.getByRole("combobox", { name: "变化类型" }),
      { target: { value: "added" } });
    expect(await screen.findByText("共 0 条变化")).toBeTruthy();
    expect(screen.getByText("没有匹配的变化。")).toBeTruthy();
  });

  it("reveals details after selecting a change in stacked layout", async () => {
    const reveal = vi.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = reveal;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      render(<DiffViewer oldSource="old.json" newSource="new.json" generation={1}
        refreshing={false} onRefresh={vi.fn()} />);
      fireEvent.click(await screen.findByRole("button", { name: /a\.md/ }));
      expect(reveal).toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
      vi.unstubAllGlobals();
    }
  });

  it("does not leave stale rows visible when a filtered request fails", async () => {
    vi.mocked(api.diff).mockImplementation(async (filters) => {
      if (filters.status === "added") throw new Error("筛选请求失败");
      return first;
    });
    render(<DiffViewer oldSource="old.json" newSource="new.json" generation={1}
      refreshing={false} onRefresh={vi.fn()} />);
    await screen.findByRole("button", { name: /a\.md/ });
    fireEvent.change(screen.getByRole("combobox", { name: "变化类型" }),
      { target: { value: "added" } });
    expect((await screen.findByRole("alert")).textContent).toContain("筛选请求失败");
    expect(screen.queryByRole("button", { name: /a\.md/ })).toBeNull();
  });
});
