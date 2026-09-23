# 跨环境与浏览器验证记录

本页保留各日期的验证证据；其中用例数量属于当时的历史快照，当前结果以重新运行测试为准。

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
