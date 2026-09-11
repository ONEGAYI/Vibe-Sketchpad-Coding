# deploy-file-tree-skill — file-tree 技能部署器

「deploy-file-tree-skill」技能母体本体：把 file-tree 技能（`dist/` 公用四件套）部署或升级到任意指定仓库。

> **本目录即 file-tree 技能的开发主线**——迭代直接改 `dist/` 四件套并在本仓库提交，`~/.agents/skills/deploy-file-tree-skill/` 是本机使用副本（主线变更后复制同步）。`dist/` 虽名为 dist，但它是**源码形态的快照而非构建产物**——仓库 `.gitignore` 已为此加否定规则。本仓库自身也已部署 file-tree 技能（`.agents/skills/file-tree/`，tree.json 数据私有），与 `skills/` 下的母体快照互不接管。

## 用途

- **deploy**：把 file-tree 技能装进目标仓库（默认 `.agents/skills/file-tree/`）。首次部署复制四件套、初始化空 `tree.json`（新紧凑规范格式）、渲染 AGENTS.md 标记块；已有技能时为升级模式——以 dist 为准镜像同步，清理旧残留文件与 `__pycache__`
- **update-dist**：应急回收——从任意仓库的部署实例提取四件套刷新 dist（散落改动未主线化时用，常规迭代不走此命令）
- 数据与历史保护：目标仓库的 `tree.json` 与撤销历史永不覆盖、永不清理；`tree.json` 为规范旧排版（两空格缩进）时升级保留原字节不改写，下次正常写入自动转换为新紧凑格式，仅结构不规范（如缺派生 `kind`）才做规范化迁移；部署后自检失败则整体报错，不留半成品

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
- unittest 契约测试（15 用例，沙箱目标仓库模式）
