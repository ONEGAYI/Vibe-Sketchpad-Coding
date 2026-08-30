# HTML LaTeX Fix - Obsidian 插件

## 工具使用与命令

- 每次对话开始前使用 superpowers mcp
- 使用 serena 的 LSP 功能辅助代码浏览与探索

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
├── main.ts              # 插件入口，生命周期管理
├── processor.ts         # MarkdownPostProcessor 核心逻辑
├── math-renderer.ts     # renderMath/finishRenderMath 封装
├── utils.ts             # 正则定义、节点过滤、工具函数
├── styles.css           # UI 组件样式
├── checker/
│   └── formula-checker.ts   # 公式问题检测器
├── fixer/
│   └── formula-fixer.ts     # 公式问题修复器
├── live-preview/            # Phase 2: 实时预览模式 (暂缓)
│   ├── index.ts             # 模块入口
│   ├── html-math-plugin.ts  # ViewPlugin 核心
│   ├── html-region-finder.ts# HTML 区域识别
│   └── math-widget.ts       # WidgetType 实现
├── types/
│   └── problem.ts           # 问题数据结构
└── ui/
    ├── notice-ui.ts         # 通知弹窗
    └── detail-modal.ts      # 详情弹窗
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

### Phase 1.5: 自动格式化助手 (已实现)

检测 HTML 标签内公式中未转义的 `<` `>` 符号：
- 右下角弹窗提示 + 一键修复
- 详情弹窗显示问题列表
- 触发时机：打开文档、保存、切换到阅读模式
- 智能空格处理（符号紧邻字母时自动添加空格）
- 支持 Ctrl+Z 撤销

### Phase 2: 实时预览 ⚠️ (暂缓)

架构已完成，但存在核心问题未解决（公式渲染闪烁后变回源码）。

**已识别的问题**:
1. `display: contents` 破坏 CodeMirror 尺寸测量
2. `finishRenderMath()` 全局队列冲突
3. 可见区域文本截断导致正则失效

**详细报告**: `docs/live-preview-development-report.md`
**设计文档**: `docs/superpowers/specs/2026-03-17-live-preview-math-design.md`

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

- `docs/superpowers/specs/2026-03-17-html-latex-fix-design.md` — 阅读模式设计规格
- `docs/superpowers/specs/2026-03-17-live-preview-math-design.md` — 实时预览设计规格
- `docs/live-preview-development-report.md` — 实时预览开发报告（问题分析、暂缓原因）
- `memory/ROADMAP.md` — 功能路线图
- `CHANGELOG.md` — 更新日志
