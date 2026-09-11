import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ChildEntry, EntryDetail, RootInfo, SearchHit, SearchResponse } from "./types";
import type { SearchFormParams } from "./searchUtils";
import { ancestorsOf } from "./searchUtils";
import { TreeNode } from "./components/TreeNode";
import { DetailPanel } from "./components/DetailPanel";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import "./index.css";

/** 左栏视图：目录树 / 搜索结果（G05：左侧目录树或搜索结果）。 */
type LeftView = "tree" | "search";

/**
 * 双栏浏览主组件：左侧目录树或搜索结果（懒加载、展开/折叠、选择、命中定位），
 * 右侧条目详情。界面状态（expanded/selected/搜索）与快照 JSON 标志
 * （hidden/collapsed/git-ignore）完全分离——浏览绝不改动持久化标志。
 */
export default function App() {
  const [rootInfo, setRootInfo] = useState<RootInfo | null>(null);
  const [childrenCache, setChildrenCache] = useState<Map<string, ChildEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftView, setLeftView] = useState<LeftView>("tree");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const selectSeq = useRef(0);

  // 初始加载：根信息 + 根级子项（仅一级，深层按需拉取）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [root, top] = await Promise.all([api.root(), api.children("")]);
        if (cancelled) return;
        setRootInfo(root);
        setChildrenCache(new Map([["", top.children]]));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    (entry: ChildEntry) => {
      if (entry.kind !== "dir") return;
      const willOpen = !expanded.has(entry.path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      // 懒加载：首次展开才请求该目录子项（G14 按需）；结果缓存，折叠不丢数据
      if (willOpen && !childrenCache.has(entry.path)) {
        api
          .children(entry.path)
          .then((resp) => {
            setChildrenCache((cur) =>
              cur.has(entry.path) ? cur : new Map(cur).set(entry.path, resp.children),
            );
          })
          .catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
      }
    },
    [expanded, childrenCache],
  );

  const select = useCallback((path: string) => {
    const seq = ++selectSeq.current;
    setSelected(path);
    setDetail(null);
    setDetailLoading(true);
    api
      .detail(path)
      .then((d) => {
        if (seq === selectSeq.current) setDetail(d);
      })
      .catch((err) => {
        if (seq === selectSeq.current) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (seq === selectSeq.current) setDetailLoading(false);
      });
  }, []);

  // 树定位（G08 命中可定位回树）：沿祖先链逐级加载子项并展开，再选中目标。
  // 搜索命中点击与关联跳转共用；链上加载串行等待，保证层级顺序可见。
  const navigateTo = useCallback(
    async (path: string) => {
      try {
        for (const dir of ancestorsOf(path)) {
          if (!childrenCache.has(dir)) {
            const resp = await api.children(dir);
            setChildrenCache((cur) =>
              cur.has(dir) ? cur : new Map(cur).set(dir, resp.children),
            );
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const dir of ancestorsOf(path)) next.add(dir);
        return next;
      });
      setLeftView("tree");
      select(path);
    },
    [childrenCache, select],
  );

  const runSearch = useCallback(
    async (params: SearchFormParams, page = 1) => {
      setSearchLoading(true);
      try {
        const resp = await api.search(params, page);
        setSearchResult(resp);
        setLeftView("search");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSearchLoading(false);
      }
    },
    [],
  );

  const onSearch = useCallback(
    (params: SearchFormParams) => {
      runSearch(params, 1);
    },
    [runSearch],
  );

  const onPageChange = useCallback(
    (page: number) => {
      if (searchResult === null) return;
      // 复用响应中的回显条件（query），保证翻页与首页同参（不漏不重）
      const params: SearchFormParams = {
        kw: searchResult.query.kw ?? "",
        tag: searchResult.query.tag ?? "",
        under: searchResult.query.under ?? "",
      };
      runSearch(params, page);
    },
    [searchResult, runSearch],
  );

  const onHitClick = useCallback(
    (hit: SearchHit) => {
      navigateTo(hit.path);
    },
    [navigateTo],
  );

  const rootChildren = childrenCache.get("");

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">{rootInfo ? rootInfo.root : "文件树查看器"}</span>
        {rootInfo && (
          <span className="muted">
            {rootInfo.counts.total} 条目（{rootInfo.counts.dirs} 目录 / {rootInfo.counts.files}{" "}
            文件）· 只读
          </span>
        )}
      </header>

      <SearchBar
        tagVocab={rootInfo?.tags ?? {}}
        onSearch={onSearch}
        loading={searchLoading}
      />

      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="关闭错误提示">
            ×
          </button>
        </div>
      )}

      <main className="columns">
        <nav className="panel tree" aria-label="目录树" role="tree">
          {leftView === "search" && searchResult !== null ? (
            <SearchResults
              resp={searchResult}
              onPageChange={onPageChange}
              onHitClick={onHitClick}
              onBackToTree={() => setLeftView("tree")}
              loading={searchLoading}
            />
          ) : rootChildren === undefined ? (
            <p className="muted loading">加载中…</p>
          ) : rootChildren.length === 0 ? (
            <p className="muted loading">（空树：快照没有任何条目）</p>
          ) : (
            rootChildren.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expanded={expanded}
                cache={childrenCache}
                selected={selected}
                onToggle={toggle}
                onSelect={(e) => select(e.path)}
              />
            ))
          )}
        </nav>
        <DetailPanel
          rootInfo={rootInfo}
          detail={detail}
          selected={selected}
          loading={detailLoading}
          onNavigate={navigateTo}
        />
      </main>
    </div>
  );
}
