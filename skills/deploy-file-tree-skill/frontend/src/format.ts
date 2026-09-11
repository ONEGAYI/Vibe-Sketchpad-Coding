/** 展示层纯函数：git-ignore 三态文案与条目标志徽章。 */

/** git-ignore 三态文案：键缺省=继承祖先；键在即显式设置（false 也落盘）。 */
export function gitIgnoreLabel(explicit: boolean | null, effective: boolean): string {
  if (explicit === null) {
    return `缺省（继承祖先，当前${effective ? "豁免" : "不豁免"}）`;
  }
  return explicit ? "显式豁免（true）" : "显式退出豁免（false）";
}

/** 条目标志徽章列表：仅列出为真的标志；collapsed 仅对目录有意义。 */
export function entryFlags(entry: {
  kind: string;
  hidden: boolean;
  collapsed: boolean;
}): string[] {
  const flags: string[] = [];
  if (entry.hidden) flags.push("hidden");
  if (entry.kind === "dir" && entry.collapsed) flags.push("collapsed");
  return flags;
}

/** 徽章悬停提示：说明界面状态与 JSON 标志分离（G11）。 */
export function badgeTitle(flag: string): string {
  if (flag === "hidden") return "hidden: true（界面仍可见，浏览不改动数据）";
  if (flag === "collapsed") return "collapsed: true（初始折叠，可在界面展开）";
  return flag;
}
