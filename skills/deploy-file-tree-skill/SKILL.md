---
name: deploy-file-tree-skill
description: 把 file-tree 技能（文件树唯一数据源 + 唯一维护脚本）部署到任意指定仓库。当用户说"把这个文件树技能部署/安装到某仓库"、"升级某仓库的 file-tree 技能"、"提取/更新发行版快照"时使用。dist/ 是公用四件套快照，部署即复制（无需压缩解包），升级为镜像同步：除目标仓库的 tree.json 数据与本机撤销历史外一切以 dist 为准，废弃文件清理到位。
---

# 部署 file-tree 技能

## 结构

```
deploy-file-tree-skill/
├── SKILL.md               # 本文件
├── agents/openai.yaml     # Codex 元数据
├── scripts/
│   ├── deploy.py          # deploy / update-dist 命令
│   └── deploy_test.py     # 契约测试（沙箱目标仓库）
└── dist/                  # file-tree 技能发行版快照（公用内容，微缩于此）
    ├── SKILL.md           # 技能主入口（通用说明）
    ├── agents/openai.yaml
    └── scripts/
        ├── tree_tool.py       # 唯一维护脚本
        └── tree_tool_test.py  # 契约测试
```

dist 只含**公用四件套**，不含任何仓库数据——`tree.json`（文件树数据）、`.history.json`（本机撤销历史）、AGENTS.md（目标仓库的规则文档）都属于各仓库私有。

## 命令

```bash
# 部署 / 升级（目标仓库路径；默认装到 .agents/skills/file-tree/）
python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy.py deploy <目标仓库> [--skill-dir .agents/skills/file-tree]

# 从源仓库（开发主线）提取四件套刷新 dist 快照
python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy.py update-dist <源仓库> [--source-dir .agents/skills/file-tree]
```

## 部署语义（镜像同步）

- **首次部署**：复制四件套 → 初始化空 `tree.json`（脚本规范形态）→ 渲染 AGENTS.md 标记块（无文件则生成骨架）→ 自动 `check` 自检。
- **升级部署**（目标已有技能）：以 dist 为准覆盖公用文件，**清理** dist 中已不存在的旧版本残留文件与 `__pycache__`、回收空目录——废弃文件的升级能真正到位。
- **永不触碰数据与历史**：目标仓库的 `tree.json`（文件树数据）与 `.history.json`（本机撤销历史，或位于目标仓库 git 私有区）不被覆盖、不被清理；升级时仅允许对 `tree.json` 做规范化结构迁移（如补 `kind` 派生字段），数据语义不变。撤销历史位置随目标环境自动判定（git 私有区优先，非 git 退化技能目录，仓库后初始化时自动收敛）。
- 部署后自检（check）失败则整体报错，不留半成品状态。

## 升级流程（技能迭代时）

1. 在源仓库（开发主线，如 QuotaTray）修改 file-tree 技能并验证（`tree_tool_test.py` 全绿 + `check --strict`）；
2. `update-dist <源仓库>` 刷新快照；
3. 对每个已部署仓库执行 `deploy <目标仓库>`——数据不动，只同步代码与说明。

## 部署后引导（转告目标仓库的使用者）

- 录入条目：`python .agents/skills/file-tree/scripts/tree_tool.py add <path> -d "一句话" --detail "完整描述"`
- 全量校验：`... check --strict`（新仓库会提示 git 文件未收录，属正常，逐条 add 即可）
- 撤销误操作：`... undo` / `redo` / `history`

契约测试：`python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy_test.py`
