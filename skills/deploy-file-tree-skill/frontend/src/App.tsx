import { useEffect, useState } from "react";
import { useTreeBrowser } from "./useTreeBrowser";
import { VirtualTree } from "./components/VirtualTree";
import { DetailPanel } from "./components/DetailPanel";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { Breadcrumb } from "./components/Breadcrumb";
import { HelpPanel } from "./components/HelpPanel";
import "./index.css";

const ROOT_PLACEHOLDER = "文件树查看器";

/** 页面装配与帮助交互；浏览状态统一由控制层持有。 */
export default function App() {
  const {
    rootInfo, expanded, selected, detail, detailLoading,
    error, notice, leftView, searchResult, searchLoading, refreshing,
    visibleRows, selectedIndex, rootChildren, canGoBack, canGoForward,
    back, forward, showTree, dismissError, dismissNotice,
    onRowClick, onToggle, navigateTo, onTreeKeyDown, onSearch,
    onPageChange, onHitClick, doRefresh,
  } = useTreeBrowser();
  const [helpOpen, setHelpOpen] = useState(false);

  // 全局快捷键：Alt+←/→ 历史导航、? 帮助、Esc 关帮助（输入控件内不劫持）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (inField || e.ctrlKey || e.metaKey) return;
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        forward();
      } else if (e.key === "?" && !e.altKey) {
        e.preventDefault();
        setHelpOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward]);

  return (
    <div className="app">
      <header className="topbar">
        <span className="title">{rootInfo ? rootInfo.root : ROOT_PLACEHOLDER}</span>
        {rootInfo && (
          <span className="muted">
            {rootInfo.counts.total} 条目（{rootInfo.counts.dirs} 目录 / {rootInfo.counts.files}{" "}
            文件）· 只读
          </span>
        )}
        <span className="toolbar">
          <button
            type="button"
            className="tool-button"
            disabled={!canGoBack}
            onClick={back}
            title="后退（Alt+←）"
          >
            ← 后退
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={!canGoForward}
            onClick={forward}
            title="前进（Alt+→）"
          >
            前进 →
          </button>
          <button
            type="button"
            className="tool-button"
            disabled={refreshing}
            onClick={doRefresh}
            title="重读同一路径 tree.json（无需重启或重新构建）"
          >
            {refreshing ? "刷新中…" : "刷新"}
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={() => setHelpOpen((open) => !open)}
            title="快捷键说明"
          >
            ? 快捷键
          </button>
        </span>
      </header>

      <Breadcrumb rootName={rootInfo ? rootInfo.root : ROOT_PLACEHOLDER} selected={selected} onNavigate={navigateTo} />

      <SearchBar
        tagVocab={rootInfo?.tags ?? {}}
        onSearch={onSearch}
        loading={searchLoading}
      />

      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          <button type="button" onClick={dismissError} aria-label="关闭错误提示">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="notice-bar" role="status">
          <span>{notice}</span>
          <button type="button" onClick={dismissNotice} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      <main className="columns">
        <nav className="panel tree" aria-label="目录树">
          {leftView === "search" && searchResult !== null ? (
            <SearchResults
              resp={searchResult}
              onPageChange={onPageChange}
              onHitClick={onHitClick}
              onBackToTree={showTree}
              loading={searchLoading}
            />
          ) : rootChildren === undefined ? (
            <p className="muted loading">加载中…</p>
          ) : rootChildren.length === 0 ? (
            <p className="muted loading">（空树：快照没有任何条目）</p>
          ) : (
            <VirtualTree
              rows={visibleRows}
              expanded={expanded}
              selected={selected}
              selectedIndex={selectedIndex}
              onRowClick={onRowClick}
              onToggle={onToggle}
              onKeyDown={onTreeKeyDown}
            />
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

      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
