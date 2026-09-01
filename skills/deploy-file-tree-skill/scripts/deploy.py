"""deploy-file-tree-skill：把 file-tree 技能部署到任意仓库。

dist/ 是 file-tree 技能的发行版快照——公用四件套
（SKILL.md / agents/openai.yaml / scripts/tree_tool.py / scripts/tree_tool_test.py），
不含任何仓库数据。部署 = 复制四件套到目标仓库 .agents/skills/file-tree/，
首跑初始化空 tree.json 并渲染 AGENTS.md 标记块，随后自动 check 自检；
目标已有技能时是升级模式：镜像同步——以 dist 为准覆盖，清理 dist 中
不存在的旧版本残留与 __pycache__，仅 tree.json 与本机撤销历史（.history.json）
永不动（升级时允许对 tree.json 做规范化结构迁移，如补 kind 派生字段，
数据语义不变），保证数据无损且废弃文件升级到位。

开发主线在主仓库（Vibe-Sketchpad-Coding）的 skills/deploy-file-tree-skill/dist/：
直接改 dist、验证后逐仓库 deploy，并同步本机使用副本。update-dist 仅作应急
回收：从指定仓库的部署实例提取四件套刷新 dist。

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
DIST_FILES = (
    "SKILL.md",
    "agents/openai.yaml",
    "scripts/tree_tool.py",
    "scripts/tree_tool_test.py",
)


class DeployError(Exception):
    """部署/提取失败。"""


# 目标仓库的私有数据：文件树数据与本机撤销历史，升级时永不覆盖、永不清理
PROTECTED = {"tree.json", ".history.json"}


def load_tree_tool():
    """懒加载 dist 自带的 tree_tool（dist 为空时先跑 update-dist）。"""
    sys.path.insert(0, str(DIST / "scripts"))
    import tree_tool

    return tree_tool


def _mirror_sync(dist_root: Path, skill_dir: Path, log: list[str]) -> None:
    """dist → skill_dir 镜像同步：覆盖 dist 文件；清理 dist 中不存在的旧残留与缓存。

    保护清单之外（tree.json / .history.json）一切以 dist 为准，废弃文件的升级能真正到位。
    """
    dist_rel = {Path(rel).as_posix() for rel in DIST_FILES}
    for rel in DIST_FILES:
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
            # 结构升级迁移：旧版数据规范化重写（补 kind 等派生字段），数据语义不变
            raw = tool.tree_json.read_text(encoding="utf-8")
            data = tool.load()
            if raw != ft.dumps_canonical(ft.normalize_data(data)):
                tool.write_data(data)
                log.append("规范化迁移 tree.json（补派生字段，数据不变）")
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
    """从源仓库提取公用四件套刷新 dist 快照（不动 dist 里其他内容）。"""
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

    p = sub.add_parser("update-dist", help="从源仓库提取四件套刷新 dist 快照")
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
