# VibeSketchpadCoding

自制 vibe coding 小工具合集（monorepo）。每个小工具独立一个子目录，自成一体、独立可运行。

## 文件树（简版速览）

本仓库文件树由 [file-tree 技能](.agents/skills/file-tree/SKILL.md)维护：`tree.json` 是唯一数据源，下方标记块为脚本渲染产物，**禁止手改**。新增/删除/移动文件时用 `tree_tool.py add/rm/add-batch` 等命令变更（写后自动重渲染），摘要描述以"刚好覆盖文件内容"为准；完整描述用 `get`/`query` 查询，提交前跑 `check --strict` 核对。

```
<!-- file-tree:tree:begin 由脚本渲染，禁止手改 -->
Vibe-Sketchpad-Coding/
├── .agents/    # 本仓库技能部署目录
│   └── skills/ # 部署技能根目录
│       └── file-tree/… # file-tree 部署实例
├── .gitignore  # 通用忽略规则
├── AGENTS.md   # agent 规则单一事实源
├── CLAUDE.md   # Claude 专属补充规则
├── extensions/ # 宿主扩展成员目录
│   ├── obsidian/ # Obsidian 扩展目录
│   │   ├── README.md # 目录说明：收录范围与约定
│   │   └── 目录.md     # 目录索引：本地插件与外部资源
│   └── README.md # 目录说明：按平台分组约定
├── prompts/    # 提示词工具成员目录
│   └── README.md # 目录说明：收录范围与约定
└── skills/     # 技能源码成员目录
    ├── accelerated-learning/…   # 教师式学习技能母体
    └── deploy-file-tree-skill/… # file-tree 部署器母体
<!-- file-tree:tree:end -->
```

## 文件树标签词表

<!-- file-tree:tags:begin 由脚本渲染，禁止手改 -->
| 标签 | 说明 |
| --- | --- |
| `doc` | 说明文档 |
| `script` | 维护脚本 |
| `skill` | 技能母体或部署实例的组成条目 |
| `test` | 契约测试 |
<!-- file-tree:tags:end -->

## 组织约定

- 每个小工具一个子目录，命名用 kebab-case（如 `todo-quick/`）
- 工具子目录内自带 `README.md`，说明用途、用法、技术栈
- 依赖不提升到根目录，保持各工具独立；根目录只放规则文件与文档
- 技能源码统一放 `skills/` 目录，同样一技能一子目录（kebab-case）、自带 `README.md`；入库的是技能快照原样副本
- 提示词类工具统一放 `prompts/` 目录，一工具一子目录（kebab-case）、自带 `README.md`（与 `skills/` 分工：前者是直接投给对话模型的提示词，后者是 agent 技能）
- 宿主扩展类工具统一放 `extensions/<平台>/` 目录（如 `extensions/obsidian/`），平台内一扩展一子目录、自带 `README.md`
- 本仓库自身的文件树由 `.agents/skills/file-tree/` 技能维护（tree.json 唯一数据源，AGENTS.md 树块为渲染产物禁止手改），维护命令与字段语义见该技能 SKILL.md

## 提交规范

- 提交信息使用**中文**，格式 `类型: 简述`，类型：`feat` / `fix` / `refactor` / `docs` / `chore` / `style` / `perf` / `test`
- 正文必需：说明做了什么、为什么做；涉及多模块时分条列出变更内容
- 关联 Issue/PR 时在正文末尾标注（如 `Close #123`）

## 发布规范

- 版本归纳遵循 Keep a CHANGELOG 格式（`### 新功能` / `### Bug 修复` / `### 其他改进`），版本段落需有 1-2 句总结
- Release notes 必须包含完整 CHANGELOG 内容，并引用对应 PR 编号
