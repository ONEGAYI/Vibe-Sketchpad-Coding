import {
  ViewPlugin,
  Decoration,
  DecorationSet,
  EditorView,
  ViewUpdate
} from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { findHtmlRegionsInRange, findMathInHtmlRegion } from './html-region-finder';
import { MathWidget } from './math-widget';

/**
 * HTML 数学公式实时预览插件
 *
 * 使用 ViewPlugin 监听文档变化，在 HTML 区域内识别并渲染公式
 */
export const htmlMathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    /**
     * 更新装饰器
     *
     * 触发条件：文档变化、视口变化、或光标位置变化
     */
    update(update: ViewUpdate) {
      // 监听三种变化：文档修改、视口滚动、光标移动
      if (update.docChanged || update.viewportChanged || update.transactions.some(tr => tr.selection)) {
        console.log('[HtmlMathPlugin] update 触发, docChanged:%s, viewportChanged:%s, selectionChanged:%s',
                    update.docChanged, update.viewportChanged, update.transactions.some(tr => tr.selection));

        const oldDecoCount = this.decorations.size;
        this.decorations = this.buildDecorations(update.view);

        // 关键日志：观察装饰器数量的变化
        if (oldDecoCount !== this.decorations.size) {
          console.log(`[HtmlMathPlugin] 装饰器数量变化: ${oldDecoCount} -> ${this.decorations.size}`);
        }
      }
    }

    /**
     * 构建装饰器集合
     *
     * 只处理可见区域内的 HTML 公式
     * 光标在公式所在行时不创建装饰器（显示源码便于编辑）
     */
    buildDecorations(view: EditorView): DecorationSet {
      const builder: Range<Decoration>[] = [];
      const doc = view.state.doc;

      // 获取当前光标所在的行号
      const cursorLine = doc.lineAt(view.state.selection.main.head);

      // 获取完整的可见范围（合并所有 visibleRanges）
      const minFrom = Math.min(...view.visibleRanges.map(r => r.from));
      const maxTo = Math.max(...view.visibleRanges.map(r => r.to));

      // 找到可见区域内的 HTML 区域
      const regions = findHtmlRegionsInRange(view, minFrom, maxTo);

      for (const region of regions) {
        // 获取 HTML 区域所在的行范围
        const regionStartLine = doc.lineAt(region.from);
        const regionEndLine = doc.lineAt(region.to);

        // 检查光标是否在 HTML 区域覆盖的任何行上
        const cursorInRegionLines = cursorLine.number >= regionStartLine.number &&
                                     cursorLine.number <= regionEndLine.number;

        // 如果光标在 HTML 区域所在的行上，跳过（显示源码便于编辑）
        if (cursorInRegionLines) {
          console.log('[HtmlMathPlugin] 跳过区域 (光标在第 %d 行，区域在第 %d-%d 行)',
                      cursorLine.number, regionStartLine.number, regionEndLine.number);
          continue;
        }

        // 获取 HTML 区域内的文本
        const text = doc.sliceString(region.from, region.to);

        // 在区域内匹配公式
        const matches = findMathInHtmlRegion(text, region.from);

        for (const match of matches) {
          console.log('[HtmlMathPlugin] 渲染公式: $%s$ (位置 %d-%d)', match.content, match.from, match.to);
          // 创建 Widget
          const widget = new MathWidget(match.content, match.isBlock);

          // 创建替换装饰器
          const deco = Decoration.replace({
            widget,
            inclusive: false
          });

          // 添加到构建器
          builder.push(deco.range(match.from, match.to));
        }
      }

      // 返回排序后的装饰器集合
      return Decoration.set(builder, true);
    }

    /**
     * 销毁时的清理
     */
    destroy() {
      // CodeMirror 自动管理 DecorationSet 生命周期
      // 当前实现无需额外清理
    }
  },
  {
    decorations: v => v.decorations
  }
);
