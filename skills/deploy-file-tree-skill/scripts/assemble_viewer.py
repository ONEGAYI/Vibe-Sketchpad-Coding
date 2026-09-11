"""查看器发行组装器：frontend/build → dist/viewer 受控快照（G18，工单 #21）。

用法：
  python assemble_viewer.py [--build <dir>] [--dest <dir>]

默认 build = 技能根 frontend/build（vite 构建暂存，被 .gitignore 排除不入库），
默认 dest = 技能根 dist/viewer（受控入库的发行资源，随技能部署）。
语义为镜像同步：覆盖字节差异 + 清理 build 中不存在的旧文件（旧 hash
资源不残留），幂等可重复；组装时校验 index.html 无外链（src/href 不得
指向 CDN）、引用的本地资源真实存在，违规产物当场拒绝入库。

前端构建到组装的完整链（npm script 串联，见 frontend/package.json）：
  cd frontend && npm install && npm run build
其中 npm run build = vite build && python ../scripts/assemble_viewer.py。
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUILD = SKILL_ROOT / "frontend" / "build"
DEFAULT_DEST = SKILL_ROOT / "dist" / "viewer"
# 前端构建指引（#23 审查 Standards-3）：与 scripts/deploy.py、
# dist/scripts/viewer.py 的同名常量逐字一致（deploy_test.py 锁定）；
# 跨包 import 不可行——部署实例只携带 dist 文件。
BUILD_GUIDE = "cd frontend && npm install && npm run build"

_EXTERNAL_REF = re.compile(r"^(?:[a-z][a-z0-9+.-]*:)?//", re.IGNORECASE)
_REF_ATTRS = re.compile(r"""(?:src|href)\s*=\s*"([^"]+)""")


class AssembleError(Exception):
    """组装失败。"""


def check_release(index_html: Path) -> None:
    """受控入库质量门：发行页面不得依赖 CDN，引用资源必须存在。"""
    html = index_html.read_text(encoding="utf-8")
    refs = _REF_ATTRS.findall(html)
    if not refs:
        raise AssembleError("index.html 未引用任何资源，疑似异常构建产物")
    for ref in refs:
        if ref.startswith(("data:", "mailto:", "#")):
            continue
        if _EXTERNAL_REF.match(ref):
            raise AssembleError(f"发行页面存在外链依赖（不得依赖 CDN）: {ref}")
        local = index_html.parent / ref.split("?")[0].split("#")[0]
        if not local.is_file():
            raise AssembleError(f"发行资源缺失: {ref}")


def assemble(build_dir: Path, dest_dir: Path) -> list[str]:
    """build → dest 镜像同步（覆盖差异 + 清理旧 hash 残留），返回动作日志。"""
    build_dir, dest_dir = Path(build_dir), Path(dest_dir)
    index = build_dir / "index.html"
    if not index.is_file():
        raise AssembleError(f"构建产物缺失: {index}\n先在现代构建机执行: {BUILD_GUIDE}")
    check_release(index)

    log: list[str] = []
    for src in sorted(p for p in build_dir.rglob("*") if p.is_file()):
        rel = src.relative_to(build_dir)
        target = dest_dir / rel
        if target.is_file() and target.read_bytes() == src.read_bytes():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        log.append(f"复制 {rel.as_posix()}")
    # dest 中 build 已不含的文件（旧 hash 资源）→ 清理，发行快照不留过期产物
    build_rel = {p.relative_to(build_dir).as_posix() for p in build_dir.rglob("*") if p.is_file()}
    for path in sorted(p for p in dest_dir.rglob("*") if p.is_file()):
        rel = path.relative_to(dest_dir).as_posix()
        if rel not in build_rel:
            path.unlink()
            log.append(f"清理 {rel}")
    # 由深到浅回收空目录
    for path in sorted(
        (p for p in dest_dir.rglob("*") if p.is_dir()),
        key=lambda p: len(p.parts),
        reverse=True,
    ):
        if not any(path.iterdir()):
            path.rmdir()
            log.append(f"清理空目录 {path.relative_to(dest_dir).as_posix()}/")
    if not log:
        log.append("无变更，发行快照已与构建产物一致")
    return log


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="组装查看器发行快照（frontend/build → dist/viewer，镜像同步幂等）"
    )
    parser.add_argument("--build", default=str(DEFAULT_BUILD), help="vite 构建产物目录")
    parser.add_argument("--dest", default=str(DEFAULT_DEST), help="发行快照目标目录")
    args = parser.parse_args(argv)
    # #23 审查 C3 自伤防护：清理逻辑会删除 dest 下构建产物之外的文件，
    # --dest 误指技能根等非空目录会连带删除脚本。非默认目标要求为空或
    # 不存在；默认 dist/viewer 不受限（受控发行快照本就非空、需幂等重组装）。
    # 比较用 resolve 后的路径（N3）：尾分隔符/相对写法指向默认目录时放行
    if Path(args.dest).resolve() != DEFAULT_DEST.resolve():
        dest = Path(args.dest)
        if dest.is_dir() and any(dest.iterdir()):
            print(
                f"错误: 非默认 --dest 目标目录非空，拒绝组装（清理阶段会删除其中"
                f"构建产物之外的文件）: {dest}",
                file=sys.stderr,
            )
            return 2
    try:
        log = assemble(Path(args.build), Path(args.dest))
    except AssembleError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    for line in log:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
