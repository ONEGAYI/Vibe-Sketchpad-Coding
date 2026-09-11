"""独立快照的内存读模型：一次加载、按需查询、绝对只读。

被 viewer.py（HTTP 服务）使用。设计约束：
- 快照独立（G02）：只需一个 tree.json 路径，不依赖源码、.git 或 AGENTS.md，
  不做任何磁盘校验；
- 绝对只读（G04）：构造时读取一次后不再触盘，无任何写入口；
- 内存持有（G13）：解析一次建索引，children/detail 按需从内存返回，
  不在每个请求重新解析整份文件；
- 语义一致：复用 tree_tool 的模块级纯函数（排序/路径校验/目录判据/
  结构校验），与核心工具的读写语义保持同源。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tree_tool import (  # noqa: E402
    ToolError,
    is_dir,
    normalize_data,
    sort_key,
    split_rel_path,
    walk_entries,
)

DEFAULT_ROOT_NAME = "tree"  # 快照无 root 键时的展示根名（viewer 无仓库上下文）


class ViewerError(Exception):
    """查看器确定性错误：消息面向用户可读，status 为对应 HTTP 状态码。

    400 = 请求非法（路径不合法、不是目录、缺参数）；404 = 条目不存在；
    500 = 快照文件无法读取。
    """

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Snapshot:
    """tree.json 的一次性内存快照：构造时解析并建索引，此后不再读盘。

    加载走 json.loads 直读（新旧排版、CRLF 均可），结构校验复用
    normalize_data——它返回重建的新对象、不写回文件，只读安全；
    排版是否规范（canonical 形态）不作为加载门槛。
    """

    def __init__(self, tree_json: Path):
        tree_json = Path(tree_json)
        try:
            text = tree_json.read_bytes().decode("utf-8")
        except OSError as exc:
            raise ViewerError(f"无法读取快照文件: {tree_json}（{exc}）", 500) from exc
        except UnicodeDecodeError as exc:
            raise ViewerError(f"快照不是 UTF-8 编码: {exc}", 400) from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ViewerError(f"快照不是合法 JSON: {exc}", 400) from exc
        try:
            normalized = normalize_data(data)
        except ToolError as exc:
            raise ViewerError(f"快照结构校验失败: {exc}", 400) from exc

        self.source = str(tree_json)
        self.root_name: str = normalized.get("root") or DEFAULT_ROOT_NAME
        self.tags: dict[str, str] = dict(normalized.get("tags", {}))
        self.tree: dict = normalized["tree"]
        self._nodes: dict[str, dict] = dict(walk_entries(self.tree, []))
        dirs = sum(1 for node in self._nodes.values() if is_dir(node))
        self.counts = {"dirs": dirs, "files": len(self._nodes) - dirs, "total": len(self._nodes)}

    # ------------------------------------------------------------------
    # 查询（全部从内存索引返回，无磁盘 IO）
    # ------------------------------------------------------------------

    def find(self, path: str) -> dict | None:
        """按路径定位节点；不存在或路径中段是文件返回 None。

        与 tree_tool._find_node 同语义：沿段下探，目录判据用 children 键
        （不采信 kind 字段，兼容早于 kind 引入的历史数据）。
        """
        parts = self._parts(path)
        node: dict = {"children": self.tree}
        for part in parts:
            if not is_dir(node) or part not in node["children"]:
                return None
            node = node["children"][part]
        return node

    def children(self, path: str) -> list[dict]:
        """目录子项摘要列表，按 sort_key 规范序；空 path 表示根级。

        hidden / collapsed 条目照常返回——界面展示状态与 JSON 标志分离
        （G11），浏览端不因标志过滤条目。
        """
        node = self.find(path)
        if node is None:
            raise ViewerError(f"条目不存在: {path or '(根)'}", 404)
        if not is_dir(node):
            raise ViewerError(f"不是目录，没有子项: {path}", 400)
        out = []
        for name, child in sorted(node["children"].items(), key=lambda kv: sort_key(kv[0])):
            out.append(
                {
                    "name": name,
                    "path": self._join(path, name),
                    "kind": "dir" if is_dir(child) else "file",
                    "desc": child.get("desc", ""),
                    "hidden": bool(child.get("hidden", False)),
                    "collapsed": bool(child.get("collapsed", False)),
                    # 三态：None = 键缺省继承祖先，False = 显式退出豁免，True = 豁免
                    "git_ignore": child.get("git-ignore"),
                    "child_count": len(child["children"]) if is_dir(child) else None,
                }
            )
        return out

    def detail(self, path: str) -> dict:
        """单条目完整详情：字段与 tree_tool query --json 同口径。

        git_ignore 拆为 explicit（键缺省 None/显式 false/显式 true）与
        effective（沿祖先链就近覆写后的有效值），三态不混为一态（G07）。
        rel 每条附 exists 标记：目标不在快照中可识别、不致命（G09 预留）。
        """
        parts = self._parts(path)
        if not parts:
            raise ViewerError("根不是条目，请选择具体条目查看详情", 400)
        node = self.find(path)
        if node is None:
            raise ViewerError(f"条目不存在: {path}", 404)
        return {
            "path": "/".join(parts),
            "name": parts[-1],
            "kind": "dir" if is_dir(node) else "file",
            "desc": node.get("desc", ""),
            "detail": list(node.get("detail", [])),
            "rel": [
                {"path": target, "exists": target in self._nodes}
                for target in node.get("rel", [])
            ],
            "tags": list(node.get("tags", [])),
            "collapsed": bool(node.get("collapsed", False)),
            "hidden": bool(node.get("hidden", False)),
            "git_ignore": {
                "explicit": node.get("git-ignore"),
                "effective": self._effective_git_ignore(parts),
            },
            "child_count": len(node["children"]) if is_dir(node) else None,
        }

    def root_info(self) -> dict:
        """页面初始化信息：根名、标签词表、条目计数、快照来源路径。"""
        return {
            "root": self.root_name,
            "tags": self.tags,
            "counts": self.counts,
            "source": self.source,
        }

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    def _parts(self, path: str | None) -> list[str]:
        """路径拆段（含合法性校验）；空串/None 视为根（返回空段列表）。"""
        if path is None or path == "":
            return []
        try:
            return split_rel_path(path)
        except ToolError as exc:
            raise ViewerError(str(exc), 400) from exc

    @staticmethod
    def _join(prefix: str, name: str) -> str:
        return f"{prefix}/{name}" if prefix else name

    def _effective_git_ignore(self, parts: list[str]) -> bool:
        """git-ignore 有效值：沿祖先链（含自身）最近一次显式设置生效。

        与 tree_tool._git_exempt 同语义；全链缺省则不豁免（False）。
        """
        value = False
        cursor: dict = {"children": self.tree}
        for part in parts:
            if not is_dir(cursor):
                break  # 中途段是文件条目：无更深的祖先设置可继承
            child = cursor["children"].get(part)
            if child is None:
                break
            if "git-ignore" in child:
                value = child["git-ignore"]
            cursor = child
        return value
