# Obsidian HTML Tag LaTeX Fix - Roadmap

## Phase 1: 阅读模式 ✅ (已完成)

- [x] 使用 MarkdownPostProcessor 拦截 DOM
- [x] TreeWalker 遍历文本节点
- [x] 正则匹配 $...$ 和 $$...$$
- [x] 调用 obsidian.renderMath() 渲染
- [x] 修复同一文本节点中多个公式渲染问题

## Phase 1.5: 自动格式化助手 ✅ (已完成)

- [x] 检测 HTML 标签内公式中的 `<` `>` 符号
- [x] 右下角弹窗提示 + 一键修复按钮
- [x] 详情弹窗显示所有问题（行号、上下文）
- [x] 触发时机：打开文档、切换阅读模式、保存
- [x] 支持 Ctrl+Z 撤销
- [x] 齿轮按钮跳转设置（占位）
- [x] 智能空格处理（符号紧邻字母时自动添加空格）

**设计文档**: `docs/superpowers/specs/2026-03-17-auto-formatter-design.md`

## Phase 2: 实时预览模式 ⚠️ (暂缓)

### 当前状态

- [x] CodeMirror 6 ViewPlugin 架构
- [x] WidgetType + Decoration.replace 实现
- [x] HTML 区域识别（正则匹配）
- [x] 光标交互（行级别检测）
- [x] 复用 utils.findMathMatches
- [ ] **核心问题未解决**: 公式渲染闪烁后变回源码

### 已识别的问题

| 问题 | 原因 | 状态 |
|------|------|------|
| 公式渲染闪烁后变回源码 | CodeMirror 尺寸测量与 MathJax 异步渲染冲突 | 暂缓 |
| `display: contents` 破坏 CM6 尺寸测量 | CM6 依赖 DOM 盒模型计算光标位置 | 已定位 |
| `finishRenderMath()` 全局队列冲突 | Obsidian 内部也在调用，导致并发重置 | 已定位 |
| 可见区域文本截断导致正则失效 | HTML 标签被截断，匹配失败 | 已定位 |

### 暂缓原因

1. 核心问题涉及 CodeMirror 6 内部机制和 MathJax 异步渲染的深层冲突
2. 三个核心原因需要组合修复，单一修复无效
3. 出于性能和稳定性考虑，优先保证阅读模式功能

**详细报告**: `docs/live-preview-development-report.md`

**设计文档**: `docs/superpowers/specs/2026-03-17-live-preview-math-design.md`

---

## Phase 2.1: 实时预览修复 (计划中)

> **前置条件**: 深入研究 CodeMirror 6 Widget 生命周期和 Obsidian 原生公式渲染

### 核心修复任务

- [ ] 研究 CodeMirror 6 Widget 的 `updateDOM` 和 `destroy` 生命周期
- [ ] 研究 Obsidian 原生公式渲染的实现方式
- [ ] 探索使用 Obsidian 内部 API 替代自定义 Widget
- [ ] 考虑使用 `EditorView.decorations` facet 替代 ViewPlugin

### 修复方案候选

1. **弃用 `display: contents`**，改用 `inline-block` / `block`
2. **弃用 `finishRenderMath()`**，改用 `MathJax.typesetPromise([element])` 局部渲染
3. **全文匹配 HTML 区域**，避免可见区域截断问题

**预估工作量**: 2-3 个开发周期

---

## Phase 2.2: 性能优化 (计划中)

> **前置条件**: Phase 2.1 完成

### 性能优化任务

- [ ] 实现装饰器增量更新（避免全量重建）
- [ ] 优化 HTML 区域匹配算法
- [ ] 大文档性能测试（1000+ 行）

### 边缘情况处理

- [ ] 公式跨 HTML 标签
- [ ] 嵌套公式
- [ ] 超长公式

**预估工作量**: 1-2 个开发周期

---

## 未来扩展功能

### 自动格式化助手后续
- [ ] 设置页面：开关、自定义触发时机
- [ ] 批量处理：多文档检测
- [ ] 更多符号：`&` → `\&` 等

### 配置项（Phase 1 后续迭代）
- [ ] 插件开关
- [ ] 选择处理的标签类型（如只处理 div/span 还是全部）
- [ ] 自定义公式边界正则
- [ ] 排除规则（如跳过特定 class 的元素）
- [ ] 性能调优参数（防抖延迟等）

### Phase 2 完成后
- [ ] 设置页面：自定义支持的标签
- [ ] 支持更多标签类型
- [ ] HTML 实体转义处理
- [ ] 批量文档检测

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 0.1.0 | 2026-03-17 | Phase 1: 阅读模式支持 |
| 0.2.0 | 2026-03-17 | Phase 1.5: 自动格式化助手 |
| 0.3.0 | 2026-03-17 | Phase 2: 实时预览模式（架构完成，核心问题暂缓） |
