# 更新日志

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 计划中
- Phase 2.1: 实时预览模式修复（解决公式渲染闪烁问题）

## [0.3.0] - 2026-03-17

### 新增
- **Phase 2: 实时预览模式** - 架构已完成，核心功能暂缓
  - 新增 `src/live-preview/` 模块
    - `math-widget.ts`: WidgetType 实现
    - `html-region-finder.ts`: HTML 区域识别 + 公式匹配
    - `html-math-plugin.ts`: ViewPlugin 核心
    - `index.ts`: 模块导出
  - 支持 `<div>`, `<span>`, `<details>`, `<summary>`, `<mark>` 标签
  - 行内公式 `$...$` 和块级公式 `$$...$$`
  - 光标交互：编辑时显示源码，离开时显示渲染结果
  - 新增依赖: `@codemirror/language`

### 已知问题
- 公式渲染闪烁后变回源码（核心问题暂缓）
- 详见 `docs/live-preview-development-report.md`

## [0.2.0] - 2026-03-17

### 新增
- Phase 1.5: 自动格式化助手
  - 检测 HTML 标签内公式中未转义的 `<` `>` 符号
  - 右下角弹窗提示 + 一键修复按钮
  - 详情弹窗显示所有问题（行号、上下文）
  - 触发时机：打开文档、保存、切换到阅读模式
  - 智能空格处理（符号紧邻字母时自动添加空格）
  - 支持 Ctrl+Z 撤销修复操作
- 新增模块化架构：
  - `checker/formula-checker.ts` - 公式问题检测
  - `fixer/formula-fixer.ts` - 公式问题修复
  - `ui/notice-ui.ts` - 通知弹窗
  - `ui/detail-modal.ts` - 详情弹窗
  - `types/problem.ts` - 问题数据结构

## [0.1.1] - 2026-03-17

### 修复
- 修复同一文本节点中多个公式只渲染最后一个的问题
- 改为一次性处理策略，避免多次 DOM 操作导致的节点引用失效

## [0.1.0] - 2026-03-17

### 新增
- 首次发布
- Phase 1: 阅读模式支持
- 渲染 HTML 标签内的 LaTeX 公式（`$...$` 行内公式和 `$$...$$` 块级公式）
- 支持 `\$` 转义显示字面量美元符号
- 自动跳过代码块和已渲染的公式元素
- 自动部署脚本（`deploy.mjs`）
