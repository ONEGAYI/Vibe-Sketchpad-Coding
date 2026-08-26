# VibeSketchpadCoding

自制 vibe coding 小工具合集（monorepo）。每个小工具独立一个子目录，自成一体、独立可运行。

## 文件树

```
VibeSketchpadCoding/
├── AGENTS.md      # 本文件：agent 通用规则单一事实源（项目说明、文件树、规范）
├── CLAUDE.md      # 通过 @AGENTS.md 导入主文件，仅附加 Claude 专属补充
├── .gitignore     # 通用忽略规则（各工具子目录可按需追加自有条目）
└── skills/        # 技能源码成员目录（母体即开发主线，非对本仓库的部署实例）
    └── deploy-file-tree-skill/    # 技能母体：把 file-tree 技能部署/升级到任意仓库
        ├── README.md              # 工具说明：用途、用法、技术栈
        ├── SKILL.md               # 技能主入口：结构、命令、部署语义、升级流程
        ├── agents/openai.yaml     # Codex 元数据
        ├── scripts/
        │   ├── deploy.py          # deploy / update-dist 命令实现
        │   └── deploy_test.py     # 契约测试（沙箱目标仓库）
        └── dist/                  # file-tree 技能开发主线兼发行快照（公用四件套，部署即复制）
            ├── SKILL.md               # file-tree 技能主入口：约定、命令、字段
            ├── agents/openai.yaml     # Codex 元数据
            └── scripts/
                ├── tree_tool.py       # file-tree 唯一维护脚本
                └── tree_tool_test.py  # file-tree 契约测试
```

> 新增/删除工具时必须同步维护此文件树，摘要描述以"刚好覆盖文件内容"为准。

## 组织约定

- 每个小工具一个子目录，命名用 kebab-case（如 `todo-quick/`）
- 工具子目录内自带 `README.md`，说明用途、用法、技术栈
- 依赖不提升到根目录，保持各工具独立；根目录只放规则文件与文档
- 技能源码统一放 `skills/` 目录，同样一技能一子目录（kebab-case）、自带 `README.md`；入库的是技能快照原样副本，不接管本仓库自身的文件树

## 提交规范

- 提交信息使用**中文**，格式 `类型: 简述`，类型：`feat` / `fix` / `refactor` / `docs` / `chore` / `style` / `perf` / `test`
- 正文必需：说明做了什么、为什么做；涉及多模块时分条列出变更内容
- 关联 Issue/PR 时在正文末尾标注（如 `Close #123`）

## 发布规范

- 版本归纳遵循 Keep a CHANGELOG 格式（`### 新功能` / `### Bug 修复` / `### 其他改进`），版本段落需有 1-2 句总结
- Release notes 必须包含完整 CHANGELOG 内容，并引用对应 PR 编号
