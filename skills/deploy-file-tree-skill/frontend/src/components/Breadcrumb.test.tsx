// @vitest-environment jsdom
/** 面包屑（G10）：各级可点击跳转、末级为当前条目、复制完整路径。 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Breadcrumb", () => {
  it("无选中时根面包屑常驻且不能复制路径", () => {
    const { container } = render(
      <Breadcrumb rootName="演示仓库" selected={null} onNavigate={() => {}} />,
    );
    expect(container.querySelector(".breadcrumb")).not.toBeNull();
    expect(container.querySelector(".crumb")?.textContent).toBe("演示仓库");
    const copyButton = container.querySelector(".copy-button") as HTMLButtonElement;
    expect(copyButton.disabled).toBe(true);
    // 禁用态提示不得暴露实现字面量（如 "复制完整路径：null"）
    expect(copyButton.title).toBe("复制完整路径");
  });

  it("按路径分段渲染：根可点、各级目录可点、末级为当前条目", () => {
    const navigated: string[] = [];
    render(
      <Breadcrumb
        rootName="演示仓库"
        selected="apps/sub/deep.ts"
        onNavigate={(p) => navigated.push(p)}
      />,
    );
    const crumbs = Array.from(document.querySelectorAll(".crumb")).map(
      (el) => el.textContent,
    );
    expect(crumbs).toEqual(["演示仓库", "apps", "sub", "deep.ts"]);
    // 根 → 空路径
    fireEvent.click(document.querySelectorAll(".crumb")[0]);
    // apps 段
    fireEvent.click(document.querySelectorAll(".crumb")[1]);
    // sub 段
    fireEvent.click(document.querySelectorAll(".crumb")[2]);
    expect(navigated).toEqual(["", "apps", "apps/sub"]);
    // 末级（当前条目）不是按钮
    const last = document.querySelectorAll(".crumb")[3];
    expect(last.tagName).not.toBe("BUTTON");
  });

  it("复制路径：点击后写入剪贴板并提示成功", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <Breadcrumb rootName="演示仓库" selected="apps/sub/deep.ts" onNavigate={() => {}} />,
    );
    const btn = document.querySelector(".copy-button") as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("apps/sub/deep.ts");
    await waitFor(() => {
      expect(document.querySelector(".copy-button")?.textContent).toContain("已复制");
    });
  });

  it("中文路径完整往返（编码不丢字）", () => {
    const navigated: string[] = [];
    render(
      <Breadcrumb
        rootName="演示仓库"
        selected="中文目录/说明.md"
        onNavigate={(p) => navigated.push(p)}
      />,
    );
    fireEvent.click(document.querySelectorAll(".crumb")[1]);
    expect(navigated).toEqual(["中文目录"]);
  });
});
