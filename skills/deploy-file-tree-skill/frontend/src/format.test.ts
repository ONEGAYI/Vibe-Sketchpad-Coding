import { describe, expect, it } from "vitest";
import { badgeTitle, entryFlags, gitIgnoreLabel } from "./format";

describe("gitIgnoreLabel（G07：三态不混为一态）", () => {
  it("键缺省：标注继承并给出当前有效值", () => {
    expect(gitIgnoreLabel(null, true)).toBe("缺省（继承祖先，当前豁免）");
    expect(gitIgnoreLabel(null, false)).toBe("缺省（继承祖先，当前不豁免）");
  });

  it("显式 true 与显式 false 文案不同", () => {
    expect(gitIgnoreLabel(true, true)).toBe("显式豁免（true）");
    expect(gitIgnoreLabel(false, false)).toBe("显式退出豁免（false）");
  });
});

describe("entryFlags", () => {
  it("仅列出为真的标志；collapsed 只对目录生效", () => {
    expect(entryFlags({ kind: "file", hidden: false, collapsed: false })).toEqual([]);
    expect(entryFlags({ kind: "dir", hidden: true, collapsed: true })).toEqual([
      "hidden",
      "collapsed",
    ]);
    expect(entryFlags({ kind: "file", hidden: true, collapsed: true })).toEqual(["hidden"]);
  });
});

describe("badgeTitle", () => {
  it("说明界面状态与 JSON 标志分离", () => {
    expect(badgeTitle("hidden")).toContain("界面仍可见");
    expect(badgeTitle("collapsed")).toContain("可在界面展开");
  });
});
