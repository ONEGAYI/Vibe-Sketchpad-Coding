/** 本地矢量图标；与抽屉图标共用浅灰绿描边。 */
export function EntryIcon({ kind }: { kind: "file" | "dir" }) {
  return (
    <svg className={`icon entry-icon ${kind}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "dir" ? <path d="M3 7V5h6l2 2h10v13H3Z" /> : <>
        <path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h4M9 12h6M9 16h6" />
      </>}
    </svg>
  );
}
