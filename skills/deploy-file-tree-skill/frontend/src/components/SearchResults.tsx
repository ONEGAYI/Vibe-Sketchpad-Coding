import type { SearchHit, SearchResponse } from "../types";
import { canNext, canPrev } from "../searchUtils";

interface SearchResultsProps {
  resp: SearchResponse;
  onPageChange: (page: number) => void;
  onHitClick: (hit: SearchHit) => void;
  onBackToTree: () => void;
  loading: boolean;
}

/** 左栏搜索结果：总命中数、分页（不漏不重由后端切片保证）、空状态、命中定位。 */
export function SearchResults({
  resp,
  onPageChange,
  onHitClick,
  onBackToTree,
  loading,
}: SearchResultsProps) {
  const pages = resp.total_pages;
  const empty = resp.total === 0;
  return (
    <div className="search-results">
      <header className="search-meta">
        <span>
          共 <strong>{resp.total}</strong> 条命中
          {pages > 0 && (
            <>
              {" · 第 "}
              <strong>{resp.page}</strong> / {pages} 页
            </>
          )}
        </span>
        <button type="button" className="link-button" onClick={onBackToTree}>
          返回目录树
        </button>
      </header>

      {empty ? (
        <p className="muted search-empty">没有匹配的条目：换一组关键词或放宽筛选条件试试。</p>
      ) : (
        <ul className="hit-list" role="listbox" aria-label="搜索结果">
          {resp.results.map((hit) => (
            <li key={hit.path}>
              <button
                type="button"
                className={[
                  "hit-row",
                  hit.kind,
                  hit.hidden ? "is-hidden" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="option"
                aria-selected={false}
                title={hit.path}
                onClick={() => onHitClick(hit)}
              >
                <span className="icon" aria-hidden="true">
                  {hit.kind === "dir" ? "📁" : "📄"}
                </span>
                <span className="hit-main">
                  <span className="hit-path">{hit.path}</span>
                  {hit.desc && <span className="hit-desc">{hit.desc}</span>}
                </span>
                <span className="hit-badges">
                  {hit.tags.map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                  {hit.hidden && <span className="badge badge-hidden">hidden</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <footer className="pager">
          <button
            type="button"
            className="search-button secondary"
            disabled={!canPrev(resp.page) || loading}
            onClick={() => onPageChange(resp.page - 1)}
          >
            上一页
          </button>
          <span className="muted">
            {resp.page} / {pages}
          </span>
          <button
            type="button"
            className="search-button secondary"
            disabled={!canNext(resp.page, pages) || loading}
            onClick={() => onPageChange(resp.page + 1)}
          >
            下一页
          </button>
        </footer>
      )}
    </div>
  );
}
