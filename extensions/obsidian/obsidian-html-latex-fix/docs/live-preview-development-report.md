# Live Preview 模式开发报告

> **文档日期**: 2026-03-17
> **状态**: Phase 2 暂缓
> **版本**: 0.3.0 (已发布但功能不完整)

---

## 1. 概述

### 1.1 项目背景

Obsidian HTML Tag LaTeX Fix 插件旨在解决 HTML 标签内 LaTeX 公式无法渲染的问题。Phase 1 已完成阅读模式支持，Phase 2 目标是在实时预览（Live Preview）模式下实现同样的渲染能力。

### 1.2 Phase 2 目标

| 目标 | 状态 | 备注 |
|------|------|------|
| 在实时预览模式下渲染 HTML 标签内的公式 | ⚠️ 部分实现 | 存在渲染闪烁问题 |
| 光标在行时显示源码，离开时显示渲染结果 | ⚠️ 部分实现 | 光标交互基本正常 |
| 支持行内公式 `$...$` | ⚠️ 部分实现 | 存在闪烁问题 |
| 支持块级公式 `$$...$$` | ⚠️ 部分实现 | 存在闪烁问题 |
| 支持嵌套标签内的公式 | ⚠️ 部分实现 | 依赖 HTML 区域识别 |

---

## 2. 已完成的工作

### 2.1 基础架构实现

```
src/live-preview/
├── index.ts              # 模块入口，导出 livePreviewExtensions
├── html-math-plugin.ts   # ViewPlugin 核心，装饰器生成
├── html-region-finder.ts # HTML 区域识别 + 公式匹配
└── math-widget.ts        # WidgetType 实现，MathJax 渲染
```

### 2.2 核心模块功能

#### html-math-plugin.ts
- **ViewPlugin 实现**: 监听文档变化、视口变化、光标移动
- **装饰器构建**: `buildDecorations()` 方法生成 `Decoration.replace`
- **光标交互**: 检测光标所在行，跳过该区域的装饰器（显示源码）

#### html-region-finder.ts
- **HTML 区域识别**: 正则匹配 `<div>`, `<span>`, `<details>`, `<summary>`, `<mark>`
- **可见范围优化**: 只处理 `view.visibleRanges` 内的区域
- **公式匹配**: 复用 `utils.findMathMatches` 进行公式识别

#### math-widget.ts
- **WidgetType 实现**: `toDOM()` 创建渲染后的 DOM 元素
- **MathJax 集成**: 使用 Obsidian 内置的 `renderMath` + `finishRenderMath`
- **错误处理**: 渲染失败时显示原始公式 + 错误标记

### 2.3 主插件集成

```typescript
// main.ts
import { livePreviewExtensions } from './live-preview';

export default class HtmlMathFixPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(livePreviewExtensions);
  }
}
```

---

## 3. 调试过程中的问题

### 3.1 核心问题：公式渲染闪烁后变回源码

**现象描述**:
1. 公式最初不渲染
2. 点入标签+公式行后无影响（期望行为）
3. 移出光标后闪一下渲染好的公式
4. 最终变回源码（Bug 点）

**问题定位**:
经过多轮调试，确定问题源于 **CodeMirror 视图更新机制** 与 **MathJax 异步渲染** 的冲突。

### 3.2 已识别的三个核心原因

#### 原因 1: `display: contents` 破坏 CodeMirror 尺寸测量

```typescript
// math-widget.ts (问题代码)
container.style.display = 'contents';  // 让容器在排版上"消失"
```

**问题分析**:
- CodeMirror 6 极度依赖 DOM 元素的宽高等盒模型数据来计算光标位置和视口
- `display: contents` 会让元素失去物理尺寸（宽高为 0）
- 当 MathJax 渲染出 SVG 后，CodeMirror 发现尺寸异常会强制重绘当前行
- 这导致 Widget 被销毁重建或丢弃

#### 原因 2: `finishRenderMath()` 全局队列冲突

```typescript
// math-widget.ts (问题代码)
requestAnimationFrame(() => {
  if (container.isConnected) {
    finishRenderMath();  // 触发 Obsidian 全局 MathJax 处理队列
  }
});
```

**问题分析**:
- `finishRenderMath()` 会触发 Obsidian 全局的 MathJax 处理队列
- 在 Live Preview 下，Obsidian 自身的 Markdown 渲染引擎也在调用它
- 并发调用可能导致 MathJax 重置刚刚挂载的 DOM 节点，使之回退为源码

#### 原因 3: 可见区域文本截断导致正则失效

```typescript
// html-region-finder.ts (问题代码)
const text = doc.sliceString(minFrom, maxTo);  // 只获取可见区域的文本
const htmlTagRegex = /<(div|span|details|summary|mark)([^>]*)>([\s\S]*?)<\/\1>/gi;
```

**问题分析**:
- 当视口滚动或局部更新时，`minFrom` 可能刚好切在 `<span...` 标签内部
- 例如：切在 `p` 和 `a` 之间，变成 `an style="...">`
- 这会导致正则 `/<(div|span...)/` 匹配失败
- 区域丢失，装饰器被移除，公式变回源码

---

## 4. 尝试的修复方案

### 4.1 方案 A: 修复 `display: contents` 问题

**修改内容**:
```typescript
// 改用 inline-block 或 block
container.style.display = this.isBlock ? 'block' : 'inline-block';
```

**状态**: 已测试，但未完全解决问题

### 4.2 方案 B: 使用局部 MathJax 渲染

**修改内容**:
```typescript
// 弃用 finishRenderMath()
loadMathJax().then(() => {
  if (window.MathJax) {
    window.MathJax.typesetPromise([mathEl]);  // 局部渲染
  }
});
```

**状态**: 已测试，但未完全解决问题

### 4.3 方案 C: 全文匹配 HTML 区域

**修改内容**:
```typescript
// 直接获取全文进行正则匹配
const text = doc.toString();  // 而非 doc.sliceString(minFrom, maxTo)

// 然后筛选与可见区域有交集的区域
if (openTagEnd < maxTo && closeTagStart > minFrom) {
  regions.push({ from: openTagEnd, to: closeTagStart });
}
```

**状态**: 已测试，但未完全解决问题

### 4.4 暂缓决定

由于以上三个修复方案需要组合使用且涉及深层架构调整，出于性能和稳定性考虑，决定暂时推迟 Phase 2 的开发。

---

## 5. 当前状态

### 5.1 已实现功能

| 功能 | 阅读模式 | 实时预览模式 |
|------|----------|--------------|
| 行内公式 `$...$` | ✅ 正常 | ⚠️ 闪烁问题 |
| 块级公式 `$$...$$` | ✅ 正常 | ⚠️ 闪烁问题 |
| 多公式渲染 | ✅ 正常 | ⚠️ 闪烁问题 |
| 光标交互（编辑时显示源码） | N/A | ⚠️ 基本正常 |
| 自动格式化助手 | ✅ 正常 | ✅ 正常 |

### 5.2 已知问题

| 问题 | 严重程度 | 状态 |
|------|----------|------|
| 公式渲染闪烁后变回源码 | 🔴 高 | 暂缓 |
| 性能优化（避免频繁重建装饰器） | 🟡 中 | 待优化 |
| 大文档（1000+ 行）性能 | 🟡 中 | 未测试 |

### 5.3 暂缓原因

1. **核心问题复杂**: 涉及 CodeMirror 6 内部机制和 MathJax 异步渲染的深层冲突
2. **修复方案组合复杂**: 三个核心原因需要同时解决，单一修复无效
3. **性能顾虑**: 全文匹配方案可能影响大文档性能
4. **稳定性优先**: 阅读模式功能已完整，优先保证现有功能稳定

---

## 6. 后续规划

### 6.1 短期计划 (Phase 2.1)

**目标**: 解决公式渲染闪烁问题

**任务**:
1. 深入研究 CodeMirror 6 的 Widget 生命周期
2. 研究 Obsidian 原生公式渲染的实现方式
3. 探索使用 Obsidian 内部 API 替代自定义 Widget
4. 考虑使用 `EditorView.decorations` facet 替代 ViewPlugin

**预估工作量**: 2-3 个开发周期

### 6.2 中期计划 (Phase 2.2)

**目标**: 性能优化和边缘情况处理

**任务**:
1. 实现装饰器增量更新（避免全量重建）
2. 优化 HTML 区域匹配算法
3. 处理边缘情况：
   - 公式跨 HTML 标签
   - 嵌套公式
   - 超长公式
4. 大文档性能测试（1000+ 行）

**预估工作量**: 1-2 个开发周期

### 6.3 长期计划

**目标**: 功能完善和可配置性

**任务**:
1. 设置页面：自定义支持的标签
2. 支持更多标签类型
3. HTML 实体转义处理
4. 批量文档检测

---

## 7. 技术债务

### 7.1 待优化项

| 项目 | 优先级 | 说明 |
|------|--------|------|
| 装饰器增量更新 | 高 | 当前每次变化都全量重建 |
| 全文匹配性能 | 高 | 需要验证大文档性能 |
| 日志清理 | 中 | 移除调试日志或改为条件输出 |
| 类型安全 | 低 | MathJax 全局对象类型定义 |

### 7.2 待验证项

| 项目 | 说明 |
|------|------|
| `inclusive: false` 行为 | 设计规格中提到需要验证 |
| 光标边界行为 | 光标在公式边界时的显示逻辑 |
| 嵌套标签处理 | 嵌套 HTML 标签内的公式渲染 |
| 并发更新处理 | 快速编辑时的渲染稳定性 |

### 7.3 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| CodeMirror 版本升级 | API 可能变化 | 保持关注 Obsidian 更新 |
| MathJax 版本升级 | 渲染行为可能变化 | 保持关注 Obsidian 更新 |
| Obsidian API 变化 | 内部 API 可能变化 | 优先使用公开 API |

---

## 8. 参考资料

### 8.1 内部文档

- `docs/superpowers/specs/2026-03-17-live-preview-math-design.md` - 实时预览模式设计规格
- `memory/ROADMAP.md` - 功能路线图
- `CHANGELOG.md` - 更新日志

### 8.2 外部资源

- [CodeMirror 6 Documentation](https://codemirror.net/docs/)
- [CodeMirror 6 Decorations](https://codemirror.net/examples/decoration/)
- [Obsidian Developer Docs](https://docs.obsidian.md/Reference/TypeScript+API)
- [MathJax Documentation](https://docs.mathjax.org/)

### 8.3 相关 Commit

| Commit | 说明 |
|--------|------|
| `d134b69` | feat(live-preview): add MathWidget for LaTeX rendering |
| `f0e922b` | feat(live-preview): add HTML region finder with syntax tree |
| `27b3d4a` | feat(live-preview): add ViewPlugin for math decoration |
| `d387c02` | feat(live-preview): add module entry point |
| `9794287` | feat: integrate live preview extension into main plugin |
| `16ca393` | docs: update ROADMAP and CHANGELOG for Phase 2 |

---

## 9. 附录：调试日志参考

### 9.1 正常流程日志

```
[HtmlMathPlugin] update 触发, docChanged:false, viewportChanged:false, selectionChanged:true
[HtmlRegionFinder] 发现 HTML 区域: <span> (位置 100-150)
[HtmlMathPlugin] 渲染公式: $E=mc^2$ (位置 110-120)
[MathWidget] toDOM: $E=mc^2$
[MathWidget] finishRenderMath 已在挂载后触发
```

### 9.2 问题流程日志

```
[HtmlMathPlugin] update 触发, docChanged:false, viewportChanged:false, selectionChanged:true
[HtmlMathPlugin] 跳过区域 (光标在第 5 行，区域在第 5-5 行)
... (光标移出)
[HtmlMathPlugin] update 触发, docChanged:false, viewportChanged:false, selectionChanged:true
[HtmlMathPlugin] 渲染公式: $E=mc^2$ (位置 110-120)
[MathWidget] toDOM: $E=mc^2$
[MathWidget] finishRenderMath 已在挂载后触发
... (闪烁后变回源码)
[HtmlMathPlugin] update 触发  // 非预期的重新触发
[HtmlMathPlugin] 装饰器数量变化: 1 -> 0  // 装饰器被移除
```

---

*报告结束*
