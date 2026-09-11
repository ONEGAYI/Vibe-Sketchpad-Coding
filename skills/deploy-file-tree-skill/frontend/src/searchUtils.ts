/** 搜索与树定位的展示层纯函数：查询串拼装、分页边界、祖先链展开。 */

export interface SearchFormParams {
  kw: string;
  tag: string;
  under: string;
}

/** 拼 /api/search 查询串（不含前导 ?）：空条件剔除，中文经 URL 编码。 */
export function buildSearchQuery(
  params: SearchFormParams,
  page: number,
  pageSize: number,
): string {
  const parts: string[] = [];
  const kw = params.kw.trim();
  const tag = params.tag.trim();
  const under = params.under.trim();
  if (kw) parts.push(`kw=${encodeURIComponent(kw)}`);
  if (tag) parts.push(`tag=${encodeURIComponent(tag)}`);
  if (under) parts.push(`under=${encodeURIComponent(under)}`);
  parts.push(`page=${page}`, `page_size=${pageSize}`);
  return parts.join("&");
}

/** 总页数：空结果为 0，不满一页算一页。 */
export function totalPages(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/** 是否可后退（首页不可）。 */
export function canPrev(page: number): boolean {
  return page > 1;
}

/** 是否可前进（空结果与末页不可）。 */
export function canNext(page: number, pages: number): boolean {
  return pages > 0 && page < pages;
}

/** 祖先目录链（严格前缀，不含自身）：树定位时需先展开的层级。 */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}
