# deploy-file-tree-skill — file-tree 技能部署器

「deploy-file-tree-skill」技能母体本体：把 file-tree 技能（`dist/` 公用内容：核心脚本、只读 GUI 查看器与其发行静态资源）部署或升级到任意指定仓库。

> **本目录即 file-tree 技能的开发主线**——迭代直接改 `dist/` 并在本仓库提交，`~/.agents/skills/deploy-file-tree-skill/` 是本机使用副本（主线变更后复制同步）。`dist/` 虽名为 dist，但它是**源码形态的快照而非构建缓存**——仓库 `.gitignore` 已为此加否定规则；其中 `dist/viewer/` 是受控入库的前端发行资源（构建组装产物，G18），`frontend/build/` 等构建暂存被技能根 `.gitignore` 排除。本仓库自身也已部署 file-tree 技能（`.agents/skills/file-tree/`，tree.json 数据私有），与 `skills/` 下的母体快照互不接管。

## 用途

- **deploy**：把 file-tree 技能装进目标仓库（默认 `.agents/skills/file-tree/`）。首次部署复制固定清单九件与 `dist/viewer/` 静态资源、初始化空 `tree.json`（新紧凑规范格式）、渲染 AGENTS.md 标记块；已有技能时为升级模式——以 dist 为准镜像同步，清理旧残留文件（含过期 hash 静态资源）与 `__pycache__`
- **update-dist**：应急回收——从任意仓库的部署实例提取固定清单刷新 dist（散落改动未主线化时用，常规迭代不走此命令）
- 数据与历史保护：目标仓库的 `tree.json` 与撤销历史永不覆盖、永不清理；`tree.json` 为规范旧排版（两空格缩进）时升级保留原字节不改写（GUI 资源随技能安装同样不提前转换），下次正常写入自动转换为新紧凑格式，仅结构不规范（如缺派生 `kind`）才做规范化迁移；部署后自检失败则整体报错，不留半成品
- 查看器发行（G16/G18）：`frontend/` 下 `npm run build` 一键完成 vite 构建与 `dist/viewer/` 组装（幂等镜像、外链质量门、旧 hash 清理）；**目标机器运行 GUI 只需 Python 与浏览器，无需 Node / npm install / vite build**

## 用法

脚本以自身位置相对定位 `dist/`（`Path(__file__).parents[1]`），入库后从本仓库运行同样有效；SKILL.md 中的 `~/.agents/skills/deploy-file-tree-skill/` 是本机安装位置写法，在本仓库对应 `skills/deploy-file-tree-skill/`。

```bash
# 契约测试（沙箱目标仓库，不触真实仓库；含无 Node 启动全链用例）
python skills/deploy-file-tree-skill/scripts/deploy_test.py

# 部署 / 升级到某仓库
python skills/deploy-file-tree-skill/scripts/deploy.py deploy <目标仓库> [--skill-dir .agents/skills/file-tree]

# 从源仓库刷新 dist 快照
python skills/deploy-file-tree-skill/scripts/deploy.py update-dist <源仓库> [--source-dir .agents/skills/file-tree]

# 重建查看器发行快照（需现代构建机的 Node；目标运行不需要）
cd skills/deploy-file-tree-skill/frontend && npm install && npm run build
```

部署语义、升级流程、发行构建与部署后引导详见 [SKILL.md](SKILL.md)；dist 内技能的命令与字段语义见 [dist/SKILL.md](dist/SKILL.md)。

## 技术栈

- Python 3 标准库，无第三方依赖
- 前端（仅构建期）：React 18 + TypeScript + Vite 5，依赖由 package-lock.json 锁定
- unittest 契约测试（25 用例，沙箱目标仓库模式）
