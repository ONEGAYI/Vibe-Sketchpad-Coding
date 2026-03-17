# 更新日志

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增
- Phase 2: 实时预览模式支持（CodeMirror 6 扩展）

## [0.1.0] - 2026-03-17

### 新增
- 首次发布
- Phase 1: 阅读模式支持
- 渲染 HTML 标签内的 LaTeX 公式（`$...$` 行内公式和 `$$...$$` 块级公式）
- 支持 `\$` 转义显示字面量美元符号
- 自动跳过代码块和已渲染的公式元素
- 自动部署脚本（`deploy.mjs`）
