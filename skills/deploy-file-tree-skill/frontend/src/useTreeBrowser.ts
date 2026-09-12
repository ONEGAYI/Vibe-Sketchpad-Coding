import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./api";
import type { ChildEntry, EntryDetail, RootInfo, SearchHit, SearchResponse } from "./types";
import { paramsFromQuery, type SearchFormParams } from "./searchUtils";
import {
  canGoBack,
  canGoForward,
  createEpochGuard,
  createGenerationGate,
  currentPath,
  emptyHistory,
  goBack,
  goForward,
  pushSelection,
  type SelectionHistory,
} from "./navigation";
import { flattenVisibleRows, rowIndexByPath } from "./treeRows";
import { handleTreeKey } from "./keyboardNav";
import { existsInCache, reconcileAfterRefresh } from "./refreshReconcile";

/** 浏览状态与请求的唯一入口；组件只能调用领域动作，不暴露内部 setter。 */
type LeftView = "tree" | "search";
export type ChildrenLoadState = { status: "loading" | "error" | "missing"; message?: string };

export function useTreeBrowser(hierarchyOpen = false) {
  const hierarchyRef = useRef(hierarchyOpen);
  hierarchyRef.current = hierarchyOpen;
  const [rootInfo, setRootInfo] = useState<RootInfo | null>(null);
  const [childrenCache, setChildrenCache] = useState<Map<string, ChildEntry[]>>(new Map());
  const [childrenState, setChildrenState] = useState<Map<string, ChildrenLoadState>>(new Map());
  const childrenRequests = useRef(new Map<string, { epoch: number; promise: Promise<boolean> }>());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<SelectionHistory>(emptyHistory());
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [leftView, setLeftView] = useState<LeftView>("tree");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const selected = currentPath(history);
  const epochGuard = useMemo(() => createEpochGuard(), []);
  const generationGate = useMemo(() => createGenerationGate(), []);
  const detailSeq = useRef(0);
  const searchSeq = useRef(0);
  // 保存最新已提交意图及其已展示世代；草稿仍由 SearchBar 独立维护。
  const searchIntent = useRef<{ params: SearchFormParams; generation: number | null } | null>(null);
  const navigationSeq = useRef(0);
  const cacheRef = useRef(childrenCache);
  cacheRef.current = childrenCache;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const detailGeneration = useRef<number | null>(null);
  // 失败路径重拉详情需读"最新"选中（闭包值可能已被刷新期间的用户操作改变）
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const recoverMissing = useCallback((path: string) => {
    const fallback = ancestors(path).filter((dir) => existsInCache(cacheRef.current, dir)).pop() ?? "";
    navigationSeq.current += 1;
    setHistory((current) => {
      const entries = current.entries.filter((entry) => entry !== path);
      const index = current.entries.slice(0, current.index + 1).filter((entry) => entry !== path).length - 1;
      return pushSelection({ entries, index }, fallback);
    });
    setNotice(`条目 ${path} 已不存在，已回退到${fallback || "根概览"}`);
  }, []);

  // 初始加载：根信息 + 根级子项（仅一级，深层按需拉取）；
  // root 响应确认首个后端世代，此后旧世代响应一律按章丢弃。
  // 跨标签页并发刷新可能夹在 root 与 children 两次服务端读之间：
  // 世代不一致即整体重取（有界重试），超限则以 children 世代为准重取 root
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let [root, top] = await Promise.all([api.root(), api.children("")]);
        for (let attempt = 0; attempt < 2 && root.generation !== top.generation; attempt++) {
          if (cancelled) return;
          [root, top] = await Promise.all([api.root(), api.children("")]);
        }
        if (root.generation !== top.generation) {
          root = await api.root(); // 超限兜底：树数据以 children 世代为准，root 尽力对齐
        }
        if (cancelled) return;
        generationGate.adopt(Math.max(root.generation, top.generation));
        setRootInfo(root);
        setChildrenCache(new Map([["", top.children]]));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generationGate]);

  /** 拉取条目详情（A1 抽取为可复用：选中 effect 与刷新成功后的重拉共用）。
   * seq 防同代乱序，epoch 防跨版本旧响应，generation 防新 epoch 携旧快照
   * 内容的混用窗口。旧世代响应被世代门拦下时按当前世代重拉一次（N2：
   * 否则 detail 停留 null、右栏永久占位），仅重拉一次防循环。 */
  const loadDetail = useCallback(
    (path: string, retriedStale = false): Promise<void> => {
      const seq = ++detailSeq.current;
      const epoch = epochGuard.current();
      setDetail(null);
      setDetailLoading(true);
      return api
        .detail(path)
        .then((d) => {
          if (seq !== detailSeq.current || !epochGuard.isCurrent(epoch)) return;
          if (generationGate.isStale(d.generation)) {
            if (!retriedStale) void loadDetail(path, true);
            return;
          }
          setDetail(d);
          detailGeneration.current = d.generation;
        })
        .catch((err) => {
          if (seq === detailSeq.current && epochGuard.isCurrent(epoch)) {
            if (err instanceof ApiError && err.status === 404) {
              recoverMissing(path);
              return;
            }
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => {
          if (seq === detailSeq.current) setDetailLoading(false);
        });
    },
    // 自引用（重拉）依赖 deps 稳定的 useCallback 实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [epochGuard, generationGate, recoverMissing],
  );

  // 选中变化 → 拉详情（seq 防同代乱序，epoch 防跨版本旧响应，
  // generation 防新 epoch 携旧快照内容的混用窗口）
  useEffect(() => {
    if (!selected) {
      detailSeq.current += 1; // 作废在途详情
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    loadDetail(selected);
  }, [selected, loadDetail]);

  /** 懒加载目录子项（G14 按需）：首次展开才请求；结果带 epoch 复核，
   * 旧世代响应（refresh bump 后、服务端替换前发出）按 generation 丢弃，
   * 不写缓存——杜绝函数式回写把旧世代子项写回新缓存。 */
  const loadChildren = useCallback(
    (dir: string) => {
      const epoch = epochGuard.current();
      const active = childrenRequests.current.get(dir);
      if (active?.epoch === epoch) return active.promise;
      setChildrenState((current) => new Map(current).set(dir, { status: "loading" }));
      const promise = api.children(dir).then((resp) => {
        if (!epochGuard.isCurrent(epoch)) return false;
        if (generationGate.isStale(resp.generation)) {
          setChildrenState((current) => new Map(current).set(dir, { status: "error", message: "快照已更新，请重试" }));
          return false;
        }
        setChildrenCache((cur) =>
          cur.has(dir) ? cur : new Map(cur).set(dir, resp.children),
        );
        setChildrenState((current) => { const next = new Map(current); next.delete(dir); return next; });
        return true;
      }).catch((err) => {
        if (!epochGuard.isCurrent(epoch)) return false;
        setChildrenState((current) => new Map(current).set(dir, {
          status: err instanceof ApiError && err.status === 404 ? "missing" : "error",
          message: err instanceof Error ? err.message : String(err),
        }));
        throw err;
      }).finally(() => {
        if (childrenRequests.current.get(dir)?.promise === promise) childrenRequests.current.delete(dir);
      });
      childrenRequests.current.set(dir, { epoch, promise });
      return promise;
    },
    [epochGuard, generationGate],
  );

  const applyToggle = useCallback(
    (path: string, open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(path);
        else next.delete(path);
        return next;
      });
      if (open && !childrenCache.has(path)) {
        loadChildren(path).catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        );
      }
    },
    [childrenCache, loadChildren],
  );

  /** 树行点击：选择（入历史）。 */
  const onRowClick = useCallback(
    (path: string) => {
      navigationSeq.current += 1;
      setHistory((h) => pushSelection(h, path));
    },
    [],
  );

  /** 树行 toggle 按钮：展开/折叠（不影响选择）。 */
  const onToggle = useCallback(
    (path: string) => {
      applyToggle(path, !expanded.has(path));
    },
    [applyToggle, expanded],
  );

  // 树定位（G08 命中可定位回树）：沿祖先链逐级加载子项并展开，再选中目标。
  // 搜索命中点击、关联跳转与面包屑共用；链上加载串行等待，保证层级顺序可见。
  const navigateTo = useCallback(
    async (path: string) => {
      const navigation = ++navigationSeq.current;
      if (path === "") {
        setLeftView("tree");
        setHistory((current) => pushSelection(current, ""));
        return;
      }
      const epoch = epochGuard.current();
      try {
        for (const dir of ancestors(path)) {
          if (!childrenCache.has(dir) && !(await loadChildren(dir))) return;
        }
      } catch (err) {
        if (navigation !== navigationSeq.current || !epochGuard.isCurrent(epoch)) return;
        if (err instanceof ApiError && err.status === 404) { recoverMissing(path); return; }
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!epochGuard.isCurrent(epoch)) return;
      if (navigation !== navigationSeq.current) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const dir of ancestors(path)) next.add(dir);
        return next;
      });
      setLeftView("tree");
      setHistory((h) => pushSelection(h, path));
    },
    [childrenCache, loadChildren, epochGuard, recoverMissing],
  );

  /** 树容器键盘导航（G10）：↑↓ 选择、→ 展开/进入、← 折叠/跳父、Home/End。 */
  const onTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const rows = flattenVisibleRows(childrenCache, expanded);
      const selIndex = selected !== null ? rowIndexByPath(rows, selected) : null;
      const action = handleTreeKey(e.key, rows, expanded, selIndex);
      if (action.type === "none") return;
      e.preventDefault();
      if (action.type === "move") {
        const target = rows[action.index];
        if (target && target.entry !== null) {
          onRowClick(target.entry.path);
        }
      } else {
        applyToggle(action.path, action.open);
      }
    },
    [childrenCache, expanded, selected, applyToggle, onRowClick],
  );

  const runSearch = useCallback(
    async (params: SearchFormParams, page = 1, retriedStale = false): Promise<void> => {
      const seq = ++searchSeq.current; // 同代并发搜索乱序防护（B5）
      const epoch = epochGuard.current();
      searchIntent.current = { params, generation: null };
      setSearchLoading(true);
      try {
        const resp = await api.search(params, page);
        if (seq !== searchSeq.current) return;
        if (!epochGuard.isCurrent(epoch)) return;
        if (generationGate.isStale(resp.generation)) {
          // 最新查询晚回旧世代时只重试一次；新的用户查询仍由 seq 优先。
          if (!retriedStale) return runSearch(params, 1, true);
          setError("搜索响应已过期，请重新搜索");
          return;
        }
        searchIntent.current = { params, generation: resp.generation };
        setSearchResult(resp);
        setLeftView("search");
      } catch (err) {
        if (seq === searchSeq.current && epochGuard.isCurrent(epoch)) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (seq === searchSeq.current && epochGuard.isCurrent(epoch)) setSearchLoading(false);
      }
    },
    [epochGuard, generationGate],
  );

  const onSearch = useCallback(
    (params: SearchFormParams) => {
      navigationSeq.current += 1;
      runSearch(params, 1);
    },
    [runSearch],
  );

  const onPageChange = useCallback(
    (page: number) => {
      if (searchResult === null) return;
      // 复用响应中的回显条件（query），保证翻页与首页同参（不漏不重）
      runSearch(paramsFromQuery(searchResult.query), page);
    },
    [searchResult, runSearch],
  );

  const onHitClick = useCallback(
    (hit: SearchHit) => {
      navigateTo(hit.path);
    },
    [navigateTo],
  );

  /**
   * 手动刷新（G12）：POST /api/refresh 成功后整缓存重建（同一新世代），
   * 仍存在的展开目录与选中尽量保留；已删除路径按回退规则处理并提示。
   * 失败：报错并明确标示当前仍是旧数据；世代门闩作废全部在途回调，
   * 但被作废的在途详情与展开目录请求必须有重拉路径（A1/B4），loading
   * 不得因作废而永久卡住（A1/A2）。
   * 成功即采纳新世代号：此后任何旧世代响应（含重建期间晚到的子项请求）
   * 按 generation 丢弃，不写回新缓存。重建循环对每个响应单独 adopt：
   * 他人并发刷新换代时世代门保持 ≥ 已展示数据世代（B2）。
   */
  const doRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    const epoch = epochGuard.bump();
    navigationSeq.current += 1;
    const selectedAtStart = selectedRef.current;
    setChildrenState(new Map());
    detailSeq.current += 1; // 作废在途详情请求
    const searchSeqAtStart = searchSeq.current; // B3：刷新发起时的搜索序
    try {
      const resp = await api.refresh();
      if (!epochGuard.isCurrent(epoch)) return;
      generationGate.adopt(resp.generation);

      // 重建子项缓存：根级 + 仍存在的展开目录（404 = 已删除，直接跳过）
      const newCache = new Map<string, ChildEntry[]>();
      const top = await api.children("");
      if (!epochGuard.isCurrent(epoch)) return;
      if (generationGate.isStale(top.generation)) throw new Error("根目录响应已过期，请重新刷新");
      generationGate.adopt(top.generation);
      newCache.set("", top.children);
      const attempted = new Set([""]);
      // 刷新期间可改选；每次请求后重新读取当前链，而不是冻结点击刷新时的路径。
      const requiredDirectories = () => {
        const current = selectedRef.current;
        const dirs = new Set(expanded);
        if (current) {
          for (const dir of ancestors(current)) dirs.add(dir);
          const parent = current.split("/").slice(0, -1).join("/");
          const entry = (newCache.get(parent) ?? cacheRef.current.get(parent))?.find((item) => item.path === current);
          if (hierarchyRef.current && entry?.kind === "dir") dirs.add(current);
        }
        return dirs;
      };
      while (true) {
        const dir = [...requiredDirectories()].find((path) => !attempted.has(path));
        if (dir === undefined) break;
        attempted.add(dir);
        try {
          const r = await api.children(dir);
          if (!epochGuard.isCurrent(epoch)) return;
          if (generationGate.isStale(r.generation)) throw new Error(`目录 ${dir} 响应已过期，请重新刷新`);
          generationGate.adopt(r.generation);
          newCache.set(dir, r.children);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) continue;
          throw err;
        }
      }

      const outcome = reconcileAfterRefresh({
        expanded,
        selected: selectedRef.current,
        exists: (p) => existsInCache(newCache, p),
      });
      setChildrenCache(newCache);
      cacheRef.current = newCache;
      setExpanded(new Set(outcome.keptExpanded));
      setRootInfo(resp);

      // 选中回退：仍存在→重拉详情（新世代数据，selected 未变 effect 不重跑）；
      // 刷新在途期间用户已改选时不得为旧选中重拉（N1：会作废用户在途详情
      // 并写入旧详情，右栏永久占位）——改选由其自身的详情 effect 负责；
      // 被删→回退目标入历史（selected 变化驱动 effect 重拉）；全删→清历史与详情
      if (!outcome.selected) {
        if (outcome.originalSelectedDeleted) recoverMissing(selectedRef.current!);
        setDetail(null);
        setDetailLoading(false);
      } else if (outcome.originalSelectedDeleted) {
        recoverMissing(selectedRef.current!);
      } else if (selectedRef.current === selectedAtStart ||
        (detailRef.current?.path === outcome.selected && generationGate.isStale(detailGeneration.current))) {
        loadDetail(outcome.selected);
      }
      if (outcome.notice) setNotice(outcome.notice);

      // 搜索结果属于旧世代：回到树视图并按原条件重跑（新版本数据）；
      // 但刷新期间用户已发起新搜索（序号已变）时不动用户当前搜索状态（B3）
      if (searchSeq.current === searchSeqAtStart) {
        setSearchResult(null);
        setLeftView("tree");
        if (searchResult !== null) {
          runSearch(paramsFromQuery(searchResult.query), 1);
        }
      } else if (searchIntent.current && searchIntent.current.generation !== null &&
        generationGate.isStale(searchIntent.current.generation)) {
        // 刷新期间的新查询已经展示旧代结果：保留可见结果，按最新意图后台换代。
        // 在途查询尚无 generation，交给 runSearch 收到响应时自行判定，避免重发。
        runSearch(searchIntent.current.params, 1);
      }
    } catch (err) {
      if (!epochGuard.isCurrent(epoch)) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(`刷新失败：${msg}——当前仍显示旧数据（未刷新）`);
      // 失败时旧世代仍有效：被作废的在途详情按当前选中重拉（loading 走
      // 正常周期，右栏不永久占位）；被作废的展开目录重发（新 epoch 可通过）
      if (selectedRef.current) {
        loadDetail(selectedRef.current);
      } else {
        setDetailLoading(false);
      }
      const recoveryDirs = new Set([...expandedRef.current, ...ancestors(selectedRef.current ?? "")]);
      if (hierarchyRef.current && selectedRef.current) {
        const current = selectedRef.current;
        const parent = current.split("/").slice(0, -1).join("/");
        if (cacheRef.current.get(parent)?.find((entry) => entry.path === current)?.kind === "dir") recoveryDirs.add(current);
      }
      for (const dir of recoveryDirs) {
        if (dir !== "" && !childrenCache.has(dir)) {
          loadChildren(dir).catch(() => {}); // 重拉失败静默：树数据未变，仅补齐展示
        }
      }
    } finally {
      if (epochGuard.isCurrent(epoch)) setRefreshing(false);
      // 兜底复位被作废的首搜在途 spinner（runSearch 的 finally 被 epoch
      // 检查拦下时无任何路径复位）；刷新期间有新搜索则由其自身管理（A2）
      if (searchSeq.current === searchSeqAtStart) setSearchLoading(false);
    }
  }, [
    refreshing,
    expanded,
    selected,
    searchResult,
    childrenCache,
    epochGuard,
    generationGate,
    runSearch,
    loadDetail,
    loadChildren,
    recoverMissing,
  ]);

  const visibleRows = useMemo(
    () => flattenVisibleRows(childrenCache, expanded),
    [childrenCache, expanded],
  );
  const selectedIndex = useMemo(
    () => (selected !== null ? rowIndexByPath(visibleRows, selected) : null),
    [visibleRows, selected],
  );

  const rootChildren = childrenCache.get("");

  /** 补齐树的祖先展开意图，不改变选中、历史或搜索内容。 */
  const revealSelection = useCallback(() => {
    if (!selected) return;
    setExpanded((current) => new Set([...current, ...ancestors(selected)]));
    for (const dir of ancestors(selected)) {
      if (!childrenCache.has(dir)) void loadChildren(dir).catch(() => {});
    }
  }, [selected, childrenCache, loadChildren]);

  useEffect(() => { revealSelection(); }, [revealSelection]);

  const back = useCallback(() => { navigationSeq.current += 1; setLeftView("tree"); setHistory((h) => goBack(h)); }, []);
  const forward = useCallback(() => { navigationSeq.current += 1; setLeftView("tree"); setHistory((h) => goForward(h)); }, []);
  const showTree = useCallback(() => setLeftView("tree"), []);
  const showSearch = useCallback(() => { navigationSeq.current += 1; if (searchResult) setLeftView("search"); }, [searchResult]);
  const dismissError = useCallback(() => setError(null), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    rootInfo, childrenCache, childrenState, expanded, selected, detail, detailLoading,
    error, notice, leftView, searchResult, searchLoading, refreshing,
    visibleRows, selectedIndex, rootChildren,
    canGoBack: canGoBack(history), canGoForward: canGoForward(history),
    back, forward, showTree, showSearch, dismissError, dismissNotice,
    onRowClick, onToggle, navigateTo, onTreeKeyDown, onSearch,
    onPageChange, onHitClick, doRefresh,
    ensureChildren: loadChildren, revealSelection,
  };
}

/** 祖先目录链（严格前缀，不含自身）。 */
function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const chain: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    chain.push(parts.slice(0, i).join("/"));
  }
  return chain;
}
