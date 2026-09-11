import type { EntryDetail, RootInfo } from "../types";
import { gitIgnoreLabel } from "../format";

interface DetailPanelProps {
  rootInfo: RootInfo | null;
  detail: EntryDetail | null;
  selected: string | null;
  loading: boolean;
}

/** 右栏：未选择时显示快照概览；选择后显示条目详情（路径/desc/detail/tags/标志）。 */
export function DetailPanel({ rootInfo, detail, selected, loading }: DetailPanelProps) {
  if (selected === null) {
    return (
      <section className="panel detail" aria-label="详情">
        <h2>{rootInfo ? rootInfo.root : "文件树查看器"}</h2>
        {rootInfo && (
          <p className="muted">
            {rootInfo.counts.total} 条目（{rootInfo.counts.dirs} 目录 / {rootInfo.counts.files}{" "}
            文件）· 只读快照
          </p>
        )}
        {rootInfo && Object.keys(rootInfo.tags).length > 0 && (
          <section className="detail-section">
            <h3>标签词表</h3>
            <ul className="vocab">
              {Object.entries(rootInfo.tags).map(([name, desc]) => (
                <li key={name}>
                  <code>{name}</code>
                  <span> — {desc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="muted hint">在左侧选择条目查看详情；目录点箭头展开 / 折叠。</p>
        <p className="muted hint">
          hidden 条目与 collapsed 目录均可在界面展开查看，浏览不会改动快照数据。
        </p>
      </section>
    );
  }

  if (loading || detail === null || detail.path !== selected) {
    return (
      <section className="panel detail" aria-label="详情">
        <p className="muted">加载中…</p>
      </section>
    );
  }

  const tagDict = rootInfo?.tags ?? {};
  return (
    <section className="panel detail" aria-label="详情">
      <header className="detail-header">
        <h2>
          <span className={`icon ${detail.kind}`} aria-hidden="true">
            {detail.kind === "dir" ? "📁" : "📄"}
          </span>
          {detail.name}
        </h2>
        <p className="path">
          <code>{detail.path}</code>
        </p>
      </header>

      <dl className="fields">
        <div className="field">
          <dt>类型</dt>
          <dd>
            {detail.kind === "dir"
              ? `目录（${detail.child_count ?? 0} 个子项）`
              : "文件"}
          </dd>
        </div>
        <div className="field">
          <dt>简介</dt>
          <dd>{detail.desc || "（待补）"}</dd>
        </div>
      </dl>

      {detail.detail.length > 0 && (
        <section className="detail-section">
          <h3>完整描述</h3>
          {detail.detail.map((line, i) => (
            <p key={i} className="detail-line">
              {line}
            </p>
          ))}
        </section>
      )}

      {detail.rel.length > 0 && (
        <section className="detail-section">
          <h3>关联（rel）</h3>
          <ul className="rel-list">
            {detail.rel.map((ref) => (
              <li key={ref.path} className={ref.exists ? "" : "dangling"}>
                <code>{ref.path}</code>
                {!ref.exists && (
                  <span className="badge badge-dangling">悬空：目标不在快照中</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.tags.length > 0 && (
        <section className="detail-section">
          <h3>标签</h3>
          <ul className="chips">
            {detail.tags.map((tag) => (
              <li key={tag} className="chip" title={tagDict[tag] ?? ""}>
                {tag}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-section">
        <h3>标志</h3>
        <ul className="flags">
          <li>
            <span className="flag-name">hidden</span>
            <code>{String(detail.hidden)}</code>
            {detail.hidden && <span className="muted">（界面仍可见，浏览不改动数据）</span>}
          </li>
          <li>
            <span className="flag-name">collapsed</span>
            <code>{String(detail.collapsed)}</code>
            {detail.collapsed && <span className="muted">（仅初始折叠，可在界面展开）</span>}
          </li>
          <li>
            <span className="flag-name">git-ignore</span>
            <code>
              {gitIgnoreLabel(detail.git_ignore.explicit, detail.git_ignore.effective)}
            </code>
          </li>
        </ul>
      </section>
    </section>
  );
}
