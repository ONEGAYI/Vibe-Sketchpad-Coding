"""deploy-file-tree-skill：把 file-tree 技能部署到任意仓库。

dist/ 是 file-tree 技能的发行版快照——公用核心五件套
（SKILL.md / references/views.md / agents/openai.yaml /
scripts/tree_tool.py / scripts/tree_tool_test.py）、
GUI 查看器五件（viewer.py / viewer_core.py / viewer_test.py /
gen_viewer_sample.py / bench_viewer.py）与受控发行静态资源 dist/viewer/
（index.html + assets/，前端构建组装入库，G18），不含任何仓库数据。
部署 = 镜像复制上述清单到目标仓库 .agents/skills/file-tree/（viewer 静态
资源按 dist 实际内容动态清点，旧 hash 资源随升级清理不残留），首跑初始化
空 tree.json（新紧凑规范格式）并渲染 AGENTS.md 标记块，随后自动 check 自检；
目标已有技能时是升级模式：镜像同步——以 dist 为准覆盖，清理 dist 中不存在
的旧版本残留与 __pycache__，仅 tree.json 与本机撤销历史（.history.json）
永不动。tree.json 的升级判定与 check 同源（canonical_form，一次判定返回
具体形态）：新旧两种规范排版（紧凑 / 两空格缩进）均为有效数据，部署不
重写任何字节——旧排版留待下次正常写入时自动转换为新紧凑格式（GUI 资源
随技能安装同样不提前转换，工单 #15 延迟转换语义），已是新规范（含 CRLF
变体）无需提示；仅当结构不规范（如缺派生 kind 字段）才做规范化结构迁移
（数据语义不变），且迁移经统一写入口直接输出新紧凑规范，保证数据无损且
废弃文件升级到位。

开发主线在主仓库（Vibe-Sketchpad-Coding）的 skills/deploy-file-tree-skill/dist/：
直接改 dist、验证后逐仓库 deploy，并同步本机使用副本。前端发行快照由
scripts/assemble_viewer.py 组装（npm run build 自动串联）。update-dist 仅作
应急回收：从指定仓库的部署实例提取固定清单刷新 dist（不动 dist/viewer/
等主线维护内容）。

用法：
  python deploy.py deploy <目标仓库路径> [--skill-dir .agents/skills/file-tree]
  python deploy.py update-dist <源仓库路径> [--source-dir .agents/skills/file-tree]
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
DIST = SKILL_ROOT / "dist"
# 前端构建指引（#23 审查 Standards-3）：与 dist/scripts/viewer.py、
# scripts/assemble_viewer.py 的同名常量逐字一致（deploy_test.py 锁定）；
# 跨包 import 不可行——部署实例只携带 dist 文件。
BUILD_GUIDE = "cd frontend && npm install && npm run build"
DIST_FILES = (
    "SKILL.md",
    "references/views.md",
    "agents/openai.yaml",
    "scripts/tree_tool.py",
    "scripts/tree_tool_test.py",
    "scripts/viewer.py",
    "scripts/viewer_core.py",
    "scripts/viewer_test.py",
    "scripts/gen_viewer_sample.py",
    "scripts/bench_viewer.py",
)
# dist 内受控发行静态资源目录（G18）：index.html + assets/（hash 文件名）
VIEWER_STATIC_REL = "viewer"


class DeployError(Exception):
    """部署/提取失败。"""


# 目标仓库的私有数据：文件树数据与本机撤销历史，升级时永不覆盖、永不清理
PROTECTED = {"tree.json", ".history.json"}


def load_tree_tool():
    """懒加载 dist 自带的 tree_tool（dist 为空时先跑 update-dist）。"""
    sys.path.insert(0, str(DIST / "scripts"))
    import tree_tool

    return tree_tool


def dist_manifest(dist_root: Path) -> list[str]:
    """发行文件清单 = 固定清单 + dist/viewer/ 静态资源（hash 文件名动态清点）。"""
    manifest = list(DIST_FILES)
    static_root = Path(dist_root) / VIEWER_STATIC_REL
    if static_root.is_dir():
        manifest.extend(
            p.relative_to(dist_root).as_posix()
            for p in sorted(static_root.rglob("*"))
            if p.is_file()
        )
    return manifest


def _mirror_sync(dist_root: Path, skill_dir: Path, log: list[str]) -> None:
    """dist → skill_dir 镜像同步：覆盖 dist 文件；清理 dist 中不存在的旧残留与缓存。

    保护清单之外（tree.json / .history.json）一切以 dist 为准，废弃文件的升级能
    真正到位——viewer 静态资源在清单内不被误删，旧 hash 资源不在清单内被清理。
    """
    manifest = dist_manifest(dist_root)
    dist_rel = {Path(rel).as_posix() for rel in manifest}
    for rel in manifest:
        src, dest = dist_root / rel, skill_dir / rel
        if dest.is_file() and dest.read_bytes() == src.read_bytes():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        log.append(f"复制 {rel}")
    # 缓存目录整删（旧字节码对新版脚本有害无益）
    pycache = skill_dir / "__pycache__"
    if pycache.is_dir():
        shutil.rmtree(pycache, ignore_errors=True)
        log.append("清理 __pycache__/")
    # 旧版本残留文件：目标有、dist 无、且非保护文件 → 删除
    for path in sorted((p for p in skill_dir.rglob("*") if p.is_file())):
        rel = path.relative_to(skill_dir).as_posix()
        if rel not in dist_rel and rel not in PROTECTED:
            path.unlink()
            log.append(f"清理 {rel}")
    # 由深到浅回收空目录（dist 需要的目录已由复制阶段重建）
    for path in sorted(
        (p for p in skill_dir.rglob("*") if p.is_dir()),
        key=lambda p: len(p.parts),
        reverse=True,
    ):
        if not any(path.iterdir()):
            path.rmdir()
            log.append(f"清理空目录 {path.relative_to(skill_dir).as_posix()}/")


def deploy(
    target_root: Path,
    skill_rel: str = ".agents/skills/file-tree",
    dist_root: Path | None = None,
) -> list[str]:
    """部署/升级目标仓库的 file-tree 技能，返回动作日志；自检失败抛 DeployError。"""
    target_root = Path(target_root).resolve()
    dist_root = DIST if dist_root is None else Path(dist_root)
    if not target_root.is_dir():
        raise DeployError(f"目标目录不存在: {target_root}")
    missing = [rel for rel in DIST_FILES if not (dist_root / rel).is_file()]
    if missing:
        raise DeployError(f"dist 不完整（缺 {missing}），先运行 update-dist 提取")

    skill_dir = target_root / skill_rel
    log: list[str] = []
    if not (dist_root / VIEWER_STATIC_REL / "index.html").is_file():
        log.append(
            "提示: dist/viewer/ 发行静态资源缺失，本次部署不含 GUI 页面"
            f"（组装方法: {BUILD_GUIDE}）"
        )
    _mirror_sync(dist_root, skill_dir, log)

    ft = load_tree_tool()
    try:
        tool = ft.TreeTool(
            tree_json=skill_dir / "tree.json",
            agents_md=target_root / "AGENTS.md",
            repo_root=target_root,
            root_name=target_root.name,
            history_path=ft.default_history_path(target_root, skill_dir),
            legacy_history_paths=(skill_dir / ".history.json",),
        )
        fresh = not tool.tree_json.exists()
        if fresh:
            tool.write_data({"tags": {}, "tree": {}})
            log.append("初始化空 tree.json")
        else:
            # 升级判定与 check 同源（canonical_form 一次判定）：新旧两种规范
            # 排版均为有效数据，部署不重写任何字节——旧两空格排版留待下次
            # 正常写入时自动转换为新紧凑格式；已是新规范（含 CRLF 变体）无需
            # 提示；仅当结构不规范（缺派生 kind 等）才做规范化结构迁移，
            # 且经统一写入口直接输出新紧凑规范
            form = ft.canonical_form(tool.tree_json.read_text(encoding="utf-8"))
            if form is None:
                tool.write_data(tool.load())
                log.append("规范化迁移 tree.json（补派生字段，数据不变）")
            elif form == "legacy":
                log.append("tree.json 保留原排版不改写（下次写入时自动转换为新格式）")
        tool.render()
        log.append("已渲染 AGENTS.md 标记块")
        errors, _warnings = tool.check()
        if errors:
            raise DeployError("部署后自检失败:\n" + "\n".join(errors))
    except ft.ToolError as exc:
        raise DeployError(str(exc)) from exc
    log.append("首次部署" if fresh else "升级（数据与撤销历史已保留）")
    log.append("check 自检通过")
    return log


def update_dist(
    source_root: Path,
    source_rel: str = ".agents/skills/file-tree",
    dist_root: Path | None = None,
) -> list[str]:
    """从源仓库提取固定清单（十件）刷新 dist 快照（不动 dist 里其他内容）。"""
    source_root = Path(source_root).resolve()
    dist_root = DIST if dist_root is None else Path(dist_root)
    src_skill = source_root / source_rel
    log: list[str] = []
    for rel in DIST_FILES:
        src = src_skill / rel
        if not src.is_file():
            raise DeployError(f"源技能不完整: 缺 {src}")
        dest = dist_root / rel
        if dest.is_file() and dest.read_bytes() == src.read_bytes():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        log.append(f"更新 dist/{rel}")
    if not log:
        log.append("dist 已与源一致，无更新")
    return log


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="部署 file-tree 技能到任意仓库")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("deploy", help="部署/升级目标仓库的 file-tree 技能")
    p.add_argument("target", help="目标仓库路径")
    p.add_argument("--skill-dir", default=".agents/skills/file-tree", help="目标技能相对路径")

    p = sub.add_parser("update-dist", help="从源仓库提取固定清单（十件）刷新 dist 快照")
    p.add_argument("source", help="源仓库路径（file-tree 开发主线）")
    p.add_argument("--source-dir", default=".agents/skills/file-tree", help="源技能相对路径")

    args = parser.parse_args(argv)
    try:
        if args.command == "deploy":
            log = deploy(args.target, skill_rel=args.skill_dir)
        else:
            log = update_dist(args.source, source_rel=args.source_dir)
    except DeployError as exc:  # deploy/update_dist 已把 ToolError 统一包装为 DeployError
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    for line in log:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
