/**
 * 面包屑 + 复制路径（G10）：当前选中路径逐级可点跳转（根与各级目录），
 * 末级为当前条目（纯展示）；"复制路径"把完整路径写入剪贴板并瞬时反馈。
 */

import { useEffect, useRef, useState } from "react";
import { copyText } from "../copyUtils";

interface BreadcrumbProps {
  rootName: string;
  selected: string | null;
  onNavigate: (path: string) => void;
}

export function Breadcrumb({ rootName, selected, onNavigate }: BreadcrumbProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number>();

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  const parts = (selected ?? "").split("/").filter(Boolean);

  const onCopy = async () => {
    if (!selected) return;
    const ok = await copyText(selected);
    setCopied(ok);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <nav className="breadcrumb" aria-label="路径导航">
      <button type="button" className="crumb" onClick={() => onNavigate("")} title={rootName}>
        {rootName}
      </button>
      {parts.map((part, i) => {
        const prefix = parts.slice(0, i + 1).join("/");
        const isLast = i === parts.length - 1;
        return (
          <span key={prefix} className="crumb-segment">
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            {isLast ? (
              <span className="crumb current" title={prefix}>
                {part}
              </span>
            ) : (
              <button type="button" className="crumb" onClick={() => onNavigate(prefix)} title={prefix}>
                {part}
              </button>
            )}
          </span>
        );
      })}
      <button
        type="button"
        className="copy-button"
        disabled={!selected}
        onClick={onCopy}
        title={selected ? `复制完整路径：${selected}` : "复制完整路径"}
      >
        {copied ? "已复制" : "复制路径"}
      </button>
    </nav>
  );
}
