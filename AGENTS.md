# VibeSketchpadCoding

自制 vibe coding 小工具合集（monorepo）。每个小工具独立一个子目录，自成一体、独立可运行。

## 文件树

```
VibeSketchpadCoding/
├── AGENTS.md      # 本文件：agent 通用规则单一事实源（项目说明、文件树、规范）
├── CLAUDE.md      # 通过 @AGENTS.md 导入主文件，仅附加 Claude 专属补充
└── .gitignore     # 通用忽略规则（各工具子目录可按需追加自有条目）
```

> 新增/删除工具时必须同步维护此文件树，摘要描述以"刚好覆盖文件内容"为准。

## 组织约定

- 每个小工具一个子目录，命名用 kebab-case（如 `todo-quick/`）
- 工具子目录内自带 `README.md`，说明用途、用法、技术栈
- 依赖不提升到根目录，保持各工具独立；根目录只放规则文件与文档

## 提交规范

- 提交信息使用**中文**，格式 `类型: 简述`，类型：`feat` / `fix` / `refactor` / `docs` / `chore` / `style` / `perf` / `test`
- 正文必需：说明做了什么、为什么做；涉及多模块时分条列出变更内容
- 关联 Issue/PR 时在正文末尾标注（如 `Close #123`）

## 发布规范

- 版本归纳遵循 Keep a CHANGELOG 格式（`### 新功能` / `### Bug 修复` / `### 其他改进`），版本段落需有 1-2 句总结
- Release notes 必须包含完整 CHANGELOG 内容，并引用对应 PR 编号
