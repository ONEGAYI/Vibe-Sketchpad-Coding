import { WidgetType } from '@codemirror/view';
import { renderMath, finishRenderMath } from 'obsidian';

/**
 * MathWidget - 将 LaTeX 公式渲染为 CodeMirror Widget
 *
 * 使用 Obsidian 内置的 renderMath API 进行 MathJax 渲染
 */
export class MathWidget extends WidgetType {
  constructor(
    private mathContent: string,  // 公式内容（不含 $ 符号）
    private isBlock: boolean      // true = $$...$$, false = $...$
  ) {
    super();
  }

  /**
   * 创建 Widget 的 DOM 元素
   */
  toDOM(): HTMLElement {
    const container = document.createElement('span');
    // 使用 Obsidian 原生公式样式类名
    container.className = this.isBlock
      ? 'math math-block'
      : 'math math-inline';

    try {
      const mathEl = renderMath(this.mathContent, this.isBlock);
      container.appendChild(mathEl);
      // finishRenderMath 是异步的，但不阻塞 DOM 返回
      // MathJax 会在后台完成最终样式刷新
      finishRenderMath();
    } catch (e) {
      // 渲染失败：显示原始公式 + 错误标记
      console.error('MathWidget render error:', e);
      container.textContent = this.isBlock
        ? `$$${this.mathContent}$$`
        : `$${this.mathContent}$`;
      container.style.border = '1px dashed var(--text-error)';
    }

    return container;
  }

  /**
   * 判断两个 Widget 是否相等（用于复用 DOM）
   */
  eq(other: MathWidget): boolean {
    // 类型检查
    if (!(other instanceof MathWidget)) return false;
    // 内容和类型都相同时复用
    return this.mathContent === other.mathContent
        && this.isBlock === other.isBlock;
  }

  /**
   * 更新 Widget（可选，当前实现不需要）
   */
  updateDOM(_dom: HTMLElement): boolean {
    // 返回 false 表示需要重新创建 DOM
    return false;
  }

  /**
   * 销毁时的清理（当前无需清理）
   */
  destroy(): void {
    // 如未来添加事件监听器，需在此清理
  }
}
