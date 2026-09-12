// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";
import type { EntryDetail } from "../types";
afterEach(cleanup);

it("阅读布局保留正反关联及默认折叠的三态标志", () => {
  const navigate = vi.fn();
  const detail: EntryDetail = {
    path: "a.ts", name: "a.ts", kind: "file", desc: "文件职责", detail: ["完整说明"],
    rel: [{ path: "b.ts", exists: true }], backrefs: [{ path: "c.ts", exists: true }],
    tags: ["doc"], hidden: false, collapsed: false, child_count: null,
    git_ignore: { explicit: null, effective: true },
  };
  const { container } = render(<DetailPanel rootInfo={null} detail={detail} selected="a.ts" loading={false} onNavigate={navigate} />);
  expect(screen.getByText("文件职责").className).toBe("detail-lead");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector(".flags")?.textContent).toContain("继承");
  fireEvent.click(screen.getByRole("button", { name: "b.ts" }));
  fireEvent.click(screen.getByRole("button", { name: "c.ts" }));
  expect(navigate.mock.calls).toEqual([["b.ts"], ["c.ts"]]);
});
