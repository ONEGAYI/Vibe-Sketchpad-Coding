# HTML LaTeX Fix - Obsidian 插件

## 项目概述

解决 Obsidian 中 HTML 标签内 LaTeX 公式无法渲染的问题。

当用户在 HTML 标签（如 `<div>`, `<span>`, `<details>` 等）内书写 `$E=mc^2$` 时，Obsidian 的 Markdown 解析器会跳过 HTML 内部内容，导致公式显示为原始文本。

## 技术栈

- **语言**: TypeScript 5.8+
- **运行时**: Node.js 18+
- **构建工具**: esbuild 0.25+
- **核心依赖**: obsidian (官方 API)

## 项目结构

```
src/
├── main.ts           # 插件入口，生命周期管理
├── processor.ts      # MarkdownPostProcessor 核心逻辑
├── math-renderer.ts  # renderMath/finishRenderMath 封装
└── utils.ts          # 正则定义、节点过滤、工具函数
```

## 开发命令

```bash
npm run dev      # 开发模式（热更新）
npm run build    # 生产构建
npm run deploy   # 部署到 Obsidian
```

## 核心实现

### Phase 1: 阅读模式 (已实现)

使用 `MarkdownPostProcessor` 拦截已解析的 DOM：

1. TreeWalker 遍历文本节点
2. 正则匹配 `$...$` (行内) 和 `$$...$$` (块级)
3. 调用 `obsidian.renderMath()` 渲染公式
4. 替换 DOM 节点，调用 `finishRenderMath()`

### Phase 2: 实时预览 (计划中)

使用 CodeMirror 6 扩展，详见 `memory/ROADMAP.md`。

## 关键 API

```typescript
// 渲染 LaTeX 公式
renderMath(source: string, display: boolean): HTMLElement

// 刷新 MathJax 样式表
finishRenderMath(): Promise<void>

// 注册后处理器
registerMarkdownPostProcessor(
  postProcessor: (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void | Promise<void>
): MarkdownPostProcessor
```

## 正则规则

```typescript
// 块级公式，支持多行
const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;

// 行内公式，支持 \$ 转义
const INLINE_MATH_REGEX = /(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g;
```

## 节点过滤

跳过以下父节点的文本节点：
- `<code>`, `<pre>` — 代码块
- `.math`, `.math-inline`, `.math-block` — 已渲染的公式
- `[data-math]` — Obsidian 内部标记

## 配置

Phase 1 采用零配置策略，开箱即用。

## 文档

- `docs/superpowers/specs/2026-03-17-html-latex-fix-design.md` — 设计规格
- `memory/ROADMAP.md` — 功能路线图
- `CHANGELOG.md` — 更新日志
