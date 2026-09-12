// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SearchBar } from "./SearchBar";
afterEach(cleanup);

it("筛选折叠保留草稿，只有提交才查询", () => {
  const search = vi.fn();
  render(<SearchBar tagVocab={{ doc: "文档" }} onSearch={search} loading={false} />);
  fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "tree" } });
  fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
  fireEvent.change(screen.getByLabelText("标签筛选"), { target: { value: "doc" } });
  fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
  expect(search).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "搜索" }));
  expect(search).toHaveBeenCalledWith({ kw: "tree", tag: "doc", under: "" });
  fireEvent.click(screen.getByRole("button", { name: /筛选/ }));
  expect((screen.getByLabelText("标签筛选") as HTMLSelectElement).value).toBe("doc");
});

it("收起筛选仍显示已提交筛选的生效数量", () => {
  render(<SearchBar tagVocab={{ doc: "文档" }} onSearch={() => {}} loading={false}
    appliedFilters={{ tag: "doc", under: "src" }} />);
  expect(screen.getByRole("button", { name: "筛选（已生效 2）" }).getAttribute("aria-expanded")).toBe("false");
});
