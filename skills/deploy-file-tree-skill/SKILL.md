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

- 启动门槛 **Python 3.8+**（`sys.version_info` 检测，低于即拒绝启动并打印当前/所需版本，不后台升级运行时；门槛是必要条件，实测环境为 Python 3.14.0，更低版本见证据矩阵"待验证"）；快照路径不存在/是目录时给可理解错误退出（退出码 2）；发行静态资源缺失时打印构建方法并降级运行（页面 503、API 可用）；
- 快照可在仓库之外（从旧机 SCP/SFTP 拉来的 JSON 直接浏览）；默认绑定 127.0.0.1，启动后打印访问地址，Ctrl+C 停止；
- 绝对只读：不写数据、不触发格式转换、不生成撤销历史；数据文件就是启动时指定的那份 tree.json。

## 跨环境浏览与 Python 边界（G20–G23）

**三层 Python 边界**（不要把"能复制 JSON"误认为"核心工具不需要 Python"）：

| 场景 | 是否需要 Python | 说明 |
| --- | --- | --- |
| 旧机维护 tree.json（核心工具 add/rm/check/query…） | **需要兼容 Python** | 核心工具是 Python 脚本；CentOS 7 系统解释器 3.6.8/2.7.5 实测拒绝运行（见下方证据矩阵），需按候选方案引入独立解释器 |
| 复制已有 JSON（SCP/SFTP 到现代机） | **不需要** | 纯文件传输，用用户自有工具；两种规范排版（紧凑/两空格缩进）均直接可浏览 |
| 现代机 GUI 浏览快照 | **需要 Python 3.8+ 与现代浏览器** | viewer.py 启动门槛；无需 Node、无需源码/`.git`/AGENTS.md |

**现代机完整复现路径**（第一版主要入口，#22 已实测）：

```bash
# 1) 旧机 → 现代机：用户自有 SCP/SFTP 工具复制快照（此步无需 Python）
scp user@oldhost:<仓库>/.agents/skills/file-tree/tree.json ~/snapshots/proj.json
# 2) 现代机：部署实例的查看器直接打开仓库外快照（无需 Node）
python .agents/skills/file-tree/scripts/viewer.py ~/snapshots/proj.json
# 3) 浏览器访问启动横幅打印的地址（默认 http://127.0.0.1:8618/）
```

**远端运行选项**（G20）：服务默认只监听 `127.0.0.1`，不对公网/局域网暴露；若希望运行在服务器、浏览在工作站，由用户自行配置 SSH 端口转发，工作站用现代浏览器访问：

```bash
ssh -L 8618:127.0.0.1:8618 user@server
# 隧道建立后：服务器上 viewer.py 照常默认监听 127.0.0.1，工作站浏览器访问 http://127.0.0.1:8618/
```

**CentOS 7 跑核心工具的解释器候选**（G23，未实测、标记待验证）：系统解释器过旧时，候选为 [python-build-standalone](https://gregoryszorc.com/docs/python-build-standalone/main/running.html) 的 `x86_64-unknown-linux-gnu` 系列发行包——其文档声明多数 Linux 目标最低 **glibc 2.17**（覆盖 RHEL/CentOS 7+、Debian 8+、Ubuntu 14.04+；riscv64 例外需 2.28），共享库依赖极少（libpthread/libdl/libutil/librt/libm/libc 等，Python 3.12 及更早的 crypt 模块另需 libcrypt.so.1）。选型要点与校验方式：

- **CPU 微架构选基线 `x86_64`（v1）**，不选 v2/v3/v4——后三者在不兼容 CPU 上"通常启动即崩溃"，基线最大兼容；
- 解包后先核对：`./python3 --version` 正常输出、`ldd ./python3` 无缺库（对照上述清单）；
- 再跑核心验证：`tree_tool_test.py` 全绿 + 真实仓库 `check --strict` 通过；
- 纪律：**不覆盖系统 Python、不替换系统 glibc、不要求 CentOS 7 本机构建前端**；未在本环境下载安装，候选不等于已支持。

### 跨环境与浏览器证据矩阵（2026-09-11）

**真浏览器端到端验收（V6–V9，#18–#21 编排层完成）**：ZCode 内置浏览器（UA `Mozilla/5.0 (Windows NT 10.0; Win64; x64) … ZCode/3.11.2 Chrome/146.0.7680.80 Electron/41.0.3`）直连 `python viewer.py <仓库外 tree.json> --port <N>`（服务端 CPython 3.14.0，Windows）。局限如实标注：滚动帧耗时/主观流畅度未量化（人工验收项）；仅 ZCode IAB 环境实测，未覆盖其他浏览器。

**已验证**（每条有命令与输出出处：V1–V5 见工单 #22 交付记录，V6–V9 见 #18–#21 验收记录）：

| # | 环境 | 操作与结果 |
| --- | --- | --- |
| V1 | 现代机 Windows 10 x64（10.0.26100）/ CPython 3.14.0（python.org 安装） | 仓库外快照（旧排版两空格缩进+LF，中文/三态 git-ignore/悬空 rel）→ 清洁 PATH 子进程（`shutil.which` 口径 node/npm/npx 均不可见）启动部署实例 viewer.py → 页面 200（发行静态资源）、目录中文序、详情正向 rel 悬空 `exists=false`、反向 backrefs、三态 `explicit/effective`、中文搜索 kw/tag、换紧凑排版 JSON 后 `POST /api/refresh` generation=2 新条目可见；浏览全程源 JSON sha256 不变 |
| V2 | 同上（契约测试 ViewerPreflightTest，5 用例） | Python 版本门槛：3.7.15 模拟 → 退出码 2+可理解消息；快照路径是目录 → 退出码 2+「不是文件」；静态资源缺失 → 降级提示（含 npm run build 指引）+页面 503+API 可用；当前解释器 3.14.0 过门槛 |
| V3 | 本仓库（回归） | `tree_tool_test.py` 226 用例、`viewer_test.py` 111 用例（含新增 5）、`deploy_test.py` 25 用例（含无 Node 部署全链）全部通过；`deploy .` 后实例 `tree.json` 字节未变 |
| V4 | CentOS-EDA VM（eda@192.168.72.141，真实 VM 非容器）只读探查 | CentOS Linux 7（rpm el7_9）、原生内核 3.10.0-1160.71.1.el7.x86_64、glibc 2.17-326.el7_9、x86_64；系统解释器仅 python3=3.6.8 与 python=2.7.5（无其他现代解释器） |
| V5 | 同 VM，/tmp 固定样本实测（用完即删） | sha256 校验一致上传 tree_tool.py+样本后：`python3 query --json` → `SyntaxError: future feature annotations is not defined`（`from __future__ import annotations` 需 3.7+）；`python`（2.7.5）→ `SyntaxError: Non-ASCII character`。**结论：CentOS 7 系统解释器无法运行核心工具** |
| V6 | 真浏览器·基础浏览（#18 验收，快照含中文/三态 git-ignore/悬空 rel/空目录） | 浏览器展开目录、点击文件条目、右栏详情渲染（完整路径、多行转义 detail、悬空 rel「无法定位」、tags、git-ignore 三态）；浏览前后快照 sha256 `56f0667f…23c2e8` 不变 |
| V7 | 真浏览器·组合搜索与关联（#19 验收） | 组合搜索（关键词+标签）命中渲染；点击命中定位回树（祖先展开+选中）；详情已知关联跳转、「被引用 ←」反向分区正确；悬空关联不可点击；空结果文案与重置正常；快照字节不变 |
| V8 | 真浏览器·大样本虚拟化与刷新三态（#20 验收，10 万样本合成 110013 条目） | 首屏挂载 13 行 treeitem / 全页 132 个 DOM 元素；展开目录后滚动顶/中/底行窗口移动（首行 .gitignore → mod0494 → mod0979），挂载行数恒定 32–42（远小于 110013，G14 实证）；键盘 ↓↓→↓ 完成选择与进入子级；面包屑显示完整路径；刷新三态：成功（选中保留）/失败（非法 JSON，提示「当前仍显示旧数据（未刷新）」）/恢复（失败提示隐藏） |
| V9 | 真浏览器·部署实例发行资源（#21 验收，部署实例、dist/viewer/ 发行资源、无 frontend/build） | 页面由受控 assets 加载（`./assets/index-*.js`，hash 随构建变化，不在此钉值），搜索交互正常；快照字节不变 |

**待验证**（不宣称已支持）：

| # | 事项 | 缺口原因 | 解锁条件 |
| --- | --- | --- | --- |
| P1 | CentOS 7 以 python-build-standalone 独立解释器运行核心工具 | 本票未下载安装任何发行包（候选+校验方式已列） | 在 CentOS-EDA VM 或等价环境解包候选（x86_64 基线）跑 `tree_tool_test.py` + `check` |
| P2 | Python 3.8–3.13 运行 viewer 与核心工具 | 门槛 3.8 是启动拦截值非兼容承诺；实测环境仅 3.14.0 | 用对应版本解释器实测全套契约测试 |
| P3 | 其他旧发行版（Debian 8/Ubuntu 14.04 等） | 未接触此类环境 | 有真实环境时按 V4/V5 流程采集 |
| P4 | 旧机本机浏览器操作 GUI | 范围外（G22：不要求 CentOS 7 旧浏览器） | 不计划验证 |

## 部署语义（镜像同步）

- **首次部署**：复制固定清单九件（核心四件套 + 查看器五件）与 `dist/viewer/` 静态资源 → 初始化空 `tree.json`（新紧凑规范格式）→ 渲染 AGENTS.md 标记块（无文件则生成骨架）→ 自动 `check` 自检。
- **升级部署**（目标已有技能）：以 dist 为准覆盖公用文件，**清理** dist 中已不存在的旧版本残留文件（含过期 hash 的 viewer 静态资源）与 `__pycache__`、回收空目录——废弃文件的升级能真正到位；viewer 现行资源在清单内不会被误删。注意：清理以 dist 清单为准，技能目录内**用户自放的额外文件也会在升级时被清理**（自留内容请放技能目录之外），数据与历史除外（见下条）。
- **永不触碰数据与历史**：目标仓库的 `tree.json`（文件树数据）与 `.history.json`（本机撤销历史，或位于目标仓库 git 私有区）不被覆盖、不被清理。升级时对 `tree.json` 的有效性判定与 `check` 同源：新旧两种规范排版（紧凑 / 旧两空格缩进）均为有效数据，**不重写任何字节**（GUI 资源随技能安装同样不提前转换，#15 延迟转换语义），留待下次正常写入时自动转换为新紧凑格式；仅结构不规范（如缺 `kind` 派生字段）才做规范化结构迁移（数据语义不变，直接输出新紧凑格式）。撤销历史位置随目标环境自动判定（git 私有区优先，非 git 退化技能目录，仓库后初始化时自动收敛）。
- 部署后自检（check）失败则整体报错，不留半成品状态。

## 升级流程（技能迭代时）

1. 在主仓库（Vibe-Sketchpad-Coding）`skills/deploy-file-tree-skill/dist/` 直接修改 file-tree 技能并验证（`dist/scripts/tree_tool_test.py` 全绿；自举用例在无数据环境自动跳过，部署后在目标仓库 `check --strict` 复核）；前端源码改动则执行 `frontend` 下 `npm run build` 重组装 `dist/viewer/` 发行快照；
2. 提交主仓库——dist 即开发主线，不再经 update-dist 中转；
3. 对每个已部署仓库执行 `deploy <目标仓库>`——数据不动，只同步代码、说明与发行资源；
4. 同步本机使用副本：复制主仓库的母体文件（SKILL.md、scripts/）与 dist 公用内容（含 `viewer/`）到 `~/.agents/skills/deploy-file-tree-skill/`，保持调用入口与主线一致。

> 旧主线（QuotaTray `.agents/skills/file-tree/`）自批量命令版本（PR #47 合并）起降级为普通部署点。update-dist 保留应急语义：从任意部署实例提取四件套回收散落改动。

## 部署后引导（转告目标仓库的使用者）

新版 GUI 的侧栏拖拽限位、抽屉80%层级浏览、根概览与搜索返回规则见 [README](README.md#文件树阅读与层级浏览)。Windows / Python 3.13.9 / Edge 152 的离线发行、真实交互和大样本结果见 [验收报告](docs/gui-redesign-verification.md)；这组证据不代替旧 Linux 运行时兼容性验证。

- 录入条目：`python .agents/skills/file-tree/scripts/tree_tool.py add <path> -d "一句话" --detail "完整描述"`
- 录入目录（整目录粗粒度收录）：同命令加 `--dir`，批量清单条目写 `"dir": true`；磁盘目录未声明时脚本也会自动识别并提示
- 全量校验：`... check --strict`（新仓库会提示 git 文件未收录，属正常，逐条 add 即可）
- 撤销误操作：`... undo` / `redo` / `history`
- 浏览快照（GUI，无需 Node）：`python .agents/skills/file-tree/scripts/viewer.py <tree.json>`，替换 JSON 后页面刷新即可

契约测试：`python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy_test.py`（含无 Node 启动全链用例）
