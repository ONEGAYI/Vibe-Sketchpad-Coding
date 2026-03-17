# Obsidian HTML Tag LaTeX Fix - 实时预览模式设计规格

## 概述

为 Obsidian HTML LaTeX 修复插件添加实时预览（Live Preview）模式支持，使 HTML 标签内的 LaTeX 公式能够像 Obsidian 原生公式一样渲染。

## 目标

- 在实时预览模式下渲染 HTML 标签内的公式
- 行为与 Obsidian 原生公式一致：光标在行时显示源码，离开时渲染公式
- 支持行内公式 `$...$` 和块级公式 `$$...$$`

## 非目标

- HTML 实体转义处理（`&lt;` → `<`）
- 自定义标签配置（留作未来扩展）
- 语法错误提示

## 支持的标签（初版）

**块级标签：**
- `<div>`
- `<details>`
- `<summary>`

**行内标签：**
- `<span>`
- `<mark>`
- `<code>` — **暂不支持**，与阅读模式行为一致（代码块内不渲染公式）

## 架构设计

### 模块结构

```
src/live-preview/
├── index.ts              # 模块入口，导出插件扩展
├── html-math-plugin.ts   # ViewPlugin 核心实现
├── html-region-finder.ts # HTML 区域识别（语法树）+ 公式匹配
└── math-widget.ts        # WidgetType 实现
```

### 数据流

```
文档变化 → ViewPlugin.update()
    ↓
findHtmlRegionsInRange() 识别 HTML 区域（语法树）
    ↓
findMathInHtmlRegion() 在区域内匹配公式
    ↓
为每个匹配创建 MathWidget
    ↓
生成 Decoration.replace({ widget, inclusive: false })
    ↓
光标在附近时装饰器自动隐藏（显示源码）
```

## 模块详细设计

### 1. html-region-finder.ts

**职责：** 从 CodeMirror 语法树中识别 HTML 区域，并在区域内匹配公式

```typescript
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { findMathMatches, MathMatch } from '../utils';

/**
 * HTML 区域
 */
export interface HtmlRegion {
  from: number;  // 起始位置（文档绝对位置）
  to: number;    // 结束位置（文档绝对位置）
}

/**
 * HTML 区域内的公式匹配
 */
export interface MathInRegionMatch {
  from: number;       // 文档绝对位置
  to: number;         // 文档绝对位置
  content: string;    // 公式内容（不含 $ 符号）
  isBlock: boolean;   // true = $$...$$, false = $...$
}

/**
 * 识别文档中的 HTML 区域
 * 策略：语法树识别 HTML 节点 → 提取其内容范围
 */
export function findHtmlRegions(view: EditorView): HtmlRegion[];

/**
 * 在指定范围内识别 HTML 区域（性能优化）
 */
export function findHtmlRegionsInRange(
  view: EditorView,
  from: number,
  to: number
): HtmlRegion[];

/**
 * 在 HTML 区域内查找公式匹配
 * 将 utils.findMathMatches 的结果转换为文档绝对位置
 */
export function findMathInHtmlRegion(
  text: string,
  regionFrom: number
): MathInRegionMatch[] {
  const matches = findMathMatches(text);
  return matches.map(m => ({
    from: regionFrom + m.startIndex,
    to: regionFrom + m.endIndex,
    content: m.content,
    isBlock: m.type === 'block'
  }));
}
```

**实现要点：**
- 使用 `syntaxTree(view.state)` 遍历语法树
- 识别 `HTMLBlock` / `HTMLTag` 节点
- 提取标签内部内容的位置（不含标签本身）

### 2. math-widget.ts

**职责：** 封装 MathJax 渲染为 CodeMirror Widget

```typescript
import { WidgetType } from '@codemirror/view';
import { renderMath, finishRenderMath } from 'obsidian';

export class MathWidget extends WidgetType {
  constructor(
    private mathContent: string,  // 公式内容（不含 $ 符号）
    private isBlock: boolean      // true = $$...$$, false = $...$
  ) { super(); }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    // 使用 Obsidian 原生公式样式类名
    container.className = this.isBlock
      ? 'math math-block'
      : 'math math-inline';

    try {
      const mathEl = renderMath(this.mathContent, this.isBlock);
      container.appendChild(mathEl);
      // 注意：finishRenderMath 是异步的，但 WidgetType.toDOM 必须同步返回
      // 这里不等待完成，MathJax 会自动处理样式刷新
      finishRenderMath();
    } catch (e) {
      // 渲染失败：显示原始公式
      container.textContent = this.isBlock
        ? `$$${this.mathContent}$$`
        : `$${this.mathContent}$`;
      container.style.border = '1px dashed var(--text-error)';
    }

    return container;
  }

  eq(other: MathWidget): boolean {
    // 类型检查：确保 other 是 MathWidget
    if (!(other instanceof MathWidget)) return false;
    // 内容相同时复用 DOM，避免重渲染
    return this.mathContent === other.mathContent
        && this.isBlock === other.isBlock;
  }

  destroy(): void {
    // 清理资源（当前实现无需清理）
    // 如未来添加事件监听器或计时器，需在此清理
  }
}
```

### 3. html-math-plugin.ts

**职责：** ViewPlugin 核心，协调装饰器生成

```typescript
import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { ViewUpdate, Range } from '@codemirror/state';
import { findHtmlRegionsInRange, findMathInHtmlRegion } from './html-region-finder';
import { MathWidget } from './math-widget';

const htmlMathPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder: Range<Decoration>[] = [];

      // 只处理可见区域
      for (const { from, to } of view.visibleRanges) {
        const regions = findHtmlRegionsInRange(view, from, to);

        for (const region of regions) {
          const text = view.state.doc.sliceString(region.from, region.to);
          const matches = findMathInHtmlRegion(text, region.from);

          for (const match of matches) {
            const widget = new MathWidget(match.content, match.isBlock);
            const deco = Decoration.replace({
              widget,
              inclusive: false  // 关键：光标进入时隐藏
            });
            builder.push(deco.range(match.from, match.to));
          }
        }
      }

      return Decoration.set(builder, true);
    }

    destroy() {
      // CodeMirror 的 ViewPlugin 会自动管理 DecorationSet 的生命周期
      // 如有额外资源（如事件监听器、计时器）需在此清理
      // 当前实现无需额外清理
    }
  },
  { decorations: v => v.decorations }
);

export { htmlMathPlugin };
```

### 4. index.ts

**职责：** 模块导出

```typescript
import { htmlMathPlugin } from './html-math-plugin';

export const livePreviewExtensions = [
  htmlMathPlugin,
];

export { MathWidget } from './math-widget';
export { findHtmlRegions, findHtmlRegionsInRange, MathInRegionMatch } from './html-region-finder';
```

### 5. main.ts 集成

```typescript
import { livePreviewExtensions } from './live-preview';

export default class HtmlMathFixPlugin extends Plugin {
  async onload() {
    // ... 现有代码

    // 注册实时预览扩展
    this.registerEditorExtension(livePreviewExtensions);
  }
}
```

## 关键实现细节

### 光标交互 - inclusive: false

```typescript
Decoration.replace({
  widget: new MathWidget(content),
  inclusive: false,  // 光标在边界时装饰器不生效
})
```

| 场景 | 效果 |
|-----|------|
| 光标在 `$x$` 范围外 | Widget 显示，公式渲染 |
| 光标进入 `$x$` 范围 | Widget 自动隐藏，显示原始 `$x$` |
| 光标离开 `$x$` 范围 | Widget 重新显示 |

> **⚠️ 需要验证**: `inclusive: false` 的具体光标交互行为需要实际测试验证。
>
> **备选方案**: 如果 `inclusive: false` 不能实现预期效果，可以在 `buildDecorations` 中检测光标位置：
> ```typescript
> const cursorPos = view.state.selection.main.head;
> // 跳过光标所在的公式匹配
> if (cursorPos >= match.from && cursorPos <= match.to) continue;
> ```

### 版本要求

- **Obsidian**: 1.0.0+（支持 CodeMirror 6）
- **依赖**: `@codemirror/view`, `@codemirror/state`, `@codemirror/language`（Obsidian 内置，无需单独安装）

### 依赖说明

```typescript
// 从 CodeMirror 包导入（Obsidian 内置）
import { ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';
import type { ViewUpdate, Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

// 从 Obsidian API 导入
import { renderMath, finishRenderMath } from 'obsidian';
```

### 公式匹配

复用 `src/utils.ts` 中的 `findMathMatches` 函数：

```typescript
// utils.ts 中已定义
export interface MathMatch {
  type: 'block' | 'inline';
  content: string;
  startIndex: number;
  endIndex: number;
}

export function findMathMatches(text: string): MathMatch[];
```

转换逻辑（在 `html-region-finder.ts` 中）：

```typescript
export function findMathInHtmlRegion(
  text: string,
  regionFrom: number
): MathInRegionMatch[] {
  const matches = findMathMatches(text);
  return matches.map(m => ({
    from: regionFrom + m.startIndex,
    to: regionFrom + m.endIndex,
    content: m.content,
    isBlock: m.type === 'block'  // type → isBlock 转换
  }));
}
```

## 性能优化

| 策略 | 实现方式 |
|-----|---------|
| 视口限制 | 只处理 `view.visibleRanges` 内的内容 |
| Widget 复用 | `MathWidget.eq()` 正确比较，避免重复渲染 |
| 装饰器排序 | `Decoration.set(builder, true)` 跳过排序 |
| 复用正则 | 使用 `../utils.ts` 中已定义的 `findMathMatches` |

## 错误处理

- MathJax 渲染失败时显示原始公式，以红色虚线边框标记
- 不影响编辑器稳定性

## 边缘情况

| 情况 | 处理方式 |
|------|---------|
| `\$` 转义 | 正则使用 negative lookbehind 跳过 |
| 嵌套公式 | 块级公式优先匹配，避免冲突 |
| 空公式 `$ $` | 正则要求至少一个非空字符 |
| 公式跨 HTML 标签 | 不处理（超出初版范围） |

## 测试用例

### 基本功能

```html
<!-- 行内公式 -->
<div>$E=mc^2$</div>

<!-- 块级公式 -->
<div>$$
\sum_{i=1}^n i
$$</div>

<!-- 混合内容 -->
<div>文本 $x$ 更多文本 <span>$y$</span></div>
```

### 光标交互

1. 光标在公式行外 → 公式渲染
2. 光标进入公式行 → 显示源码 `$...$`
3. 光标在公式内部移动（如 `$x|$` 位置）→ 保持源码显示
4. 光标在公式边界（`|$x$` 或 `$x$|`）→ 显示源码或渲染（需验证）
5. 编辑公式内容 → 实时更新
6. 光标离开 → 重新渲染

### 嵌套标签

```html
<!-- 嵌套 HTML 标签 -->
<div>外层 $a$ <span>内层 $b$</span> 外层 $c$</div>
```
预期：`$a$`, `$b$`, `$c$` 全部正确渲染

### 错误处理

1. 无效公式语法 → 显示原始文本 + 错误标记
2. 超长公式 → 不影响编辑器性能
3. 空公式 `$ $` → 不渲染（正则要求至少一个非空字符）

### 不支持的标签

```html
<!-- 不在支持列表中的标签 -->
<a href="#">$x$</a>
```
预期：不处理，显示原始 `$x$`

## 未来扩展

- [ ] 设置页面：自定义支持的标签
- [ ] 支持更多标签类型
- [ ] HTML 实体转义处理
- [ ] 批量文档检测

## 验收标准

1. `<div>$E=mc^2$</div>` 在实时预览中正确渲染
2. 光标进入公式行时显示源码，离开时显示渲染结果
3. 块级公式 `$$...$$` 正确渲染
4. 混合内容中的多个公式全部正确渲染
5. 大文档（1000+ 行）无性能问题
6. 无效公式不会导致编辑器崩溃
