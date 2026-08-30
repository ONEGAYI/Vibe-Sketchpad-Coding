import { WidgetType } from '@codemirror/view';
import { renderMath, finishRenderMath } from 'obsidian';

/**
 * MathWidget - 将 LaTeX 公式渲染为 CodeMirror Widget
 *
 * 使用 Obsidian 内置的 renderMath API 进行 MathJax 渲染
 *
 * 关键点：finishRenderMath() 必须在 DOM 挂载后调用，
 * 因为 MathJax 拒绝处理未挂载到文档树的节点。
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
   *
   * 注意：renderMath 返回初始 HTML 结构，
   * 但 MathJax 完整排版需要 finishRenderMath() 在 DOM 挂载后触发
   */
  toDOM(): HTMLElement {
    console.log('[MathWidget] toDOM: $%s$', this.mathContent);

    // 修复：使用中立的包裹层，绝对不要使用 'math' 类名
    // 否则 MathJax 会把外层 container 也当作公式入口进行二次解析
    const container = document.createElement('span');
    container.className = 'html-math-widget-wrapper';
    // 使用 display: contents 让容器在排版上"消失"，完全依赖内部 mathEl 的原生样式
    container.style.display = 'contents';

    try {
      // renderMath 生成的节点已经自带了正确的 Obsidian 官方 CSS 类名
      const mathEl = renderMath(this.mathContent, this.isBlock);
      container.appendChild(mathEl);

      // 异步触发排版：使用 requestAnimationFrame 确保在浏览器下次重绘时执行
      // 此时 DOM 已稳定挂载
      requestAnimationFrame(() => {
        // 双重保险：检查节点是否仍在文档中
        if (container.isConnected) {
          finishRenderMath();
          console.log('[MathWidget] finishRenderMath 已在挂载后触发');
        }
      });

    } catch (e) {
      console.error('[MathWidget] 渲染失败:', e);
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

  /**
   * 告知 CodeMirror 忽略此 Widget 内部的一切 DOM 事件
   * 这能有效防止 MathJax 异步渲染导致的 DOM 突变干扰到编辑器的状态
   */
  ignoreEvent(_event: Event): boolean {
    return true;
  }
}
