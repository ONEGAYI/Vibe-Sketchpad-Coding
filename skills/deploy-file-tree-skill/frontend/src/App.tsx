import { useEffect, useState } from "react";
import { useTreeBrowser } from "./useTreeBrowser";
import { VirtualTree } from "./components/VirtualTree";
import { DetailPanel } from "./components/DetailPanel";
import { SearchBar } from "./components/SearchBar";
import { SearchResults } from "./components/SearchResults";
import { Breadcrumb } from "./components/Breadcrumb";
import { HelpPanel } from "./components/HelpPanel";
import { SplitLayout } from "./components/SplitLayout";
import { ColumnBrowser } from "./components/ColumnBrowser";
import drawerOpen from "./assets/drawer-open.svg";
import drawerClosed from "./assets/drawer-closed.svg";
import "./index.css";

const ROOT_PLACEHOLDER = "文件树查看器";

/** 页面装配与帮助交互；浏览状态统一由控制层持有。 */
export default function App() {
  const {
    rootInfo, childrenCache, childrenState, expanded, selected, detail, detailLoading,
    error, notice, leftView, searchResult, searchLoading, refreshing,
    visibleRows, selectedIndex, rootChildren, canGoBack, canGoForward,
    back, forward, showTree, dismissError, dismissNotice,
    onRowClick, onToggle, navigateTo, onTreeKeyDown, onSearch,
    onPageChange, onHitClick, doRefresh, ensureChildren, revealSelection,
  } = useTreeBrowser();
  const [helpOpen, setHelpOpen] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const collapseHierarchy = () => { revealSelection(); setHierarchyOpen(false); };

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
        <SearchBar tagVocab={rootInfo?.tags ?? {}} onSearch={onSearch} loading={searchLoading}
          appliedFilters={searchResult?.query} />
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

      <SplitLayout expanded={hierarchyOpen}>
        <nav className="panel tree" aria-label="目录树">
          <div className="nav-heading"><span>文件导航</span>
            <button type="button" className="drawer-switch" aria-pressed={hierarchyOpen}
              title={hierarchyOpen ? "收起层级浏览，恢复普通侧栏宽度" : "展开抽屉，以多列层级浏览目录"}
              onClick={() => { if (hierarchyOpen) collapseHierarchy(); else setHierarchyOpen(true); }}>
              <img src={hierarchyOpen ? drawerOpen : drawerClosed} alt="" />
              {hierarchyOpen ? "收起层级" : "层级浏览"}
            </button>
          </div>
          {leftView === "search" && searchResult !== null ? (
            <SearchResults
              resp={searchResult}
              onPageChange={onPageChange}
              onHitClick={onHitClick}
              onBackToTree={showTree}
              loading={searchLoading}
            />
          ) : hierarchyOpen ? (
            <ColumnBrowser selected={selected} detail={detail} cache={childrenCache} states={childrenState}
              ensureChildren={ensureChildren} onSelect={onRowClick} />
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
          condensed={hierarchyOpen}
          onReadFull={collapseHierarchy}
          rootInfo={rootInfo}
          detail={detail}
          selected={selected}
          loading={detailLoading}
          onNavigate={navigateTo}
        />
      </SplitLayout>

      <footer className="snapshot-status">
        <span>{rootInfo ? `${rootInfo.counts.total} 条目 · ${rootInfo.counts.dirs} 目录 · ${rootInfo.counts.files} 文件` : "正在读取快照"}</span>
        <span>选择条目阅读职责与关联</span>
      </footer>
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
