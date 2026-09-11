import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  buildSearchQuery,
  canNext,
  canPrev,
  paramsFromQuery,
  totalPages,
} from "./searchUtils";
import type { SearchFormParams } from "./searchUtils";

const empty: SearchFormParams = { kw: "", tag: "", under: "" };

describe("buildSearchQuery（组合筛选：空条件剔除、非空编码拼接）", () => {
  it("全空条件只带分页参数", () => {
    expect(buildSearchQuery(empty, 1, 50)).toBe("page=1&page_size=50");
  });

  it("空白输入视为未提供", () => {
    expect(buildSearchQuery({ kw: "   ", tag: "", under: " " }, 1, 50)).toBe(
      "page=1&page_size=50",
    );
  });

  it("关键词单条件", () => {
    expect(buildSearchQuery({ ...empty, kw: "readme" }, 1, 50)).toBe(
      "kw=readme&page=1&page_size=50",
    );
  });

  it("组合条件全部拼接且中文经 URL 编码", () => {
    const q = buildSearchQuery({ kw: "渲染", tag: "pure", under: "中文目录" }, 2, 5);
    expect(q).toBe(
      `kw=${encodeURIComponent("渲染")}&tag=pure&under=${encodeURIComponent("中文目录")}&page=2&page_size=5`,
    );
  });
});

describe("totalPages（分页边界）", () => {
  it("空结果没有页", () => {
    expect(totalPages(0, 50)).toBe(0);
  });

  it("不满一页算一页；整除无零头页", () => {
    expect(totalPages(1, 50)).toBe(1);
    expect(totalPages(13, 5)).toBe(3);
    expect(totalPages(10, 5)).toBe(2);
  });
});

describe("翻页可用性", () => {
  it("首页不可后退", () => {
    expect(canPrev(1)).toBe(false);
    expect(canPrev(2)).toBe(true);
  });

  it("末页与空结果不可前进", () => {
    expect(canNext(1, 0)).toBe(false);
    expect(canNext(3, 3)).toBe(false);
    expect(canNext(2, 3)).toBe(true);
  });
});

describe("paramsFromQuery（服务端回显条件 → 表单参数三字段）", () => {
  it("null 归一为空串（空条件未提供的回显形态）", () => {
    expect(
      paramsFromQuery({ kw: null, tag: null, under: null, depth: null }),
    ).toEqual({ kw: "", tag: "", under: "" });
  });

  it("非空值逐字段保留（depth 不参与表单）", () => {
    expect(
      paramsFromQuery({ kw: "渲染", tag: "doc", under: "src", depth: 2 }),
    ).toEqual({ kw: "渲染", tag: "doc", under: "src" });
  });

  it("部分提供部分缺省混合归一", () => {
    expect(paramsFromQuery({ kw: "readme", tag: null, under: "中文目录", depth: null })).toEqual(
      { kw: "readme", tag: "", under: "中文目录" },
    );
  });
});

describe("ancestorsOf（树定位：严格前缀目录链）", () => {
  it("顶层条目无祖先", () => {
    expect(ancestorsOf("README.md")).toEqual([]);
  });

  it("多级路径给出逐级目录链（不含自身）", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("src/sub/deep.ts")).toEqual(["src", "src/sub"]);
  });

  it("目录路径同样不含自身（展开自身由调用方按 kind 决定）", () => {
    expect(ancestorsOf("src/sub")).toEqual(["src"]);
  });
});
