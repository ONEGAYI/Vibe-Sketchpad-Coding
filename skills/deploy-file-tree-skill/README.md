# deploy-file-tree-skill — file-tree 技能部署器

「deploy-file-tree-skill」技能母体本体：把 file-tree 技能（`dist/` 公用内容：核心脚本、只读 GUI 查看器与其发行静态资源）部署或升级到任意指定仓库。

> **本目录即 file-tree 技能的开发主线**——迭代直接改 `dist/` 并在本仓库提交，`~/.agents/skills/deploy-file-tree-skill/` 是本机使用副本（主线变更后复制同步）。`dist/` 虽名为 dist，但它是**源码形态的快照而非构建缓存**——仓库 `.gitignore` 已为此加否定规则；其中 `dist/viewer/` 是受控入库的前端发行资源（构建组装产物，G18），`frontend/build/` 等构建暂存被技能根 `.gitignore` 排除。本仓库自身也已部署 file-tree 技能（`.agents/skills/file-tree/`，tree.json 数据私有），与 `skills/` 下的母体快照互不接管。

## 用途

- **deploy**：把 file-tree 技能装进目标仓库（默认 `.agents/skills/file-tree/`）。首次部署复制固定清单九件与 `dist/viewer/` 静态资源、初始化空 `tree.json`（新紧凑规范格式）、渲染 AGENTS.md 标记块；已有技能时为升级模式——以 dist 为准镜像同步，清理旧残留文件（含过期 hash 静态资源）与 `__pycache__`
- **update-dist**：应急回收——从任意仓库的部署实例提取固定清单刷新 dist（散落改动未主线化时用，常规迭代不走此命令）
- 数据与历史保护：目标仓库的 `tree.json` 与撤销历史永不覆盖、永不清理；`tree.json` 为规范旧排版（两空格缩进）时升级保留原字节不改写（GUI 资源随技能安装同样不提前转换），下次正常写入自动转换为新紧凑格式，仅结构不规范（如缺派生 `kind`）才做规范化迁移；部署后自检失败则整体报错，不留半成品
- 查看器发行（G16/G18）：`frontend/` 下 `npm run build` 一键完成 vite 构建与 `dist/viewer/` 组装（幂等镜像、外链质量门、旧 hash 清理）；**目标机器运行 GUI 只需 Python 3.8+（启动门槛）与现代浏览器，无需 Node / npm install / vite build**
- 跨环境路径（G20–G23）：旧机 SCP/SFTP 复制 JSON（无需 Python）→ 现代机 viewer.py 浏览；旧机运行核心工具需兼容 Python（CentOS 7 系统 3.6.8 实测拒绝运行，独立解释器候选与证据矩阵见 SKILL.md"跨环境浏览与 Python 边界"节）

## 文件树阅读与层级浏览

顶部保留搜索、工具与面包屑；选择条目后阅读职责、完整描述和双向关联。原始标志默认折叠，展开仍可查看 `git-ignore` 的显式值和继承结果。根面包屑返回概览并进入前进/后退历史，根概览不能复制路径。

普通侧栏默认 **310px**。拖动分隔条，或聚焦后按左右键每次调整 **10px**；范围为 **240px 至 min(440px, 正文可用宽的46%)**。正文可用宽不含9px分隔条。缩小窗口只限制显示宽度，重新放大恢复此前首选宽度。

点击关闭抽屉图标旁的 **层级浏览**，侧栏展开到可用宽的 **80%**，切换为逐列选择目录；拖动不会进入此模式。列内纵向滚动、多列局部横向滚动，右侧展示摘要。点击 **收起层级** 或 **收起并阅读全文**，恢复普通宽度和当前选中。可用宽不超过600px时上下排列，抽屉按钮仍可切换视图。

搜索通过回车或按钮提交。折叠筛选保留输入，切换布局保留搜索结果、页码和未提交草稿；命中定位后可用 **返回搜索** 回到原页。刷新重读同一快照，保留有效选择和布局；若有搜索结果则按原条件重新查询第一页。

布局偏好只在本次页面会话中保存。浏览、展开和调宽不修改 `tree.json`，也不产生核心工具的撤销记录。2026-09-12 的真实浏览器、十万条目和离线部署证据见 [GUI 改造验收报告](docs/gui-redesign-verification.md)。

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
- unittest 契约测试（部署器32用例、查看器123用例；沙箱目标仓库模式）
