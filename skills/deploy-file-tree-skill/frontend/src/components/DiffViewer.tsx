import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DiffChange, DiffResponse, DiffScope, DiffStatus } from "../types";

interface DiffViewerProps {
  oldSource: string;
  newSource: string;
  generation: number;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  error?: string | null;
}

const statusLabel: Record<DiffStatus, string> = {
  added: "新增", removed: "删除", modified: "修改",
};
const scopeLabel: Record<DiffScope, string> = {
  entry: "条目", root: "根名", tag: "标签", view: "视图",
};

function changeKey(change: DiffChange): string {
  return `${change.scope}:${change.path ?? change.key ?? ""}`;
}

function valueText(value: unknown): string {
  return value === null ? "（不存在）" : JSON.stringify(value, null, 2);
}

/** 两份快照的只读分页变化列表；过滤、页码与详情保持同一比较世代。 */
export function DiffViewer({ oldSource, newSource, generation, refreshing, onRefresh, error }: DiffViewerProps) {
  const [status, setStatus] = useState<DiffStatus | "">("");
  const [scope, setScope] = useState<DiffScope | "">("");
  const [underDraft, setUnderDraft] = useState("");
  const [under, setUnder] = useState("");
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<DiffResponse | null>(null);
  const [selected, setSelected] = useState<DiffChange | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [generation]);

  useEffect(() => {
    if (selected && window.matchMedia?.("(max-width: 760px)").matches) {
      detailRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }, [selected]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setResponse(null);
    api.diff({ status: status || undefined, scope: scope || undefined, under: under || undefined }, page)
      .then((value) => {
        if (!active) return;
        if (value.generation !== generation) {
          setLoadError("比较结果来自旧快照，请刷新后重试");
          return;
        }
        setResponse(value);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [generation, status, scope, under, page]);

  const changeFilter = (nextStatus: DiffStatus | "", nextScope: DiffScope | "", nextUnder: string) => {
    setStatus(nextStatus);
    setScope(nextScope);
    setUnder(nextUnder.trim());
    setPage(1);
    setSelected(null);
  };

  return (
    <div className="app diff-app">
      <header className="topbar">
        <span className="title">文件树差异</span>
        <span className="toolbar">
          <button type="button" className="tool-button" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "刷新中…" : "刷新两份快照"}
          </button>
        </span>
      </header>
      <p className="diff-sources"><span>旧：{oldSource}</span><span>新：{newSource}</span></p>
      {error && <div className="error-bar" role="alert">{error}</div>}
      {loadError && <div className="error-bar" role="alert">{loadError}</div>}
      <div className="diff-layout">
        <section className="diff-list" aria-label="变化列表">
          <form className="diff-filters" onSubmit={(event) => {
            event.preventDefault();
            changeFilter(status, scope, underDraft);
          }}>
            <label>类型
              <select aria-label="变化类型" value={status} onChange={(event) =>
                changeFilter(event.target.value as DiffStatus | "", scope, under)}>
                <option value="">全部</option>
                <option value="added">新增</option>
                <option value="removed">删除</option>
                <option value="modified">修改</option>
              </select>
            </label>
            <label>类别
              <select aria-label="变化类别" value={scope} onChange={(event) =>
                changeFilter(status, event.target.value as DiffScope | "", under)}>
                <option value="">全部</option>
                <option value="entry">条目</option>
                <option value="root">根名</option>
                <option value="tag">标签</option>
                <option value="view">视图</option>
              </select>
            </label>
            <label>路径子树
              <input aria-label="路径子树" value={underDraft}
                onChange={(event) => setUnderDraft(event.target.value)} placeholder="如 src" />
            </label>
            <button type="submit" className="search-button">筛选</button>
          </form>
          <p className="diff-summary">
            {response ? response.total_pages > 0
              ? `共 ${response.total} 条变化 · 第 ${response.page} / ${response.total_pages} 页`
              : `共 ${response.total} 条变化` : "正在比较…"}
          </p>
          {loading && <p className="muted">正在加载本页…</p>}
          {!loading && response?.total === 0 && <p className="muted">没有匹配的变化。</p>}
          <div className="diff-rows">
            {!loading && response?.results.map((change) => (
              <button key={changeKey(change)} type="button"
                className="diff-change" data-selected={selected !== null && changeKey(selected) === changeKey(change)}
                onClick={() => setSelected(change)}>
                <span className={`diff-status ${change.status}`}>{statusLabel[change.status]}</span>
                <span className="diff-path">{change.path ?? change.key}</span>
                <span className="muted">{scopeLabel[change.scope]}</span>
              </button>
            ))}
          </div>
          {response && response.total_pages > 1 && (
            <nav className="pager" aria-label="变化分页">
              <button type="button" className="search-button secondary" disabled={loading || page <= 1}
                onClick={() => { setSelected(null); setPage(page - 1); }}>上一页</button>
              <span>{page} / {response.total_pages}</span>
              <button type="button" className="search-button secondary"
                disabled={loading || page >= response.total_pages}
                onClick={() => { setSelected(null); setPage(page + 1); }}>下一页</button>
            </nav>
          )}
        </section>
        <section ref={detailRef} className="diff-detail" aria-label="变化详情">
          {selected ? (
            <>
              <h2>{selected.path ?? selected.key} · {statusLabel[selected.status]}</h2>
              <div className="diff-values">
                <div><h3>旧值</h3><pre>{valueText(selected.before)}</pre></div>
                <div><h3>新值</h3><pre>{valueText(selected.after)}</pre></div>
              </div>
            </>
          ) : <p className="muted">选择一条变化，查看字段前后值。</p>}
        </section>
      </div>
    </div>
  );
}
