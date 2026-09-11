// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitLayout, sidebarGeometry } from "./SplitLayout";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("普通侧栏限位", () => {
  it("扣除分隔条后计算限位，并仅钳制显示首选宽度", () => {
    expect(sidebarGeometry(1024, 310)).toEqual({ available: 1015, stacked: false, min: 240, max: 440, width: 310 });
    expect(sidebarGeometry(800, 430).width).toBeCloseTo(363.86);
    expect(sidebarGeometry(1024, 430).width).toBe(430);
    expect(sidebarGeometry(609, 310).stacked).toBe(true);
  });

  it("键盘在限位内调宽；缩窗后恢复用户首选值", () => {
    let width = 1024;
    let resized = () => {};
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width } as DOMRect));
    vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resized = cb; } observe() {} disconnect() {} });
    const { rerender } = render(<SplitLayout><div /><div /></SplitLayout>);
    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("320");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
    width = 800;
    fireEvent(window, new Event("resize"));
    act(() => resized());
    rerender(<SplitLayout><div /><div /></SplitLayout>);
    expect(Number(separator.getAttribute("aria-valuenow"))).toBeCloseTo(363.86);
    width = 1024;
    act(() => resized());
    rerender(<SplitLayout><div /><div /></SplitLayout>);
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
  });

  it("拖动捕获指针并在取消后停止调宽", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 1024 } as DOMRect);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
    });
    render(<SplitLayout><div /><div /></SplitLayout>);
    const separator = screen.getByRole("separator");
    separator.setPointerCapture = vi.fn();
    separator.hasPointerCapture = vi.fn(() => true);
    separator.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 310 });
    expect(separator.setPointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 1000 });
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
    fireEvent.pointerCancel(separator, { pointerId: 1 });
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 200 });
    expect(separator.getAttribute("aria-valuenow")).toBe("440");
  });

  it("按钮模式占可用宽80%，关闭后恢复普通首选宽度", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 1009 } as DOMRect);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const { rerender, container } = render(<SplitLayout><div /><div /></SplitLayout>);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" });
    rerender(<SplitLayout expanded><div /><div /></SplitLayout>);
    expect((container.querySelector("main") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("800px");
    expect(screen.getByRole("separator").getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    rerender(<SplitLayout><div /><div /></SplitLayout>);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("320");
  });
});
