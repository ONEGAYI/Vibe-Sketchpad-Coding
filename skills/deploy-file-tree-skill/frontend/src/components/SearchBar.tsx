import { useState } from "react";
import type { SearchFormParams } from "../searchUtils";

interface SearchBarProps {
  tagVocab: Record<string, string>;
  onSearch: (params: SearchFormParams) => void;
  loading: boolean;
}

/**
 * 顶部搜索区（G05/G08）：关键词、标签、子树三项可任意组合；
 * 回车或点击按钮触发。输入为瞬时本地态，提交时才发起查询。
 */
export function SearchBar({ tagVocab, onSearch, loading }: SearchBarProps) {
  const [params, setParams] = useState<SearchFormParams>({ kw: "", tag: "", under: "" });
  const set = (key: keyof SearchFormParams) => (value: string) =>
    setParams((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="searchbar"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(params);
      }}
    >
      <input
        type="search"
        className="search-input"
        placeholder="关键词：路径 / 简介 / 完整描述"
        aria-label="关键词"
        value={params.kw}
        onChange={(e) => set("kw")(e.target.value)}
      />
      <select
        className="search-select"
        aria-label="标签筛选"
        value={params.tag}
        onChange={(e) => set("tag")(e.target.value)}
      >
        <option value="">标签：全部</option>
        {Object.keys(tagVocab).map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <input
        type="search"
        className="search-input under"
        placeholder="子树：目录路径（如 src）"
        aria-label="子树筛选"
        value={params.under}
        onChange={(e) => set("under")(e.target.value)}
      />
      <button type="submit" className="search-button" disabled={loading}>
        {loading ? "搜索中…" : "搜索"}
      </button>
      <button
        type="button"
        className="search-button secondary"
        onClick={() => {
          setParams({ kw: "", tag: "", under: "" });
          onSearch({ kw: "", tag: "", under: "" });
        }}
      >
        重置
      </button>
    </form>
  );
}
