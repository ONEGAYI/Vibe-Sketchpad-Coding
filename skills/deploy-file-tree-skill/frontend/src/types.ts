/** 与后端 viewer.py API 响应对应的类型契约。 */

export interface ChildEntry {
  name: string;
  /** 仓库相对路径，正斜杠分隔 */
  path: string;
  kind: "dir" | "file";
  desc: string;
  hidden: boolean;
  collapsed: boolean;
  /** 三态：null = 键缺省继承祖先；false = 显式退出豁免；true = 豁免 */
  git_ignore: boolean | null;
  /** 目录子项数（空目录为 0）；文件为 null */
  child_count: number | null;
}

export interface RelRef {
  path: string;
  /** 目标是否存在于快照中（false = 悬空关联） */
  exists: boolean;
}

export interface EntryDetail {
  path: string;
  name: string;
  kind: "dir" | "file";
  desc: string;
  /** 完整描述：每元素一行 */
  detail: string[];
  rel: RelRef[];
  tags: string[];
  collapsed: boolean;
  hidden: boolean;
  git_ignore: {
    /** 键缺省 = null / 显式 false / 显式 true */
    explicit: boolean | null;
    /** 沿祖先链就近覆写后的有效值 */
    effective: boolean;
  };
  child_count: number | null;
}

export interface RootInfo {
  root: string;
  /** 标签词表：名 -> 说明 */
  tags: Record<string, string>;
  counts: { dirs: number; files: number; total: number };
  source: string;
}
