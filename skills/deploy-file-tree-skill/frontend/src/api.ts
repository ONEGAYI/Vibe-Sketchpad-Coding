/** 快照查询 API 封装：只读 GET，错误统一抛 ApiError（消息来自后端 error 字段）。 */

import type { ChildEntry, EntryDetail, RootInfo } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url);
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
  root: () => getJson<RootInfo>("/api/root"),
  /** 目录子项（按需）；path 为空串表示根级 */
  children: (path: string) =>
    getJson<{ path: string; children: ChildEntry[] }>(
      `/api/children?path=${encodeURIComponent(path)}`,
    ),
  /** 条目详情（按需） */
  detail: (path: string) => getJson<EntryDetail>(`/api/detail?path=${encodeURIComponent(path)}`),
};
