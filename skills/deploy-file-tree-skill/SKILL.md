---
name: deploy-file-tree-skill
description: 把 file-tree 技能（文件树唯一数据源 + 唯一维护脚本 + 只读 GUI 查看器）部署到任意指定仓库。当用户说"把这个文件树技能部署/安装到某仓库"、"升级某仓库的 file-tree 技能"、"提取/更新发行版快照"时使用。dist/ 是公用内容快照（核心脚本 + 查看器脚本与 viewer/ 发行静态资源）兼开发主线（主仓库 Vibe-Sketchpad-Coding），部署即复制（无需压缩解包），升级为镜像同步：除目标仓库的 tree.json 数据与本机撤销历史外一切以 dist 为准，废弃文件清理到位；目标机器运行 GUI 只需 Python，无需 Node。
---

# 部署 file-tree 技能

## 结构

```
deploy-file-tree-skill/
├── SKILL.md               # 本文件
├── agents/openai.yaml     # Codex 元数据
├── scripts/
│   ├── deploy.py          # deploy / update-dist 命令
│   ├── deploy_test.py     # 契约测试（沙箱目标仓库）
│   └── assemble_viewer.py # 查看器发行组装（frontend/build → dist/viewer）
├── frontend/              # 查看器前端源码（React + TypeScript + Vite；构建缓存不入库）
│   ├── package.json / package-lock.json   # 依赖清单与锁文件（入库，固定依赖）
│   └── src/ …             # 前端源码与组件测试
└── dist/                  # file-tree 技能开发主线兼发行快照（公用内容，微缩于此）
    ├── SKILL.md           # 技能主入口（通用说明）
    ├── agents/openai.yaml
    ├── scripts/
    │   ├── tree_tool.py       # 唯一维护脚本
    │   ├── tree_tool_test.py  # 契约测试
    │   ├── viewer.py          # 只读查看器 HTTP 入口（标准库，无需 Node）
    │   ├── viewer_core.py     # 查看器内存快照模型
    │   ├── viewer_test.py     # 查看器契约测试
    │   ├── gen_viewer_sample.py  # 大样本合成生成器（性能实测 fixture）
    │   └── bench_viewer.py    # 查看器服务端性能基准
    └── viewer/            # 受控发行静态资源（G18：构建组装入库，随技能部署）
        ├── index.html
        └── assets/        # Vite 哈希产物（JS/CSS，相对引用、不依赖 CDN）
```

dist 只含**公用内容**（固定清单九件 + `viewer/` 静态资源动态清单），不含任何仓库数据——`tree.json`（文件树数据）、`.history.json`（本机撤销历史）、AGENTS.md（目标仓库的规则文档）都属于各仓库私有。

**开发主线在此**：file-tree 技能的迭代直接修改主仓库（Vibe-Sketchpad-Coding）`skills/deploy-file-tree-skill/dist/` 下的内容；脚本以自身位置相对定位 dist，主仓库副本与本机安装副本（`~/.agents/skills/deploy-file-tree-skill/`）均可运行 deploy。

## 命令

```bash
# 部署 / 升级（目标仓库路径；默认装到 .agents/skills/file-tree/）
python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy.py deploy <目标仓库> [--skill-dir .agents/skills/file-tree]

# 应急回收：从任意仓库的部署实例提取固定清单刷新 dist（散落改动未主线化时用，非常规流程）
python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy.py update-dist <源仓库> [--source-dir .agents/skills/file-tree]
```

## 查看器发行快照的构建与组装（G16/G18）

**构建与运行的依赖是分开的**：构建前端需要现代构建机的 Node（npm install + vite build）；部署后的目标机器**只需 Python 3 与现代浏览器**——发行页面资源随技能入库与部署，目标无需 npm install、无需 vite build、无需 Node 在 PATH。

```bash
# 从干净源码复现发行快照（在 skills/deploy-file-tree-skill/ 下）：
cd frontend
npm install        # 依赖由 package-lock.json 锁定
npm run build      # = vite build && python ../scripts/assemble_viewer.py
```

- `vite build` 产物先落 `frontend/build/`（技能根 .gitignore 排除，不入库）；
- `assemble_viewer.py` 把它镜像组装到 `dist/viewer/`（受控入库），同步清理旧 hash 资源，并做质量门校验：`index.html` 不得有外链（src/href 指向 CDN 即拒绝）、引用资源必须存在；组装幂等，可重复执行；
- `dist/viewer/` 是发行资源不是缓存，**必须入库**；技能根 .gitignore 只排除构建暂存（`frontend/build/`、`node_modules/`、`.vite/`、`*.tsbuildinfo` 等），母体 `dist/` 严禁笼统忽略；
- 前端只在源码变更时需要重新构建；**替换 tree.json 只需在页面点刷新**（`POST /api/refresh` 重读同一路径），不必重新构建或重启。

## 部署后启动查看器（目标机器，无 Node）

```bash
python .agents/skills/file-tree/scripts/viewer.py <tree.json 路径> [--port N] [--host H]
```

- 快照可在仓库之外（从旧机 SCP/SFTP 拉来的 JSON 直接浏览）；默认绑定 127.0.0.1，启动后打印访问地址，Ctrl+C 停止；
- 绝对只读：不写数据、不触发格式转换、不生成撤销历史；数据文件就是启动时指定的那份 tree.json。

## 部署语义（镜像同步）

- **首次部署**：复制固定清单九件（核心四件套 + 查看器五件）与 `dist/viewer/` 静态资源 → 初始化空 `tree.json`（新紧凑规范格式）→ 渲染 AGENTS.md 标记块（无文件则生成骨架）→ 自动 `check` 自检。
- **升级部署**（目标已有技能）：以 dist 为准覆盖公用文件，**清理** dist 中已不存在的旧版本残留文件（含过期 hash 的 viewer 静态资源）与 `__pycache__`、回收空目录——废弃文件的升级能真正到位；viewer 现行资源在清单内不会被误删。
- **永不触碰数据与历史**：目标仓库的 `tree.json`（文件树数据）与 `.history.json`（本机撤销历史，或位于目标仓库 git 私有区）不被覆盖、不被清理。升级时对 `tree.json` 的有效性判定与 `check` 同源：新旧两种规范排版（紧凑 / 旧两空格缩进）均为有效数据，**不重写任何字节**（GUI 资源随技能安装同样不提前转换，#15 延迟转换语义），留待下次正常写入时自动转换为新紧凑格式；仅结构不规范（如缺 `kind` 派生字段）才做规范化结构迁移（数据语义不变，直接输出新紧凑格式）。撤销历史位置随目标环境自动判定（git 私有区优先，非 git 退化技能目录，仓库后初始化时自动收敛）。
- 部署后自检（check）失败则整体报错，不留半成品状态。

## 升级流程（技能迭代时）

1. 在主仓库（Vibe-Sketchpad-Coding）`skills/deploy-file-tree-skill/dist/` 直接修改 file-tree 技能并验证（`dist/scripts/tree_tool_test.py` 全绿；自举用例在无数据环境自动跳过，部署后在目标仓库 `check --strict` 复核）；前端源码改动则执行 `frontend` 下 `npm run build` 重组装 `dist/viewer/` 发行快照；
2. 提交主仓库——dist 即开发主线，不再经 update-dist 中转；
3. 对每个已部署仓库执行 `deploy <目标仓库>`——数据不动，只同步代码、说明与发行资源；
4. 同步本机使用副本：复制主仓库的母体文件（SKILL.md、scripts/）与 dist 公用内容（含 `viewer/`）到 `~/.agents/skills/deploy-file-tree-skill/`，保持调用入口与主线一致。

> 旧主线（QuotaTray `.agents/skills/file-tree/`）自批量命令版本（PR #47 合并）起降级为普通部署点。update-dist 保留应急语义：从任意部署实例提取四件套回收散落改动。

## 部署后引导（转告目标仓库的使用者）

- 录入条目：`python .agents/skills/file-tree/scripts/tree_tool.py add <path> -d "一句话" --detail "完整描述"`
- 录入目录（整目录粗粒度收录）：同命令加 `--dir`，批量清单条目写 `"dir": true`；磁盘目录未声明时脚本也会自动识别并提示
- 全量校验：`... check --strict`（新仓库会提示 git 文件未收录，属正常，逐条 add 即可）
- 撤销误操作：`... undo` / `redo` / `history`
- 浏览快照（GUI，无需 Node）：`python .agents/skills/file-tree/scripts/viewer.py <tree.json>`，替换 JSON 后页面刷新即可

契约测试：`python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy_test.py`（含无 Node 启动全链用例）
