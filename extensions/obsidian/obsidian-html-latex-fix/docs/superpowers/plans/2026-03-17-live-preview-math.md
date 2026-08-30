# Live Preview Math Rendering 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Obsidian HTML LaTeX 修复插件添加实时预览模式支持，使 HTML 标签内的 LaTeX 公式能够渲染。

**Architecture:** 使用 CodeMirror 6 ViewPlugin + Decoration.replace + WidgetType 架构。通过语法树识别 HTML 区域，复用现有 `findMathMatches` 函数匹配公式，用 MathWidget 封装 Obsidian 的 `renderMath` API 进行渲染。

**Tech Stack:** TypeScript, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`), Obsidian API

---

## 文件结构

```
src/live-preview/
├── index.ts              # 模块入口，导出 livePreviewExtensions
├── html-region-finder.ts # HTML 区域识别 + 公式匹配转换
├── math-widget.ts        # WidgetType 实现，封装 MathJax 渲染
└── html-math-plugin.ts   # ViewPlugin 核心，协调装饰器生成

修改文件:
├── src/main.ts           # 注册 registerEditorExtension
└── package.json          # 添加 @codemirror/language 依赖
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 @codemirror/language 依赖**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npm install @codemirror/language
```

Expected: `package.json` 中添加 `"@codemirror/language": "^6.x.x"`

- [ ] **Step 2: 验证安装成功**

```bash
npm list @codemirror/language
```

Expected: 显示版本号，如 `@codemirror/language@6.10.8`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @codemirror/language dependency for live preview"
```

---

## Task 2: 创建 MathWidget

**Files:**
- Create: `src/live-preview/math-widget.ts`

- [ ] **Step 1: 创建 live-preview 目录**

```bash
mkdir -p D:/CODE/Project/Obsidian-Html-Tag-Fix/src/live-preview
```

- [ ] **Step 2: 编写 MathWidget 类**

创建文件 `src/live-preview/math-widget.ts`:

```typescript
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
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npx tsc --noEmit --skipLibCheck
```

Expected: 无错误输出

- [ ] **Step 4: Commit**

```bash
git add src/live-preview/math-widget.ts
git commit -m "$(cat <<'EOF'
feat(live-preview): add MathWidget for LaTeX rendering

MathWidget extends WidgetType to render LaTeX formulas using
Obsidian's built-in renderMath API. Features:
- Reuses DOM via eq() for performance
- Graceful error handling with visual feedback
- Supports both inline ($...$) and block ($$...$$) formulas

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 创建 HTML 区域识别器

**Files:**
- Create: `src/live-preview/html-region-finder.ts`

- [ ] **Step 1: 编写 HTML 区域识别模块**

创建文件 `src/live-preview/html-region-finder.ts`:

```typescript
import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { findMathMatches, MathMatch } from '../utils';

/**
 * HTML 区域（语法树节点范围）
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
 * 支持的 HTML 标签名称（小写）
 */
const SUPPORTED_TAGS = new Set([
  'div', 'span', 'details', 'summary', 'mark'
]);

/**
 * 识别文档中的所有 HTML 区域
 *
 * 策略：遍历语法树，找到 HTMLBlock/HTMLTag 节点，
 *       检查标签名是否在支持列表中
 */
export function findHtmlRegions(view: EditorView): HtmlRegion[] {
  const regions: HtmlRegion[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      // 检查是否是 HTML 块或标签
      const nodeName = node.name;
      if (nodeName === 'HTMLBlock' || nodeName === 'HTMLTag') {
        const text = view.state.doc.sliceString(node.from, node.to);
        // 验证是否是支持的标签
        if (isSupportedHtmlTag(text)) {
          // 提取标签内容区域（不含开闭标签）
          const innerRegion = extractInnerRegion(node.from, node.to, text);
          if (innerRegion) {
            regions.push(innerRegion);
          }
        }
      }
    }
  });

  return regions;
}

/**
 * 在指定范围内识别 HTML 区域（性能优化版本）
 */
export function findHtmlRegionsInRange(
  view: EditorView,
  from: number,
  to: number
): HtmlRegion[] {
  const regions: HtmlRegion[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    from,
    to,
    enter(node) {
      const nodeName = node.name;
      if (nodeName === 'HTMLBlock' || nodeName === 'HTMLTag') {
        const text = view.state.doc.sliceString(node.from, node.to);
        if (isSupportedHtmlTag(text)) {
          const innerRegion = extractInnerRegion(node.from, node.to, text);
          if (innerRegion) {
            regions.push(innerRegion);
          }
        }
      }
    }
  });

  return regions;
}

/**
 * 在 HTML 区域内查找公式匹配
 *
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

/**
 * 检查 HTML 文本是否是支持的标签
 */
function isSupportedHtmlTag(htmlText: string): boolean {
  // 提取开标签中的标签名
  const match = htmlText.match(/^<(\w+)/);
  if (!match) return false;
  const tagName = match[1].toLowerCase();
  return SUPPORTED_TAGS.has(tagName);
}

/**
 * 提取 HTML 标签内部内容的位置
 *
 * 输入: <div>content</div>
 * 输出: 内容区域的位置（不含 <div> 和 </div>）
 */
function extractInnerRegion(
  nodeFrom: number,
  nodeTo: number,
  htmlText: string
): HtmlRegion | null {
  // 找到开标签的结束位置
  const openTagEnd = htmlText.indexOf('>');
  if (openTagEnd === -1) return null;

  // 找到闭标签的开始位置
  const closeTagStart = htmlText.lastIndexOf('</');
  if (closeTagStart === -1 || closeTagStart <= openTagEnd) {
    // 自闭合标签或没有闭标签
    return null;
  }

  // 计算内容区域的绝对位置
  const contentFrom = nodeFrom + openTagEnd + 1;
  const contentTo = nodeFrom + closeTagStart;

  if (contentFrom >= contentTo) {
    // 空内容
    return null;
  }

  return {
    from: contentFrom,
    to: contentTo
  };
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npx tsc --noEmit --skipLibCheck
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/live-preview/html-region-finder.ts
git commit -m "$(cat <<'EOF'
feat(live-preview): add HTML region finder with syntax tree

html-region-finder.ts provides:
- findHtmlRegions: identifies HTML regions using CodeMirror syntax tree
- findHtmlRegionsInRange: optimized for visible ranges only
- findMathInHtmlRegion: converts math matches to absolute positions
- Supports div, span, details, summary, mark tags

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 创建 ViewPlugin 核心

**Files:**
- Create: `src/live-preview/html-math-plugin.ts`

- [ ] **Step 1: 编写 ViewPlugin 核心**

创建文件 `src/live-preview/html-math-plugin.ts`:

```typescript
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
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npx tsc --noEmit --skipLibCheck
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/live-preview/html-math-plugin.ts
git commit -m "$(cat <<'EOF'
feat(live-preview): add ViewPlugin for math decoration

html-math-plugin.ts implements the core ViewPlugin:
- Monitors docChanged and viewportChanged events
- Only processes visible ranges for performance
- Uses Decoration.replace with inclusive:false for cursor interaction
- Integrates with html-region-finder and math-widget

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 创建模块入口

**Files:**
- Create: `src/live-preview/index.ts`

- [ ] **Step 1: 编写模块入口**

创建文件 `src/live-preview/index.ts`:

```typescript
/**
 * Live Preview 模块入口
 *
 * 导出 CodeMirror 扩展，用于在实时预览模式下渲染 HTML 标签内的公式
 */

import { htmlMathPlugin } from './html-math-plugin';

/**
 * 实时预览扩展集合
 *
 * 在 main.ts 中通过 this.registerEditorExtension(livePreviewExtensions) 注册
 */
export const livePreviewExtensions = [
  htmlMathPlugin,
];

// 导出类型和工具函数（供外部使用或测试）
export { MathWidget } from './math-widget';
export {
  findHtmlRegions,
  findHtmlRegionsInRange,
  findMathInHtmlRegion,
  HtmlRegion,
  MathInRegionMatch
} from './html-region-finder';
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npx tsc --noEmit --skipLibCheck
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/live-preview/index.ts
git commit -m "$(cat <<'EOF'
feat(live-preview): add module entry point

index.ts exports:
- livePreviewExtensions: array of CodeMirror extensions
- MathWidget, HtmlRegion, MathInRegionMatch types
- Utility functions for testing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 集成到 main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 添加 live-preview 导入和注册**

修改 `src/main.ts`，在文件顶部添加导入：

```typescript
// 在其他导入后添加
import { livePreviewExtensions } from './live-preview';
```

在 `onload()` 方法中添加注册：

```typescript
async onload() {
  console.log('HtmlMathFix: Loading plugin');

  // 创建并注册 PostProcessor（Phase 1 功能）
  this.processor = createHtmlMathProcessor();
  this.registerMarkdownPostProcessor(this.processor);

  // 注册实时预览扩展（Phase 2 功能）
  this.registerEditorExtension(livePreviewExtensions);

  // 注册事件监听（Phase 1.5 自动格式化助手）
  this.registerEventListeners();

  console.log('HtmlMathFix: Plugin loaded successfully');
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npx tsc --noEmit --skipLibCheck
```

Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "$(cat <<'EOF'
feat: integrate live preview extension into main plugin

Register livePreviewExtensions via registerEditorExtension
to enable math rendering in HTML tags during live preview.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 构建并部署测试

**Files:**
- Build: `main.js`

- [ ] **Step 1: 执行完整构建**

```bash
cd D:/CODE/Project/Obsidian-Html-Tag-Fix
npm run build
```

Expected: 构建成功，生成 `main.js`

- [ ] **Step 2: 部署到 Obsidian**

```bash
npm run deploy
```

Expected: 文件复制到 Obsidian 插件目录

- [ ] **Step 3: 手动测试 - 基本功能**

在 Obsidian 中创建测试文档：

```markdown
# 测试 HTML 标签内公式渲染

## 行内公式
<div>$E=mc^2$</div>

<span>$x^2 + y^2 = z^2$</span>

## 块级公式
<div>$$
\sum_{i=1}^n i = \frac{n(n+1)}{2}
$$</div>

## 混合内容
<div>文本 $a$ 更多文本 <span>$b$</span> 结尾</div>

## 不支持的标签
<a href="#">$x$</a> 应该不渲染
```

Expected:
- `<div>`, `<span>` 内的公式正确渲染
- 块级公式 `$$...$$` 正确渲染
- `<a>` 标签内的公式不渲染

- [ ] **Step 4: 手动测试 - 光标交互**

1. 光标移到公式行外 → 公式渲染
2. 光标移入公式行 → 显示源码 `$...$`
3. 编辑公式内容 → 实时更新
4. 光标离开 → 重新渲染

- [ ] **Step 5: 手动测试 - 错误处理**

```markdown
<div>$\invalid{formula$</div>
```

Expected: 显示原始公式 + 红色虚线边框

- [ ] **Step 6: Commit 测试结果**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: verify live preview math rendering

Manual testing results:
- ✅ Inline formulas in HTML tags render correctly
- ✅ Block formulas ($$...$$) render correctly
- ✅ Mixed content with nested tags works
- ✅ Cursor interaction shows/hides formulas
- ✅ Error handling displays fallback

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 更新文档

**Files:**
- Modify: `memory/ROADMAP.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新 ROADMAP**

修改 `memory/ROADMAP.md`，更新 Phase 2 状态：

```markdown
## Phase 2: 实时预览模式 ✅ (已完成)

- [x] CodeMirror 6 ViewPlugin
- [x] WidgetType + Decoration.replace
- [x] 语法树解析 HTML 区块
- [x] 光标交互（inclusive: false）
- [x] 复用 utils.findMathMatches

**设计文档**: `docs/superpowers/specs/2026-03-17-live-preview-math-design.md`
```

- [ ] **Step 2: 更新 CHANGELOG**

在 `CHANGELOG.md` 顶部添加：

```markdown
## [0.3.0] - 2026-03-17

### Added
- **Phase 2: 实时预览模式** - HTML 标签内的公式现在可以在实时预览模式下渲染
  - 支持 `<div>`, `<span>`, `<details>`, `<summary>`, `<mark>` 标签
  - 行内公式 `$...$` 和块级公式 `$$...$$`
  - 光标交互：编辑时显示源码，离开时显示渲染结果
  - 新增依赖: `@codemirror/language`

### Technical
- 新增 `src/live-preview/` 模块
  - `math-widget.ts`: WidgetType 实现
  - `html-region-finder.ts`: 语法树解析 HTML 区域
  - `html-math-plugin.ts`: ViewPlugin 核心
  - `index.ts`: 模块导出
```

- [ ] **Step 3: Commit**

```bash
git add memory/ROADMAP.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: update ROADMAP and CHANGELOG for Phase 2

Mark Phase 2 as complete in ROADMAP.
Add detailed changelog entry for live preview feature.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## 验收清单

- [ ] `<div>$E=mc^2$</div>` 在实时预览中正确渲染
- [ ] 光标进入公式行时显示源码，离开时显示渲染结果
- [ ] 块级公式 `$$...$$` 正确渲染
- [ ] 混合内容中的多个公式全部正确渲染
- [ ] 大文档（500+ 行）无明显性能问题
- [ ] 无效公式不会导致编辑器崩溃
- [ ] TypeScript 编译无错误
- [ ] 所有 commits 遵循 Conventional Commits 规范

---

## 回滚方案

如果实时预览功能出现严重问题，可以通过以下方式快速回滚：

1. **注释掉注册代码**（快速禁用）：
```typescript
// this.registerEditorExtension(livePreviewExtensions);
```

2. **回滚 commits**：
```bash
git revert <commit-hash>
```

3. **完全移除**：
```bash
rm -rf src/live-preview/
# 并移除 main.ts 中的导入和注册
npm uninstall @codemirror/language
```
