/**
 * 快捷键帮助面板（G10）：按 ? 开关。帮助内容即快捷键文档化。
 */

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<[string, string]> = [
  ["↑ / ↓", "在可见行中上移 / 下移选择"],
  ["→", "展开折叠的目录；对已展开目录进入第一个子项"],
  ["←", "折叠已展开目录；对折叠目录或文件跳到父目录"],
  ["Home / End", "跳到可见行首 / 行末"],
  ["Alt + ← / Alt + →", "浏览历史后退 / 前进"],
  ["层级列 ↑ / ↓ / Home / End", "在当前列选择条目"],
  ["层级列 → / Enter / ←", "进入所选目录子列 / 返回父列，并转移焦点"],
  ["分隔条 ← / →", "普通侧栏每次缩小 / 加宽 10px；层级模式不调宽"],
  ["?", "开 / 关本帮助面板"],
];

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  if (!open) return null;
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-panel"
        role="dialog"
        aria-label="快捷键说明"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h3>快捷键</h3>
          <button type="button" className="link-button" onClick={onClose} aria-label="关闭帮助">
            ×
          </button>
        </header>
        <table className="help-table">
          <tbody>
            {SHORTCUTS.map(([key, desc]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted hint">
          面包屑根节点返回概览；"复制路径"复制快照相对路径，根概览不可复制。
          抽屉按钮切换层级浏览，收起后恢复普通宽度。输入区保留自己的键盘操作。
        </p>
      </div>
    </div>
  );
}
