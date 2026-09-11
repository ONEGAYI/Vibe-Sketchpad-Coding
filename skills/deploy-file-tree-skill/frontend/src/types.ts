/** 与后端 viewer.py API 响应对应的类型契约（所有响应均带 generation 世代号）。 */

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
  /** 正向关联：当前条目 → 目标 */
  rel: RelRef[];
  /** 反向关联：引用者 → 当前条目（来源必在树中，exists 恒 true） */
  backrefs: RelRef[];
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

/** 搜索筛选条件（服务端回显形态：空条件为 null） */
export interface SearchQueryEcho {
  kw: string | null;
  tag: string | null;
  under: string | null;
  depth: number | null;
}

/** 搜索结果条目：字段集与后端 /api/search 契约一致 */
export interface SearchHit {
  path: string;
  kind: "dir" | "file";
  desc: string;
  detail: string[];
  rel: string[];
  tags: string[];
  collapsed: boolean;
  hidden: boolean;
  git_ignore: boolean | null;
}

export interface SearchResponse {
  query: SearchQueryEcho;
  total: number;
  total_pages: number;
  page: number;
  page_size: number;
  results: SearchHit[];
}

export interface RootInfo {
  root: string;
  /** 标签词表：名 -> 说明 */
  tags: Record<string, string>;
  counts: { dirs: number; files: number; total: number };
  source: string;
}

/** POST /api/refresh 成功响应：新世代号 + 根信息。 */
export interface RefreshResponse {
  generation: number;
  refreshed: true;
  root: string;
  tags: Record<string, string>;
  counts: { dirs: number; files: number; total: number };
  source: string;
}

/** 世代号戳：后端给每个查询响应的统一盖章（G12 版本隔离）。 */
export interface GenerationStamped {
  generation: number;
}
