# Obsidian HTML Tag LaTeX Fix - 设计规格

## 概述

解决 Obsidian 中 HTML 标签内 LaTeX 公式无法渲染的问题。当用户在 HTML 标签（如 `<div>`, `<span>`, `<details>` 等）内书写 `$E=mc^2$` 时，Obsidian 的 Markdown 解析器会跳过 HTML 内部内容，导致公式显示为原始文本。

## 目标

- Phase 1（当前）：修复阅读模式 (Reading View)
- Phase 2（未来）：扩展到实时预览模式 (Live Preview)

## 技术栈

- **语言**: TypeScript
- **运行时**: Node.js 18+
- **构建工具**: esbuild
- **核心依赖**: obsidian (官方 API)

## 项目结构

```
Obsidian-Html-Tag-Fix/
├── manifest.json        # 插件元数据
├── package.json         # 依赖管理
├── tsconfig.json        # TypeScript 配置
├── esbuild.config.mjs   # 构建配置
├── src/
│   ├── main.ts          # 插件入口，生命周期管理
│   ├── processor.ts     # MarkdownPostProcessor 核心逻辑
│   ├── math-renderer.ts # renderMath 封装，统一渲染接口
│   └── utils.ts         # 正则定义、DOM 工具函数
└── memory/
    └── ROADMAP.md       # 功能路线图
```

## 模块设计

### main.ts - 插件入口

```typescript
import { Plugin } from 'obsidian';
import { createHtmlMathProcessor } from './processor';

export default class HtmlMathFixPlugin extends Plugin {
  onload() {
    this.registerMarkdownPostProcessor(createHtmlMathProcessor());
  }
}
```

### processor.ts - 核心处理器

**职责:**
- 创建 MarkdownPostProcessor 回调函数
- 使用 TreeWalker 遍历文本节点
- 协调过滤、匹配、渲染、替换流程

**核心流程:**
1. 接收 `el: HTMLElement` 和 `ctx: MarkdownPostProcessorContext`
2. 创建 TreeWalker 遍历所有文本节点
3. 对每个文本节点调用 `shouldSkipNode()` 判断是否跳过
4. 使用正则匹配块级公式 `$$...$$` 和行内公式 `$...$`
5. 调用 `renderMathInElement()` 渲染并替换 DOM 节点

### math-renderer.ts - 公式渲染

**职责:**
- 封装 `obsidian.renderMath()` 调用
- 封装 `obsidian.finishRenderMath()` 调用
- 处理渲染后的 DOM 节点插入

**接口设计:**
```typescript
export async function renderMathInElement(
  textNode: Text,
  mathContent: string,
  isBlock: boolean
): Promise<void>;
```

### utils.ts - 工具函数

**正则定义:**
```typescript
// 块级公式优先，支持多行
export const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;

// 行内公式，支持 \$ 转义
export const INLINE_MATH_REGEX = /(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g;
```

**节点过滤:**
```typescript
export function shouldSkipNode(node: Text): boolean;
```
跳过规则：
- 父节点是 `<code>` 或 `<pre>`
- 父节点有 `.math`, `.math-inline`, `.math-block` class
- 父节点有 `[data-math]` 属性

**文本分割:**
```typescript
export function splitTextNode(
  textNode: Text,
  startIndex: number,
  endIndex: number
): { before: Text; match: Text; after: Text };
```

## 性能优化（级别 2）

- 跳过代码块、已渲染公式节点
- TreeWalker 只遍历文本节点（`NodeFilter.SHOW_TEXT`）
- 不使用 `innerHTML` 替换，保持 DOM 引用

## 配置

Phase 1 采用零配置策略，开箱即用。

## 边缘情况处理

| 情况 | 处理方式 |
|------|---------|
| `\$` 转义 | 正则使用 negative lookbehind 跳过 |
| 嵌套公式 | 块级公式优先匹配，避免冲突 |
| 空公式 `$ $` | 正则要求至少一个非空字符 |
| HTML 实体 `&lt;` | 浏览器已自动解码，无需处理 |

## 未来扩展

见 `memory/ROADMAP.md`:
- Phase 2: 实时预览模式 (CodeMirror 6)
- 自动格式化助手
- 配置面板

## 验收标准

1. 在阅读模式下，`<div>$E=mc^2$</div>` 正确渲染为数学公式
2. `<div>$$\sum_{i=1}^n i$$</div>` 正确渲染为块级公式
3. 代码块内的 `$...$` 不被误处理
4. 已渲染的公式不会被重复处理
5. `\$` 正确显示为字面量 `$`
