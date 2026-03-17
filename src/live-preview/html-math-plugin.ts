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
     * 触发条件：文档变化 或 视口变化
     */
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    /**
     * 构建装饰器集合
     *
     * 只处理可见区域内的 HTML 公式
     */
    buildDecorations(view: EditorView): DecorationSet {
      const builder: Range<Decoration>[] = [];

      // 只处理可见区域（性能优化）
      for (const { from, to } of view.visibleRanges) {
        // 找到可见区域内的 HTML 区域
        const regions = findHtmlRegionsInRange(view, from, to);

        for (const region of regions) {
          // 获取 HTML 区域内的文本
          const text = view.state.doc.sliceString(region.from, region.to);

          // 在区域内匹配公式
          const matches = findMathInHtmlRegion(text, region.from);

          for (const match of matches) {
            // 创建 Widget
            const widget = new MathWidget(match.content, match.isBlock);

            // 创建替换装饰器
            // inclusive: false 使得光标进入时装饰器自动隐藏
            const deco = Decoration.replace({
              widget,
              inclusive: false
            });

            // 添加到构建器
            builder.push(deco.range(match.from, match.to));
          }
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
