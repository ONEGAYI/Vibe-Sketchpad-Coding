# deploy-file-tree-skill — file-tree 技能部署器

「deploy-file-tree-skill」技能母体的入库副本：把 file-tree 技能（`dist/` 公用四件套快照）部署或升级到任意指定仓库，并在源仓库迭代后刷新快照。

> 本目录是技能母体的原样快照，未做改写。`dist/` 在这里虽然叫 dist，但它是**发行快照（源码形态）而非构建产物**——仓库 `.gitignore` 已为此加了否定规则。母体不接管本仓库的文件树；本仓库也未部署 file-tree 技能。

## 用途

- **deploy**：把 file-tree 技能装进目标仓库（默认 `.agents/skills/file-tree/`）。首次部署复制四件套、初始化空 `tree.json`、渲染 AGENTS.md 标记块；已有技能时为升级模式——以 dist 为准镜像同步，清理旧残留文件与 `__pycache__`
- **update-dist**：从源仓库（开发主线）提取四件套刷新本技能的 dist 快照
- 数据与历史保护：目标仓库的 `tree.json` 与撤销历史永不覆盖、永不清理；部署后自检失败则整体报错，不留半成品

## 用法

脚本以自身位置相对定位 `dist/`（`Path(__file__).parents[1]`），入库后从本仓库运行同样有效；SKILL.md 中的 `~/.agents/skills/deploy-file-tree-skill/` 是本机安装位置写法，在本仓库对应 `skills/deploy-file-tree-skill/`。

```bash
# 契约测试（沙箱目标仓库，不触真实仓库）
python skills/deploy-file-tree-skill/scripts/deploy_test.py

# 部署 / 升级到某仓库
python skills/deploy-file-tree-skill/scripts/deploy.py deploy <目标仓库> [--skill-dir .agents/skills/file-tree]

# 从源仓库刷新 dist 快照
python skills/deploy-file-tree-skill/scripts/deploy.py update-dist <源仓库> [--source-dir .agents/skills/file-tree]
```

部署语义、升级流程与部署后引导详见 [SKILL.md](SKILL.md)；dist 内四件套的命令与字段语义见 [dist/SKILL.md](dist/SKILL.md)。

## 技术栈

- Python 3 标准库，无第三方依赖
- unittest 契约测试（10 用例，沙箱目标仓库模式）
