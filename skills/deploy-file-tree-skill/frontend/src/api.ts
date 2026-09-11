/**
 * 快照查询 API 封装：只读 GET + 唯一的 POST /api/refresh（手动刷新），
 * 错误统一抛 ApiError（消息来自后端 error 字段）。
 * 所有响应带 generation 世代号（G12）：前端据此识别快照版本。
 */

import type {
  ChildEntry,
  EntryDetail,
  GenerationStamped,
  RefreshResponse,
  RootInfo,
  SearchResponse,
} from "./types";
import { buildSearchQuery, type SearchFormParams } from "./searchUtils";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>("GET", url);
}

async function requestJson<T>(method: "GET" | "POST", url: string): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, { method });
  } catch (err) {
    throw new ApiError(0, `无法连接查看器服务: ${err instanceof Error ? err.message : String(err)}`);
  }
  const data: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${resp.status}`;
    throw new ApiError(resp.status, message);
  }
  return data as T;
}

export const api = {
  root: () => getJson<RootInfo & GenerationStamped>("/api/root"),
  /** 目录子项（按需）；path 为空串表示根级 */
  children: (path: string) =>
    getJson<GenerationStamped & { path: string; children: ChildEntry[] }>(
      `/api/children?path=${encodeURIComponent(path)}`,
    ),
  /** 条目详情（按需） */
  detail: (path: string) =>
    getJson<EntryDetail & GenerationStamped>(`/api/detail?path=${encodeURIComponent(path)}`),
  /** 组合搜索（G08）：kw/tag/under 可组合，分页 page/pageSize */
  search: (params: SearchFormParams, page = 1, pageSize = 50) =>
    getJson<SearchResponse & GenerationStamped>(
      `/api/search?${buildSearchQuery(params, page, pageSize)}`,
    ),
  /**
   * 手动刷新（G12）：后端重读同一路径 tree.json 并原子替换；
   * 失败抛 ApiError（旧数据在后端保持可用，前端标明"未刷新"）。
   */
  refresh: () => requestJson<RefreshResponse>("POST", "/api/refresh"),
};
