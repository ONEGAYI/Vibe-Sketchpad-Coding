# file-tree — 文件树维护与查询技能

「file-tree」技能的入库副本：以 `tree.json` 为项目文件树的唯一数据源，以 `scripts/tree_tool.py` 为唯一维护脚本，把简版文件树与标签词表两个标记块渲染到目标仓库的 AGENTS.md。

> 本目录来自 [deploy-file-tree-skill] 发行快照（dist 公用四件套），**原样入库、未做改写**。它是合集成员（源码形态），不是对本仓库的部署——没有 `tree.json`，也不接管本仓库的 AGENTS.md。要把技能装进某个仓库，使用 deploy-file-tree-skill 的 `deploy` 命令。

## 用途

- 收录仓库文件条目：一句话简介（`desc`）、完整描述（`detail`）、相关成对文件（`rel`）、受控标签（`tags`）
- 提交前 `check --strict` 全量校验：规范形态、磁盘对照、AGENTS.md 产物一致性
- 误操作可 `undo` / `redo`，历史存于 git 私有区，天然不入库、clone 不携带

## 用法

文档内的脚本路径按部署约定写作 `.agents/skills/file-tree/`（`deploy` 的默认安装位置），在本仓库对应 `skills/file-tree/`。

```bash
# 契约测试（沙箱模式，临时目录构造数据，不触仓库）
python skills/file-tree/scripts/tree_tool_test.py

# 部署到目标仓库后，在目标仓库内使用（节选）：
python .agents/skills/file-tree/scripts/tree_tool.py add <path> -d "一句话" --detail "完整描述"
python .agents/skills/file-tree/scripts/tree_tool.py check --strict
python .agents/skills/file-tree/scripts/tree_tool.py undo
```

完整命令速查与条目字段语义见 [SKILL.md](SKILL.md)。

## 技术栈

- Python 3 标准库，无第三方依赖
- unittest 契约测试（72 用例；自举用例在无 `tree.json` 的环境中自动跳过）
