# Vibe-Sketchpad-Coding

自制 vibe coding 小工具合集（monorepo）。每个小工具独立一个子目录，自成一体、独立可运行。

## 目录结构

```
Vibe-Sketchpad-Coding/
├── .agents/     # 本仓库 agent 技能部署目录
│   └── skills/file-tree/   # file-tree 技能部署实例（维护本仓库文件树）
├── extensions/  # 宿主扩展成员目录（按平台分组）
│   └── obsidian/           # Obsidian 扩展：本地小插件 + 目录索引
├── prompts/     # 提示词工具成员目录（直接投给对话模型使用）
├── skills/      # 技能源码成员目录（agent 技能母体快照）
├── AGENTS.md    # agent 规则单一事实源（含文件树与标签词表渲染块）
├── CLAUDE.md    # 通过 @AGENTS.md 导入主文件，仅附加 Claude 专属补充
└── README.md    # 本文件
```

> 完整到文件粒度的文件树以 [AGENTS.md](AGENTS.md) 中的渲染块为准（由 [file-tree 技能](.agents/skills/file-tree/SKILL.md)维护，`tree.json` 为唯一数据源）。

## 目录职责

- **skills/** — agent 技能（SKILL.md 格式，由 agent 按需加载触发）的源码母体；入库为快照原样副本，`~/.agents/skills/` 下的同名目录是本机使用副本
- **prompts/** — 直接投给对话模型的提示词模板与工具；与 `skills/` 分工在于消费方是人/对话，而非 agent 自动触发
- **extensions/** — 宿主扩展类工具，按平台分组（首个平台 `obsidian/`，内含本地小插件与外部插件目录索引）
- **.agents/** — 本仓库自身部署的 agent 技能（当前仅 file-tree），与 `skills/` 下的母体快照互不接管

## 约定

- 一工具一子目录，命名 kebab-case，自带 `README.md` 说明用途、用法、技术栈
- 依赖不提升到根目录，保持各工具独立；根目录只放规则文件与文档
- 提交与发布的详细规范见 [AGENTS.md](AGENTS.md)
