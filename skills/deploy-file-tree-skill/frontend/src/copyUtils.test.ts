// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyUtils";

const nav = navigator as Navigator & {
  clipboard?: { writeText: (t: string) => Promise<void> };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 还原本用例手工替换的 execCommand（jsdom 30 已移除该 API）
  Reflect.deleteProperty(document, "execCommand");
});

/** 装 execCommand mock（jsdom 30 无此 API，vi.spyOn 会抛错）。 */
function stubExecCommand(returns: boolean) {
  const fn = vi.fn().mockReturnValue(returns);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: fn,
  });
  return fn;
}

describe("copyText（复制完整路径）", () => {
  it("优先走 navigator.clipboard 并返回成功", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...nav, clipboard: { writeText } });
    await expect(copyText("apps/main.tsx")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("apps/main.tsx");
  });

  it("clipboard 不可用时回退 execCommand 方案", async () => {
    vi.stubGlobal("navigator", {}); // 无 clipboard
    const exec = stubExecCommand(true);
    await expect(copyText("中文目录/说明.md")).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("clipboard 抛错（非安全上下文等）也走回退", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const exec = stubExecCommand(true);
    await expect(copyText("a/b.ts")).resolves.toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it("全部途径失败返回 false（不抛错）", async () => {
    vi.stubGlobal("navigator", {});
    const exec = stubExecCommand(false);
    await expect(copyText("x")).resolves.toBe(false);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});
