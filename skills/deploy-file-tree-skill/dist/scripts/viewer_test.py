"""独立快照只读查看器（viewer.py / viewer_core.py）的契约测试。

运行：python skills/deploy-file-tree-skill/dist/scripts/viewer_test.py
沙箱模式：所有用例在临时目录构造快照与静态资源，不触仓库；快照目录
不含源码、.git 或 AGENTS.md，借以验证快照独立性（G02）。HTTP 用例在
127.0.0.1 随机端口真实起服务，用标准库 http.client 直连断言（G20）；
CLI 用例以子进程真实启动入口并解析其输出的访问地址。
"""

from __future__ import annotations

import hashlib
import http.client
import json
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).parent))

import viewer  # noqa: E402
from viewer_core import Snapshot, ViewerError  # noqa: E402

VIEWER_ENTRY = Path(__file__).parent / "viewer.py"


def compact_dumps(data: dict) -> str:
    """独立新编码规则（紧凑单行 + 末尾 LF）：标准库直调，不经被测实现。"""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


def legacy_dumps(data: dict) -> str:
    """独立旧编码规则（两空格缩进 + 末尾 LF）：标准库直调，不经被测实现。"""
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def make_snapshot_data() -> dict:
    """固定样本：覆盖中文、空目录、detail 多行与转义、rel 悬空、
    hidden/collapsed、git-ignore 三态（缺省继承 / 显式 false / 显式 true）。
    """
    return {
        "root": "演示仓库",
        "tags": {"doc": "说明文档", "script": "维护脚本"},
        "tree": {
            "apps": {
                "kind": "dir",
                "desc": "应用目录",
                "detail": ["应用目录说明第一行", "应用目录说明第二行"],
                "children": {
                    "main.tsx": {
                        "kind": "file",
                        "desc": "前端入口",
                        "detail": ["含\"双引号\"与\\反斜杠\\转义", "第二行说明"],
                        "rel": ["normal.md", "gone.rs"],
                        "tags": ["script"],
                    },
                    "util.ts": {"kind": "file", "desc": "工具函数", "tags": ["script"]},
                },
            },
            "collapsed-dir": {
                "kind": "dir",
                "desc": "折叠目录",
                "collapsed": True,
                "children": {
                    "inner.md": {
                        "kind": "file",
                        "desc": "折叠目录内部文件",
                        "detail": ["初始折叠但可在界面展开"],
                    },
                },
            },
            "empty-dir": {"kind": "dir", "desc": "空目录", "children": {}},
            "exempt": {
                "kind": "dir",
                "desc": "豁免目录",
                "git-ignore": True,
                "children": {
                    "inherit.ts": {"kind": "file", "desc": "继承豁免"},
                    "optout.ts": {"kind": "file", "desc": "显式退出豁免", "git-ignore": False},
                },
            },
            "hidden-dir": {
                "kind": "dir",
                "desc": "隐藏目录",
                "hidden": True,
                "children": {
                    "secret.md": {"kind": "file", "desc": "隐藏文件", "hidden": True},
                },
            },
            "normal.md": {"kind": "file", "desc": "普通文件"},
            "中文目录": {
                "kind": "dir",
                "desc": "中文命名目录",
                "children": {
                    "说明.md": {
                        "kind": "file",
                        "desc": "中文名称文件",
                        "detail": ["中文 detail 第一行", "中文 detail 第二行"],
                    },
                },
            },
        },
    }


ROOT_ORDER = [
    "apps",
    "collapsed-dir",
    "empty-dir",
    "exempt",
    "hidden-dir",
    "normal.md",
    "中文目录",
]
COUNTS = {"dirs": 6, "files": 8, "total": 14}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# 快照加载：新旧排版 / 空树 / 非法输入（G03）
# ---------------------------------------------------------------------------


class SnapshotLoadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def write_snapshot(self, text: str) -> Path:
        path = self.dir / "tree.json"
        path.write_text(text, encoding="utf-8", newline="\n")
        return path

    def test_load_compact_form(self):
        snap = Snapshot(self.write_snapshot(compact_dumps(make_snapshot_data())))
        self.assertEqual(snap.root_name, "演示仓库")
        self.assertEqual(snap.tags, {"doc": "说明文档", "script": "维护脚本"})
        self.assertEqual(snap.counts, COUNTS)
        self.assertEqual([c["path"] for c in snap.children("")], ROOT_ORDER)

    def test_load_legacy_form_equivalent_to_compact(self):
        data = make_snapshot_data()
        compact = Snapshot(self.write_snapshot(compact_dumps(data)))
        legacy_path = self.dir / "legacy.json"
        legacy_path.write_text(legacy_dumps(data), encoding="utf-8", newline="\n")
        legacy = Snapshot(legacy_path)
        self.assertEqual(legacy.root_name, compact.root_name)
        self.assertEqual(legacy.tags, compact.tags)
        self.assertEqual(legacy.counts, compact.counts)
        self.assertEqual(legacy.children(""), compact.children(""))
        self.assertEqual(legacy.detail("apps/main.tsx"), compact.detail("apps/main.tsx"))
        self.assertEqual(legacy.detail("exempt/optout.ts"), compact.detail("exempt/optout.ts"))

    def test_load_crlf_text(self):
        # CRLF 行尾不是规范排版，但 JSON 解析不受行尾影响，必须可读
        path = self.dir / "tree.json"
        path.write_bytes(legacy_dumps(make_snapshot_data()).replace("\n", "\r\n").encode("utf-8"))
        snap = Snapshot(path)
        self.assertEqual(snap.counts, COUNTS)

    def test_load_entry_without_kind_field(self):
        # 早于 kind 字段的旧数据：无 kind 键，按 children 判据区分目录与文件
        path = self.dir / "tree.json"
        path.write_text(
            json.dumps({"tree": {"src": {"desc": "无 kind 目录", "children": {"a.py": {"desc": "无 kind 文件"}}}}},
                       ensure_ascii=False),
            encoding="utf-8",
            newline="\n",
        )
        snap = Snapshot(path)
        children = snap.children("src")
        self.assertEqual([c["kind"] for c in children], ["file"])
        self.assertEqual(snap.detail("src")["kind"], "dir")

    def test_load_empty_tree(self):
        for text in (compact_dumps({"tree": {}}), legacy_dumps({"tree": {}})):
            with self.subTest(text=text[:30]):
                snap = Snapshot(self.write_snapshot(text))
                self.assertEqual(snap.counts, {"dirs": 0, "files": 0, "total": 0})
                self.assertEqual(snap.children(""), [])

    def test_invalid_json_refuses_with_readable_error(self):
        path = self.write_snapshot("{oops 不是 json")
        with self.assertRaises(ViewerError) as ctx:
            Snapshot(path)
        self.assertIn("JSON", str(ctx.exception))

    def test_bad_structure_refuses(self):
        cases = [
            ("desc 非字符串", json.dumps({"tree": {"a": {"desc": 1}}}, ensure_ascii=False)),
            ("顶层非对象", json.dumps([1, 2], ensure_ascii=False)),
            ("tree 非对象", json.dumps({"tree": []}, ensure_ascii=False)),
            ("detail 非数组", json.dumps({"tree": {"a": {"desc": "x", "detail": "y"}}}, ensure_ascii=False)),
            ("root 为 null", json.dumps({"root": None, "tree": {}}, ensure_ascii=False)),
        ]
        for name, text in cases:
            with self.subTest(case=name):
                with self.assertRaises(ViewerError) as ctx:
                    Snapshot(self.write_snapshot(text))
                self.assertIn("结构校验失败", str(ctx.exception))

    def test_load_does_not_touch_disk(self):
        path = self.write_snapshot(legacy_dumps(make_snapshot_data()))
        before = sha256_file(path)
        Snapshot(path)
        Snapshot(path)
        self.assertEqual(sha256_file(path), before)
        # 快照独立性：加载不产生任何伴生文件（历史、AGENTS.md 等）
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["tree.json"])


# ---------------------------------------------------------------------------
# 内存查询：children / detail 语义（G06/G07/G11/G14）
# ---------------------------------------------------------------------------


class SnapshotApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.snapshot_path = Path(cls.tmp.name) / "tree.json"
        cls.snapshot_path.write_text(compact_dumps(make_snapshot_data()), encoding="utf-8", newline="\n")
        cls.snap = Snapshot(cls.snapshot_path)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    # -- children ------------------------------------------------------

    def test_children_root_is_sorted_and_complete(self):
        children = self.snap.children("")
        # hidden / collapsed 目录不因标志被过滤（G11：界面可见）
        self.assertEqual([c["path"] for c in children], ROOT_ORDER)
        by_name = {c["name"]: c for c in children}
        self.assertEqual(by_name["hidden-dir"]["hidden"], True)
        self.assertEqual(by_name["collapsed-dir"]["collapsed"], True)
        self.assertEqual(by_name["apps"]["kind"], "dir")
        self.assertEqual(by_name["normal.md"]["kind"], "file")
        # 空目录正常显示：child_count 为 0 而非条目消失（G06）
        self.assertEqual(by_name["empty-dir"]["child_count"], 0)
        # git-ignore 三态在子项摘要中不混为一态（G07）
        self.assertIsNone(by_name["apps"]["git_ignore"])
        self.assertTrue(by_name["exempt"]["git_ignore"])

    def test_children_of_subdirectory(self):
        children = self.snap.children("apps")
        self.assertEqual([c["path"] for c in children], ["apps/main.tsx", "apps/util.ts"])

    def test_children_of_empty_directory_returns_empty_list(self):
        self.assertEqual(self.snap.children("empty-dir"), [])

    def test_children_of_hidden_directory_still_listed(self):
        self.assertEqual([c["path"] for c in self.snap.children("hidden-dir")], ["hidden-dir/secret.md"])

    def test_children_of_collapsed_directory_still_listed(self):
        self.assertEqual([c["path"] for c in self.snap.children("collapsed-dir")], ["collapsed-dir/inner.md"])

    def test_children_of_chinese_directory(self):
        self.assertEqual([c["path"] for c in self.snap.children("中文目录")], ["中文目录/说明.md"])

    def test_children_of_file_raises(self):
        with self.assertRaises(ViewerError) as ctx:
            self.snap.children("apps/main.tsx")
        self.assertIn("不是目录", str(ctx.exception))

    def test_children_missing_path_raises_404(self):
        with self.assertRaises(ViewerError) as ctx:
            self.snap.children("nope")
        self.assertEqual(ctx.exception.status, 404)

    def test_children_illegal_path_raises(self):
        for bad in ("../escape", "/abs/path", "a/./b", ".."):
            with self.subTest(path=bad):
                with self.assertRaises(ViewerError) as ctx:
                    self.snap.children(bad)
                self.assertEqual(ctx.exception.status, 400)

    # -- detail --------------------------------------------------------

    def test_detail_full_fields(self):
        d = self.snap.detail("apps/main.tsx")
        self.assertEqual(d["path"], "apps/main.tsx")
        self.assertEqual(d["name"], "main.tsx")
        self.assertEqual(d["kind"], "file")
        self.assertEqual(d["desc"], "前端入口")
        # detail 多行与转义原样往返（G07）
        self.assertEqual(d["detail"], ["含\"双引号\"与\\反斜杠\\转义", "第二行说明"])
        self.assertEqual(d["tags"], ["script"])
        # rel 边 + 悬空识别：目标不在快照中可识别、不致命（G09 预留）；
        # rel 语义上经规范化排序去重，顺序为 sort_key 序
        self.assertEqual(
            d["rel"],
            [{"path": "gone.rs", "exists": False}, {"path": "normal.md", "exists": True}],
        )
        self.assertIsNone(d["child_count"])

    def test_detail_git_ignore_tri_state(self):
        # 键缺省 = 继承；有效值沿祖先链就近覆写（G07 三态不混为一态）
        cases = [
            ("exempt", True, True),              # 显式 true
            ("exempt/inherit.ts", None, True),   # 缺省 → 继承祖先 true
            ("exempt/optout.ts", False, False),  # 显式 false 覆写祖先
            ("apps/main.tsx", None, False),      # 全链缺省 → 不豁免
        ]
        for path, explicit, effective in cases:
            with self.subTest(path=path):
                gi = self.snap.detail(path)["git_ignore"]
                self.assertEqual(gi["explicit"], explicit)
                self.assertEqual(gi["effective"], effective)

    def test_detail_directory_fields(self):
        d = self.snap.detail("apps")
        self.assertEqual(d["kind"], "dir")
        self.assertEqual(d["detail"], ["应用目录说明第一行", "应用目录说明第二行"])
        self.assertEqual(d["child_count"], 2)
        self.assertFalse(d["collapsed"])
        self.assertFalse(d["hidden"])

    def test_detail_hidden_entry_visible(self):
        d = self.snap.detail("hidden-dir/secret.md")
        self.assertTrue(d["hidden"])
        self.assertEqual(d["desc"], "隐藏文件")

    def test_detail_collapsed_entry_expandable_data(self):
        d = self.snap.detail("collapsed-dir")
        self.assertTrue(d["collapsed"])
        # collapsed 只影响渲染初始态，子项数据完整可查（G11）
        self.assertEqual([c["path"] for c in self.snap.children("collapsed-dir")], ["collapsed-dir/inner.md"])

    def test_detail_missing_raises_404(self):
        with self.assertRaises(ViewerError) as ctx:
            self.snap.detail("apps/nope.ts")
        self.assertEqual(ctx.exception.status, 404)

    def test_detail_root_path_rejected(self):
        with self.assertRaises(ViewerError):
            self.snap.detail("")

    def test_detail_illegal_path_raises(self):
        with self.assertRaises(ViewerError):
            self.snap.detail("..%2Fetc")


# ---------------------------------------------------------------------------
# HTTP 服务：真启动、按需接口、只读、静态托管边界（G01/G04/G13/G14/G20）
# ---------------------------------------------------------------------------


class HttpServerBase(unittest.TestCase):
    """共享夹具：临时目录快照（无源码/.git/AGENTS.md）+ 随机端口真服务。"""

    @classmethod
    def start_server(cls, static_dir: Path):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.snapshot_path = cls.dir / "tree.json"
        cls.snapshot_path.write_text(compact_dumps(make_snapshot_data()), encoding="utf-8", newline="\n")
        cls.before_bytes = cls.snapshot_path.read_bytes()
        cls.before_digest = hashlib.sha256(cls.before_bytes).hexdigest()
        cls.static_dir = static_dir
        cls.server = viewer.create_server(
            tree_json=cls.snapshot_path, port=0, static_dir=cls.static_dir, quiet=True
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.host, cls.port = cls.server.server_address[:2]

    @classmethod
    def stop_server(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method: str, path: str, body: bytes | None = None):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=10)
        try:
            conn.request(method, path, body=body)
            resp = conn.getresponse()
            return resp.status, resp.getheader("Content-Type"), resp.read()
        finally:
            conn.close()

    def get_json(self, path: str):
        status, ctype, data = self.request("GET", path)
        self.assertIn("application/json", ctype or "")
        return status, json.loads(data.decode("utf-8"))

    @staticmethod
    def q(path: str) -> str:
        return quote(path, safe="")


class ViewerHttpApiTest(HttpServerBase):
    @classmethod
    def setUpClass(cls):
        # 静态目录指向显式空目录：验证 API 不依赖页面资源，且缺失提示可测
        import tempfile as _tf

        cls._extra = _tf.TemporaryDirectory()
        cls.start_server(static_dir=Path(cls._extra.name))

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        # G04 终态断言：全部请求结束后快照字节不变、目录无新增文件
        after = cls.snapshot_path.read_bytes()
        assert hashlib.sha256(after).hexdigest() == cls.before_digest, "浏览流量改变了快照字节"
        assert sorted(p.name for p in cls.dir.iterdir()) == ["tree.json"], "快照目录出现新增文件"
        cls._extra.cleanup()
        cls.tmp.cleanup()

    def test_server_binds_loopback(self):
        self.assertEqual(self.host, "127.0.0.1")
        self.assertGreater(self.port, 0)

    def test_api_root(self):
        status, payload = self.get_json("/api/root")
        self.assertEqual(status, 200)
        self.assertEqual(payload["root"], "演示仓库")
        self.assertEqual(payload["tags"], {"doc": "说明文档", "script": "维护脚本"})
        self.assertEqual(payload["counts"], COUNTS)

    def test_api_children_is_on_demand_not_full_tree(self):
        status, payload = self.get_json("/api/children")
        self.assertEqual(status, 200)
        self.assertEqual([c["path"] for c in payload["children"]], ROOT_ORDER)
        # 按需契约（G14 首步）：响应不得携带未请求层级的深层条目
        raw = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("inner.md", raw)
        self.assertNotIn("optout.ts", raw)
        self.assertNotIn("说明.md", raw)
        # 子项摘要不含嵌套 children 内容
        for child in payload["children"]:
            self.assertNotIn("children", child)

        status, payload = self.get_json(f"/api/children?path={self.q('apps')}")
        self.assertEqual(status, 200)
        self.assertEqual([c["path"] for c in payload["children"]], ["apps/main.tsx", "apps/util.ts"])

    def test_api_children_empty_dir_and_hidden_visible(self):
        status, payload = self.get_json(f"/api/children?path={self.q('empty-dir')}")
        self.assertEqual(status, 200)
        self.assertEqual(payload["children"], [])

        status, payload = self.get_json(f"/api/children?path={self.q('hidden-dir')}")
        self.assertEqual(status, 200)
        self.assertEqual([c["path"] for c in payload["children"]], ["hidden-dir/secret.md"])

        status, payload = self.get_json(f"/api/children?path={self.q('collapsed-dir')}")
        self.assertEqual(status, 200)
        self.assertEqual([c["path"] for c in payload["children"]], ["collapsed-dir/inner.md"])

    def test_api_detail_on_demand(self):
        status, payload = self.get_json(f"/api/detail?path={self.q('apps/main.tsx')}")
        self.assertEqual(status, 200)
        self.assertEqual(payload["detail"], ["含\"双引号\"与\\反斜杠\\转义", "第二行说明"])
        self.assertEqual(payload["rel"][0], {"path": "gone.rs", "exists": False})
        raw = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("util.ts", raw)  # 只含该条目，不夹带兄弟/深层数据

    def test_api_detail_git_ignore_tri_state(self):
        _, payload = self.get_json(f"/api/detail?path={self.q('exempt/inherit.ts')}")
        self.assertIsNone(payload["git_ignore"]["explicit"])
        self.assertTrue(payload["git_ignore"]["effective"])
        _, payload = self.get_json(f"/api/detail?path={self.q('exempt/optout.ts')}")
        self.assertFalse(payload["git_ignore"]["explicit"])
        self.assertFalse(payload["git_ignore"]["effective"])

    def test_api_detail_chinese_path_roundtrip(self):
        status, payload = self.get_json(f"/api/detail?path={self.q('中文目录/说明.md')}")
        self.assertEqual(status, 200)
        self.assertEqual(payload["detail"], ["中文 detail 第一行", "中文 detail 第二行"])

    def test_api_errors(self):
        status, payload = self.get_json(f"/api/children?path={self.q('nope')}")
        self.assertEqual(status, 404)
        self.assertIn("error", payload)

        status, payload = self.get_json(f"/api/children?path={self.q('apps/main.tsx')}")
        self.assertEqual(status, 400)
        self.assertIn("error", payload)

        status, payload = self.get_json(f"/api/detail?path={self.q('apps/nope.ts')}")
        self.assertEqual(status, 404)

        status, payload = self.get_json("/api/detail")
        self.assertEqual(status, 400)

        status, payload = self.get_json(f"/api/children?path={self.q('../escape')}")
        self.assertEqual(status, 400)
        self.assertIn("'..'", payload["error"])

        status, payload = self.get_json("/api/unknown")
        self.assertEqual(status, 404)

    def test_write_methods_rejected(self):
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            with self.subTest(method=method):
                status, payload = self.get_json_via(method)
                self.assertEqual(status, 405)
                self.assertIn("只读", payload["error"])

    def get_json_via(self, method: str):
        conn = http.client.HTTPConnection(self.host, self.port, timeout=10)
        try:
            conn.request(method, "/api/children")
            resp = conn.getresponse()
            return resp.status, json.loads(resp.read().decode("utf-8"))
        finally:
            conn.close()

    def test_static_index_missing_hint(self):
        status, ctype, data = self.request("GET", "/")
        self.assertEqual(status, 503)
        self.assertIn("text/html", ctype or "")
        text = data.decode("utf-8")
        self.assertIn("npm run build", text)
        self.assertIn("前端", text)

    def test_snapshot_bytes_unchanged_after_traffic(self):
        # 类级 tearDownClass 做终态断言；此处做过程中的即时复核
        status, _ = self.get_json("/api/root")
        self.assertEqual(status, 200)
        self.assertEqual(
            hashlib.sha256(self.snapshot_path.read_bytes()).hexdigest(), self.before_digest
        )


class StaticServingTest(HttpServerBase):
    @classmethod
    def setUpClass(cls):
        import tempfile as _tf

        cls._static_tmp = _tf.TemporaryDirectory()
        static = Path(cls._static_tmp.name) / "build"
        (static / "assets").mkdir(parents=True)
        (static / "index.html").write_text(
            "<!doctype html><title>viewer</title><p>页面 OK</p>", encoding="utf-8", newline="\n"
        )
        (static / "assets" / "app.js").write_text("console.log('ok');", encoding="utf-8", newline="\n")
        (static / "assets" / "style.css").write_text("body{}", encoding="utf-8", newline="\n")
        cls.start_server(static_dir=static)
        # 穿越目标：静态目录之外的敏感文件
        (Path(cls._static_tmp.name) / "secret.txt").write_text("secret", encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        cls._static_tmp.cleanup()
        cls.tmp.cleanup()

    def test_index_served_as_html(self):
        status, ctype, data = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype or "")
        self.assertIn("页面 OK", data.decode("utf-8"))

    def test_assets_served_with_mime(self):
        cases = [
            ("/assets/app.js", "text/javascript"),
            ("/assets/style.css", "text/css"),
        ]
        for url, mime in cases:
            with self.subTest(url=url):
                status, ctype, data = self.request("GET", url)
                self.assertEqual(status, 200)
                self.assertIn(mime, ctype or "")

    def test_unknown_static_file_404(self):
        for url in ("/nonexistent.js", "/favicon.ico", "/index.html.bak"):
            with self.subTest(url=url):
                status, _, _ = self.request("GET", url)
                self.assertEqual(status, 404)

    def test_path_traversal_blocked(self):
        cases = [
            "/%2e%2e/secret.txt",        # 解码后 /../secret.txt
            "/..%2fsecret.txt",           # 解码后 /../secret.txt
            "/%2e%2e%2f%2e%2e%2fsecret.txt",
            "/assets/..%2f..%2fsecret.txt",
            "/..%5c..%5csecret.txt",      # 反斜杠变体
        ]
        for url in cases:
            with self.subTest(url=url):
                status, _, data = self.request("GET", url)
                self.assertEqual(status, 404, f"{url} 不应命中静态目录外文件: {data!r}")

    def test_snapshot_file_not_exposed_as_static(self):
        # 快照与查看器源码不在静态目录内，不得经页面路径读到（G20）
        for url in ("/tree.json", "/viewer.py", "/viewer_core.py"):
            with self.subTest(url=url):
                status, _, _ = self.request("GET", url)
                self.assertEqual(status, 404)


# ---------------------------------------------------------------------------
# CLI 入口：真实子进程启动、地址输出、参数校验（G01）
# ---------------------------------------------------------------------------


class ViewerCliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.snapshot_path = Path(self.tmp.name) / "tree.json"
        self.snapshot_path.write_text(compact_dumps(make_snapshot_data()), encoding="utf-8", newline="\n")

    def run_cli(self, *args, timeout=30):
        return subprocess.run(
            [sys.executable, str(VIEWER_ENTRY), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )

    def test_cli_requires_tree_json_argument(self):
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tree_json", result.stderr + result.stdout)

    def test_cli_missing_snapshot_refuses_to_start(self):
        result = self.run_cli(str(Path(self.tmp.name) / "nope.json"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("无法启动查看器", result.stderr + result.stdout)

    def test_cli_invalid_snapshot_refuses_to_start(self):
        bad = Path(self.tmp.name) / "bad.json"
        bad.write_text("{broken", encoding="utf-8", newline="\n")
        result = self.run_cli(str(bad))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("JSON", result.stderr + result.stdout)

    def test_cli_starts_prints_url_and_serves(self):
        before = sha256_file(self.snapshot_path)
        proc = subprocess.Popen(
            [sys.executable, str(VIEWER_ENTRY), str(self.snapshot_path), "--port", "0"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.addCleanup(proc.terminate)
        lines: list[str] = []
        reader = threading.Thread(target=lambda: lines.extend(proc.stdout or []), daemon=True)
        reader.start()

        port = None
        deadline = time.time() + 20
        while time.time() < deadline and port is None:
            for line in list(lines):
                match = re.search(r"http://127\.0\.0\.1:(\d+)/", line)
                if match:
                    port = int(match.group(1))
                    break
            if port is None and proc.poll() is not None:
                break
            time.sleep(0.1)
        self.assertIsNotNone(port, f"未在输出中解析到访问地址，输出: {lines}")

        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            conn.request("GET", "/api/root")
            resp = conn.getresponse()
            payload = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(resp.status, 200)
            self.assertEqual(payload["counts"], COUNTS)
        finally:
            conn.close()

        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        self.assertEqual(sha256_file(self.snapshot_path), before)


if __name__ == "__main__":
    unittest.main()
