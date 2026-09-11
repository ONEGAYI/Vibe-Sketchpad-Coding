"""独立快照的只读文件树查看器：标准库 HTTP 服务 + 前端静态资源托管。

用法：
    python viewer.py <tree.json 路径> [--port N] [--host H]

- 默认绑定 127.0.0.1（G20）：只提供查看器页面资源与快照查询，
  不把任意源码目录作为静态目录暴露；远端访问请自行建立 SSH 隧道。
- 启动后打印访问地址，按 Ctrl+C 停止。
- 绝对只读（G04）：无任何写入口，不触发格式转换、不生成撤销历史、
  不重渲染 AGENTS.md；快照只在整个进程生命周期内读取一次（G13）。
- 快照独立（G02）：tree.json 可位于仓库之外，无需源码、.git 或 AGENTS.md。
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, str(Path(__file__).parent))

from viewer_core import DEFAULT_PAGE_SIZE, Snapshot, ViewerError  # noqa: E402

SKILL_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC_DIR = SKILL_ROOT / "frontend" / "build"  # Vite 构建产物（被忽略，不入库）
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8618

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}


class ViewerServer(ThreadingHTTPServer):
    """持有内存快照与静态资源目录的服务；请求线程为 daemon，随主进程退出。"""

    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        snapshot: Snapshot,
        static_dir: Path,
        quiet: bool = False,
    ):
        super().__init__(address, handler)
        self.snapshot = snapshot
        self.static_dir = static_dir
        self.quiet = quiet


class ViewerHandler(BaseHTTPRequestHandler):
    server: ViewerServer
    server_version = "file-tree-viewer/1.0"

    # ------------------------------------------------------------------
    # 路由：/api/* 快照查询；其余路径静态资源；写方法一律 405
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urlsplit(self.path)
        try:
            if parsed.path == "/api/root":
                self._send_json(200, self.server.snapshot.root_info())
            elif parsed.path == "/api/children":
                self._api_children(parse_qs(parsed.query))
            elif parsed.path == "/api/detail":
                self._api_detail(parse_qs(parsed.query))
            elif parsed.path == "/api/search":
                self._api_search(parse_qs(parsed.query))
            elif parsed.path.startswith("/api/"):
                self._send_json(404, {"error": f"未知接口: {parsed.path}"})
            else:
                self._serve_static(parsed.path)
        except ViewerError as exc:
            self._send_json(exc.status, {"error": str(exc)})

    def do_POST(self):
        self._reject_write()

    def do_PUT(self):
        self._reject_write()

    def do_DELETE(self):
        self._reject_write()

    def do_PATCH(self):
        self._reject_write()

    def _reject_write(self):
        self._send_json(405, {"error": "只读查看器：不支持写请求"})

    def _api_children(self, query: dict):
        path = (query.get("path") or [""])[0]
        children = self.server.snapshot.children(path)
        self._send_json(200, {"path": path, "children": children})

    def _api_detail(self, query: dict):
        path = (query.get("path") or [""])[0]
        if not path:
            raise ViewerError("缺少 path 参数", 400)
        self._send_json(200, self.server.snapshot.detail(path))

    def _api_search(self, query: dict):
        """组合搜索（G08）：kw / tag / under / depth / page / page_size 全部可选。

        数值参数非法（非整数、越界）报 400 可读错误；kw/tag/under 空串视为未提供。
        """
        def first(name: str) -> str | None:
            value = (query.get(name) or [""])[0].strip()
            return value or None

        def positive_int(name: str, default: int | None = None) -> int | None:
            raw = first(name)
            if raw is None:
                return default
            try:
                return int(raw)
            except ValueError:
                raise ViewerError(f"{name} 必须是整数: {raw!r}", 400) from None

        kw = first("kw")
        tag = first("tag")
        under = first("under")
        depth = positive_int("depth")
        page = positive_int("page", default=1)
        page_size = positive_int("page_size", default=DEFAULT_PAGE_SIZE)
        self._send_json(
            200,
            self.server.snapshot.search(
                kw=kw, tag=tag, under=under, depth=depth, page=page, page_size=page_size
            ),
        )

    # ------------------------------------------------------------------
    # 静态资源：仅托管查看器前端构建目录（G20），拒绝目录穿越
    # ------------------------------------------------------------------

    def _serve_static(self, url_path: str):
        static_dir = self.server.static_dir
        if not (static_dir / "index.html").is_file():
            self._send_html(
                503,
                "<!doctype html><html lang=\"zh\"><meta charset=\"utf-8\">"
                "<h3>前端尚未构建</h3>"
                "<p>查看器缺少页面资源（未找到 index.html）。请在技能目录执行：</p>"
                "<pre>cd skills/deploy-file-tree-skill/frontend\n"
                "npm install\nnpm run build</pre>"
                "<p>构建完成后重新启动查看器即可浏览；快照查询 API（/api/root 等）当前仍可用。</p>",
            )
            return
        rel = unquote(url_path).lstrip("/")
        if not rel:
            rel = "index.html"
        parts = [p for p in rel.split("/") if p not in ("", ".")]
        if not parts or any(p == ".." for p in parts) or "\\" in rel:
            self._send_json(404, {"error": "资源不存在"})
            return
        target = static_dir.joinpath(*parts)
        try:
            target.resolve().relative_to(static_dir.resolve())
        except ValueError:
            self._send_json(404, {"error": "资源不存在"})
            return
        if not target.is_file():
            self._send_json(404, {"error": "资源不存在"})
            return
        mime = (
            MIME_TYPES.get(target.suffix.lower())
            or mimetypes.guess_type(target.name)[0]
            or "application/octet-stream"
        )
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ------------------------------------------------------------------
    # 输出
    # ------------------------------------------------------------------

    def _send_json(self, status: int, payload: dict):
        self._send_bytes(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                         "application/json; charset=utf-8")

    def _send_html(self, status: int, html: str):
        self._send_bytes(status, html.encode("utf-8"), "text/html; charset=utf-8")

    def _send_bytes(self, status: int, data: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):  # noqa: A002 - 基类签名
        if self.server.quiet:
            return
        super().log_message(format, *args)


def create_server(
    tree_json: Path | str,
    host: str = DEFAULT_HOST,
    port: int = 0,
    static_dir: Path | str | None = None,
    quiet: bool = False,
) -> ViewerServer:
    """构造并绑定服务（不启动事件循环）；快照非法抛 ViewerError。

    port=0 时由系统分配空闲端口，实际地址见 server.server_address。
    """
    snapshot = Snapshot(Path(tree_json))  # 加载失败（ViewerError）直接上抛，不启动服务
    static = Path(static_dir) if static_dir is not None else DEFAULT_STATIC_DIR
    return ViewerServer((host, port), ViewerHandler, snapshot, static, quiet)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="viewer.py",
        description="独立快照的只读文件树查看器（Python 标准库实现，默认绑定 127.0.0.1）",
    )
    parser.add_argument("tree_json", help="tree.json 快照路径（可位于仓库之外）")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址（默认 {DEFAULT_HOST}）")
    parser.add_argument(
        "--port", type=int, default=DEFAULT_PORT, help=f"监听端口（默认 {DEFAULT_PORT}，0 表示随机）"
    )
    args = parser.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # 管道输出确定性编码（Windows 控制台默认 ANSI）
        except (AttributeError, ValueError, OSError):
            pass

    snapshot_path = Path(args.tree_json)
    if not snapshot_path.is_file():
        print(f"无法启动查看器：快照文件不存在: {snapshot_path}", file=sys.stderr)
        return 2
    try:
        server = create_server(snapshot_path, host=args.host, port=args.port)
    except ViewerError as exc:
        print(f"无法启动查看器：{exc}", file=sys.stderr)
        return 2

    host, port = server.server_address[:2]
    counts = server.snapshot.counts
    print("文件树只读查看器")
    print(f"快照: {snapshot_path}（{counts['total']} 条目：{counts['dirs']} 目录 / {counts['files']} 文件）")
    if not (server.static_dir / "index.html").is_file():
        print(f"提示: 前端未构建（缺 {server.static_dir / 'index.html'}），页面暂不可用，API 仍可访问")
        print("      构建方法: cd skills/deploy-file-tree-skill/frontend && npm install && npm run build")
    print(f"访问地址: http://{host}:{port}/")
    print("按 Ctrl+C 停止")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
