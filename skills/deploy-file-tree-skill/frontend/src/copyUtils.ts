/**
 * 复制文本到剪贴板（G10"复制完整路径"）：优先异步 Clipboard API，
 * 不可用或失败（非安全上下文、权限拒绝）时回退隐藏 textarea + execCommand。
 * 返回是否成功——调用方据此提示，绝不抛错打断浏览。
 */

export async function copyText(text: string): Promise<boolean> {
  const clipboard = (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 落入回退方案
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
