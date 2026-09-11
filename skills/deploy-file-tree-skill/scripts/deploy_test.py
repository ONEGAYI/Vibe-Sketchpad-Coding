"""deploy-file-tree-skill 契约测试。

运行：python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy_test.py
沙箱模式：临时目录模拟目标仓库与源仓库，dist 只读（update-dist 用独立 dist_root）。
GUI 发行用例（工单 #21，G16/G18/G19）：dist/viewer/ 静态资源完整性、
组装器镜像幂等、部署含 viewer 资源、过期 hash 清理、旧排版延迟转换保护，
以及"部署后无 Node 启动"的清洁 PATH 子进程全链验证。
"""

from __future__ import annotations

import http.client
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import deploy  # noqa: E402
from deploy import DIST, DIST_FILES  # noqa: E402
from deploy import deploy as run_deploy  # noqa: E402
from deploy import update_dist  # noqa: E402

# dist 内受控发行静态资源目录（G18）；viewer 后端脚本随固定清单部署（G19）
VIEWER_STATIC_REL = "viewer"
VIEWER_SCRIPTS = (
    "scripts/viewer.py",
    "scripts/viewer_core.py",
    "scripts/viewer_test.py",
    "scripts/gen_viewer_sample.py",
    "scripts/bench_viewer.py",
)
ASSEMBLE_SCRIPT = Path(__file__).parent / "assemble_viewer.py"


class DeployTest(unittest.TestCase):
    def make_target(self) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name).resolve()
        (root / "src").mkdir()  # 让目标看起来像个项目
        return root

    def make_side_tool(self, target: Path):
        """以与部署副本同源的脚本逻辑构造实例侧 TreeTool（与 deploy() 内部参数一致）。"""
        ft = deploy.load_tree_tool()
        skill = target / ".agents/skills/file-tree"
        tool = ft.TreeTool(
            tree_json=skill / "tree.json",
            agents_md=target / "AGENTS.md",
            repo_root=target,
            root_name=target.name,
            history_path=ft.default_history_path(target, skill),
            legacy_history_paths=(skill / ".history.json",),
        )
        return ft, tool

    @staticmethod
    def legacy_dumps(data: dict) -> str:
        """独立旧编码规则：两空格缩进 + 末尾 LF（不经新的 write_data 构造旧样本）。"""
        return json.dumps(data, ensure_ascii=False, indent=2) + "\n"

    def test_dist_bundle_complete(self):
        for rel in DIST_FILES:
            self.assertTrue((DIST / rel).is_file(), f"dist 缺文件: {rel}")

    def test_deploy_bare_initializes(self):
        target = self.make_target()
        log = run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        # 四件套就位
        for rel in DIST_FILES:
            self.assertTrue((skill / rel).is_file(), rel)
            self.assertEqual((skill / rel).read_bytes(), (DIST / rel).read_bytes())
        # 空数据为脚本规范形态（紧凑单行 JSON + 末尾 LF；空 tags 词表被规范化剔除）
        self.assertEqual(
            (skill / "tree.json").read_text(encoding="utf-8"), '{"tree":{}}\n'
        )
        # AGENTS.md 生成骨架并含两标记块
        agents = (target / "AGENTS.md").read_text(encoding="utf-8")
        self.assertTrue(agents.startswith("# AGENTS"))
        self.assertIn("file-tree:tree:begin", agents)
        self.assertIn("file-tree:tags:begin", agents)
        self.assertIn("首次部署", "".join(log))

    def test_deploy_upgrade_preserves_data_and_history(self):
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        # 目标侧录入数据（走与部署副本同源的脚本逻辑）
        ft = deploy.load_tree_tool()
        tool = ft.TreeTool(
            tree_json=skill / "tree.json",
            agents_md=target / "AGENTS.md",
            repo_root=target,
            root_name=target.name,
            history_path=ft.default_history_path(target, skill),
            legacy_history_paths=(skill / ".history.json",),
        )
        tool.add("a.rs", desc="甲", detail=["甲文件"])
        history_file = tool.history_path
        self.assertTrue(history_file.exists())
        # 再次部署 = 升级：数据与历史原样
        log = run_deploy(target)
        self.assertIn("升级", "".join(log))
        self.assertEqual(tool.get("a.rs")["desc"], "甲")
        self.assertTrue(history_file.exists())

    def test_deploy_migrates_legacy_tree_json(self):
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        # 手放旧版形态数据（无 kind 派生字段）
        (skill / "tree.json").write_text(
            '{\n  "tags": {},\n  "tree": {\n    "a.rs": {\n      "desc": "甲",\n'
            '      "detail": [\n        "甲文件"\n      ]\n    }\n  }\n}\n',
            encoding="utf-8",
            newline="\n",
        )
        log = run_deploy(target)
        joined = "".join(log)
        self.assertIn("规范化迁移", joined)
        # 迁移只补派生字段，数据语义不变
        data = json.loads((skill / "tree.json").read_text(encoding="utf-8"))
        entry = data["tree"]["a.rs"]
        self.assertEqual(entry["kind"], "file")
        self.assertEqual(entry["desc"], "甲")
        self.assertEqual(entry["detail"], ["甲文件"])
        # 结构迁移直接输出新紧凑规范（规格 F12，字节级断言）且自检通过
        ft = deploy.load_tree_tool()
        migrated = (skill / "tree.json").read_text(encoding="utf-8")
        self.assertEqual(migrated, ft.dumps_canonical(data))
        self.assertIn("check 自检通过", joined)
        # 再次部署不再迁移（幂等）
        log = run_deploy(target)
        self.assertNotIn("规范化迁移", "".join(log))

    # ---------- 升级保留旧排版、后续写入转换（规格 #13 F11 / 工单 #15） ----------

    def test_deploy_upgrade_keeps_legacy_layout_bytes(self):
        # 结构规范、仅两空格旧排版：升级部署不重写任何数据字节、不触碰历史、
        # 日志不得宣称已迁移；get / check --strict 照常可用且不改数据
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])  # 业务数据 + 一步撤销历史
        history_file = tool.history_path
        # 独立旧编码规则覆盖排版：结构规范（含派生 kind、规范键序），仅缩进不同
        legacy_text = self.legacy_dumps(ft.normalize_data(tool.load()))
        (skill / "tree.json").write_text(legacy_text, encoding="utf-8", newline="\n")
        before = (skill / "tree.json").read_bytes()
        hist_before = history_file.read_bytes()

        log = run_deploy(target)
        joined = "".join(log)

        self.assertIn("升级", joined)
        self.assertNotIn("规范化迁移", joined)  # 仅排版旧不得宣称已迁移
        self.assertIn("保留原排版", joined)  # 部署器明确识别到旧排版而非碰巧未写
        self.assertEqual((skill / "tree.json").read_bytes(), before)  # 数据字节原样
        self.assertEqual(history_file.read_bytes(), hist_before)  # 历史字节原样
        # 只读与检查命令不改数据，旧排版照常可用
        self.assertEqual(tool.get("a.rs")["desc"], "甲")
        errors, warnings = tool.check(strict=True)
        self.assertEqual((errors, warnings), ([], []))
        self.assertEqual((skill / "tree.json").read_bytes(), before)

    def test_write_after_legacy_upgrade_converts_to_compact(self):
        # 上一场景紧接一次正常写入：业务修改正确、落盘转换为新紧凑规范、
        # 历史仅记该业务操作（部署与格式转换都不占历史步骤）
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])
        legacy_text = self.legacy_dumps(ft.normalize_data(tool.load()))
        (skill / "tree.json").write_text(legacy_text, encoding="utf-8", newline="\n")
        run_deploy(target)  # 升级保留旧排版
        self.assertEqual(
            (skill / "tree.json").read_text(encoding="utf-8"), legacy_text
        )  # 升级后仍是旧排版字节
        self.assertEqual(tool.history_summary(), (["add a.rs"], []))  # 部署不占历史

        tool.add("b.rs", desc="乙", detail=["乙文件"])  # 紧接一次正常写入

        self.assertEqual(tool.get("b.rs")["desc"], "乙")  # 业务修改正确
        self.assertEqual(tool.get("a.rs")["desc"], "甲")
        text = (skill / "tree.json").read_text(encoding="utf-8")
        self.assertEqual(text, ft.dumps_canonical(ft.normalize_data(tool.load())))  # 新紧凑
        self.assertNotEqual(text, legacy_text)  # 已脱离旧排版
        self.assertEqual(
            tool.history_summary(), (["add a.rs", "add b.rs"], [])
        )  # 仅记该业务操作

    def test_deploy_redeploy_compact_unchanged(self):
        # 已是新紧凑规范（字节精确）：重复部署数据与历史字节不变、无迁移日志，
        # 也不得记"保留原排版"提示——文件本已是新规范，措辞须与事实相符
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        _ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])  # write_data 落盘即新紧凑规范
        before = (skill / "tree.json").read_bytes()
        hist_before = tool.history_path.read_bytes()

        log = run_deploy(target)

        self.assertEqual((skill / "tree.json").read_bytes(), before)
        self.assertEqual(tool.history_path.read_bytes(), hist_before)
        joined = "".join(log)
        self.assertNotIn("规范化迁移", joined)
        self.assertNotIn("保留原排版", joined)

    def test_deploy_upgrade_keeps_crlf_bytes(self):
        # CRLF 换行的规范数据：升级同样不重写——部署与 check 共用同一 CRLF 归一口径。
        # 行尾差异不构成"旧排版"：已是新规范（CRLF 变体），不得记"保留原排版"提示
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        _ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])
        raw = (skill / "tree.json").read_text(encoding="utf-8")
        (skill / "tree.json").write_text(
            raw.replace("\n", "\r\n"), encoding="utf-8", newline=""
        )
        before = (skill / "tree.json").read_bytes()

        log = run_deploy(target)

        joined = "".join(log)
        self.assertNotIn("规范化迁移", joined)
        self.assertNotIn("保留原排版", joined)
        self.assertEqual((skill / "tree.json").read_bytes(), before)

    def test_deploy_cleans_stale_files_and_cache(self):
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        # 模拟旧版本残留与缓存
        stale = skill / "scripts" / "old_module.py"
        stale.write_text("# 旧版残留\n", encoding="utf-8")
        stale_dir = skill / "legacy" / "sub"
        stale_dir.mkdir(parents=True)
        (stale_dir / "old.txt").write_text("旧", encoding="utf-8")
        pycache = skill / "scripts" / "__pycache__"
        pycache.mkdir()
        (pycache / "tree_tool.cpython-314.pyc").write_bytes(b"\x00")
        log = run_deploy(target)
        joined = "".join(log)
        self.assertFalse(stale.exists())  # 旧文件清理
        self.assertFalse((skill / "legacy").exists())  # 空目录回收
        self.assertFalse(pycache.exists())  # 缓存清理
        self.assertIn("清理", joined)
        # 保护文件不受镜像清理影响
        self.assertTrue((skill / "tree.json").is_file())

    def test_deploy_idempotent_no_recopy(self):
        target = self.make_target()
        run_deploy(target)
        log = run_deploy(target)
        self.assertFalse([l for l in log if "复制" in l])
        self.assertFalse([l for l in log if "清理" in l])

    def test_deploy_missing_target_raises(self):
        with self.assertRaises(deploy.DeployError):
            run_deploy(Path(tempfile.gettempdir()) / "no-such-dir-xyz")

    def test_main_unhealthy_target_reports_readable_error(self):
        # 目标仓存量数据不健康（自检失败）→ main 应打印可读错误并返回 2，
        # 而非在 except 求值时 NameError 崩溃、掩盖真实错误（曾发生于 Semitronix 升级）
        import contextlib
        import io

        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        ft = deploy.load_tree_tool()
        data = {"tags": {}, "tree": {"a.rs": {
            "kind": "file", "desc": "甲", "detail": ["甲文件"], "rel": ["gone.rs"],
        }}}
        (skill / "tree.json").write_text(
            ft.dumps_canonical(ft.normalize_data(data)), encoding="utf-8", newline="\n"
        )  # 规范形态 + 悬空 rel：迁移不碰语义，check 必报错
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = deploy.main(["deploy", str(target)])
        self.assertEqual(code, 2)
        self.assertIn("错误", err.getvalue())

    def test_deploy_requires_complete_dist(self):
        target = self.make_target()
        with tempfile.TemporaryDirectory() as tmp:
            fake_dist = Path(tmp)  # 空 dist
            with self.assertRaises(deploy.DeployError):
                run_deploy(target, dist_root=fake_dist)

    # ---------- GUI 发行资源随技能部署（工单 #21，G19） ----------

    def test_deploy_copies_viewer_scripts_and_static(self):
        # viewer 后端脚本与 dist/viewer/ 静态资源全部镜像到目标，字节一致
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        for rel in VIEWER_SCRIPTS:
            self.assertTrue((skill / rel).is_file(), f"缺 {rel}")
            self.assertEqual((skill / rel).read_bytes(), (DIST / rel).read_bytes(), rel)
        static_src = DIST / VIEWER_STATIC_REL
        files = [p for p in static_src.rglob("*") if p.is_file()]
        self.assertTrue(files, "dist/viewer/ 无静态资源（先构建组装）")
        for src in files:
            rel = src.relative_to(static_src)
            dest = skill / VIEWER_STATIC_REL / rel
            self.assertTrue(dest.is_file(), f"缺 viewer 静态资源 {rel}")
            self.assertEqual(dest.read_bytes(), src.read_bytes(), str(rel))

    def test_deploy_cleans_stale_hash_assets_keeps_data(self):
        # 过期 hash 静态资源不残留；现行 viewer 资源不被误删；目标数据不动
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        assets = skill / VIEWER_STATIC_REL / "assets"
        stale = assets / "index-deadBEEF.js"
        stale.write_text("// 旧 hash 残留", encoding="utf-8")
        _ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])
        data_before = (skill / "tree.json").read_bytes()

        log = run_deploy(target)

        self.assertFalse(stale.exists())  # 旧 hash 清理
        self.assertTrue((skill / VIEWER_STATIC_REL / "index.html").is_file())
        self.assertTrue(list(assets.glob("*.js")))  # 现行资源仍在
        self.assertEqual((skill / "tree.json").read_bytes(), data_before)  # 数据不动
        self.assertIn("清理", "".join(log))

    def test_deploy_upgrade_keeps_legacy_layout_with_viewer_assets(self):
        # #15 延迟转换在 GUI 发行资源随技能部署时同样成立：
        # 有效旧排版升级不被 GUI 安装提前转换（字节相同），资源照常就位
        target = self.make_target()
        run_deploy(target)
        skill = target / ".agents/skills/file-tree"
        ft, tool = self.make_side_tool(target)
        tool.add("a.rs", desc="甲", detail=["甲文件"])
        legacy_text = self.legacy_dumps(ft.normalize_data(tool.load()))
        (skill / "tree.json").write_text(legacy_text, encoding="utf-8", newline="\n")
        before = (skill / "tree.json").read_bytes()

        run_deploy(target)

        self.assertTrue((skill / VIEWER_STATIC_REL / "index.html").is_file())  # GUI 资源已装
        self.assertEqual((skill / "tree.json").read_bytes(), before)  # 旧排版字节不变
        self.assertEqual((skill / "tree.json").read_text(encoding="utf-8"), legacy_text)


class UpdateDistTest(unittest.TestCase):
    def test_update_dist_copies_from_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_skill = root / "src-repo" / ".agents" / "skills" / "file-tree"
            for rel in DIST_FILES:
                dest = src_skill / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(f"# {rel} 新版\n", encoding="utf-8")
            dist_root = root / "dist"
            log = update_dist(root / "src-repo", dist_root=dist_root)
            for rel in DIST_FILES:
                self.assertEqual(
                    (dist_root / rel).read_text(encoding="utf-8"), f"# {rel} 新版\n"
                )
            self.assertEqual(len([l for l in log if "更新" in l]), len(DIST_FILES))

    def test_update_dist_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            src_skill = root / "src-repo" / ".agents" / "skills" / "file-tree"
            for rel in DIST_FILES:
                dest = src_skill / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text("v1", encoding="utf-8")
            dist_root = root / "dist"
            update_dist(root / "src-repo", dist_root=dist_root)
            log = update_dist(root / "src-repo", dist_root=dist_root)
            self.assertIn("无更新", "".join(log))


class ViewerDistCompletenessTest(unittest.TestCase):
    """发行资源完整性（G18）：dist/viewer/ 受控快照齐备、不依赖 CDN。"""

    def test_dist_viewer_index_present_no_external_refs(self):
        index = DIST / VIEWER_STATIC_REL / "index.html"
        self.assertTrue(index.is_file(), "dist/viewer/index.html 缺失（先构建组装）")
        html = index.read_text(encoding="utf-8")
        refs = re.findall(r'(?:src|href)\s*=\s*"([^"]+)"', html)
        self.assertTrue(refs, "发行页面未引用任何资源，疑似异常产物")
        for ref in refs:
            self.assertIsNone(
                re.match(r"^(?:[a-z][a-z0-9+.-]*:)?//", ref),
                f"发行页面存在外链依赖（不得依赖 CDN）: {ref}",
            )
            if ref.startswith(("data:", "mailto:", "#")):
                continue
            local = index.parent / ref.split("?")[0].split("#")[0]
            self.assertTrue(local.is_file(), f"发行资源缺失: {ref}")

    def test_dist_viewer_assets_present(self):
        assets = DIST / VIEWER_STATIC_REL / "assets"
        self.assertTrue(assets.is_dir(), "dist/viewer/assets/ 缺失")
        self.assertTrue(list(assets.glob("*.js")), "assets 缺 JS 产物")
        self.assertTrue(list(assets.glob("*.css")), "assets 缺 CSS 产物")


class AssembleViewerTest(unittest.TestCase):
    """发行组装器（assemble_viewer.py）契约：build → dist/viewer 镜像、幂等、外链拒绝。"""

    def assemble(self, build: Path, dest: Path):
        return subprocess.run(
            [sys.executable, str(ASSEMBLE_SCRIPT), "--build", str(build), "--dest", str(dest)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )

    @staticmethod
    def make_build(root: Path, js_name: str = "app-AbC123.js") -> Path:
        build = root / "build"
        (build / "assets").mkdir(parents=True)
        (build / "assets" / js_name).write_text("console.log(1);", encoding="utf-8")
        (build / "assets" / "style-DeF456.css").write_text("body{}", encoding="utf-8")
        (build / "index.html").write_text(
            '<!doctype html><title>v</title>'
            f'<script type="module" src="./assets/{js_name}"></script>'
            '<link rel="stylesheet" href="./assets/style-DeF456.css">',
            encoding="utf-8",
            newline="\n",
        )
        return build

    def test_assemble_mirrors_build_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = self.make_build(root)
            dest = root / "dist-viewer"
            r1 = self.assemble(build, dest)
            self.assertEqual(r1.returncode, 0, r1.stderr)
            self.assertTrue((dest / "index.html").is_file())
            self.assertEqual(
                (dest / "assets" / "app-AbC123.js").read_bytes(),
                (build / "assets" / "app-AbC123.js").read_bytes(),
            )
            r2 = self.assemble(build, dest)
            self.assertEqual(r2.returncode, 0, r2.stderr)
            self.assertIn("无变更", r2.stdout)  # 幂等：第二次无复制

    def test_assemble_cleans_stale_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = self.make_build(root)
            dest = root / "dist-viewer"
            self.assemble(build, dest)
            # 重新构建产出新 hash：dest 中旧 hash 残留必须被清理
            build_new = self.make_build(root.parent / f"{root.name}-b2", js_name="app-NeW789.js")
            result = self.assemble(build_new, dest)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((dest / "assets" / "app-AbC123.js").exists())
            self.assertTrue((dest / "assets" / "app-NeW789.js").is_file())

    def test_assemble_rejects_external_refs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build = self.make_build(root)
            (build / "index.html").write_text(
                '<script src="https://cdn.example.com/lib.js"></script>',
                encoding="utf-8",
                newline="\n",
            )
            result = self.assemble(build, root / "dist-viewer")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("外链", result.stderr + result.stdout)

    def test_assemble_requires_build_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = self.assemble(root / "no-build", root / "dist-viewer")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("npm run build", result.stderr + result.stdout)


def viewer_sample_data() -> dict:
    """无 Node 启动测试用固定样本：中文、目录、rel 关联（正反向）。"""
    return {
        "root": "离线演示",
        "tags": {"doc": "说明文档"},
        "tree": {
            "apps": {
                "kind": "dir",
                "desc": "应用目录",
                "children": {
                    "main.ts": {
                        "kind": "file",
                        "desc": "入口",
                        "detail": ["应用入口文件"],
                        "tags": ["doc"],
                        "rel": ["apps/util.ts"],
                    },
                    "util.ts": {
                        "kind": "file",
                        "desc": "工具",
                        "detail": ["工具函数集"],
                    },
                },
            }
        },
    }


def compact_dumps(data: dict) -> str:
    """独立新编码规则（紧凑单行 + 末尾 LF）：标准库直调，不经被测实现。"""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


class NoNodeLaunchTest(unittest.TestCase):
    """G16 验收：部署后的目标在 PATH 无 Node 环境启动 GUI，全链可用、换 JSON 只需刷新。"""

    @staticmethod
    def minimal_path_without_node() -> str:
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        path = os.pathsep.join([os.path.join(system_root, "System32"), system_root])
        for exe in ("node", "npm", "npx"):
            if shutil.which(exe, path=path) is not None:
                raise unittest.SkipTest(f"无法构造无 {exe} 的清洁 PATH")
        return path

    def setUp(self):
        self._target_tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._target_tmp.cleanup)
        self._outside_tmp = tempfile.TemporaryDirectory()  # 仓库外快照目录
        self.addCleanup(self._outside_tmp.cleanup)
        self.target = Path(self._target_tmp.name).resolve()
        (self.target / "src").mkdir()
        self.snapshot = Path(self._outside_tmp.name).resolve() / "tree.json"
        self.snapshot.write_text(
            compact_dumps(viewer_sample_data()), encoding="utf-8", newline="\n"
        )

    def request(self, port: int, method: str, path: str):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            conn.request(method, path)
            resp = conn.getresponse()
            data = resp.read()
            return resp.status, resp.getheader("Content-Type"), data
        finally:
            conn.close()

    def get_json(self, port: int, path: str):
        status, _ctype, data = self.request(port, "GET", path)
        self.assertEqual(status, 200, f"{path} -> {status}: {data[:200]!r}")
        return json.loads(data.decode("utf-8"))

    def test_deployed_viewer_runs_without_node_in_path(self):
        run_deploy(self.target)
        viewer_py = self.target / ".agents/skills/file-tree/scripts/viewer.py"
        self.assertTrue(viewer_py.is_file())
        self.assertTrue(
            (self.target / ".agents/skills/file-tree" / VIEWER_STATIC_REL / "index.html").is_file()
        )

        clean_path = self.minimal_path_without_node()
        env = dict(os.environ)
        env["PATH"] = clean_path  # 剥离 node/npm/npx（构建工具不进运行链）
        proc = subprocess.Popen(
            [sys.executable, str(viewer_py), str(self.snapshot), "--port", "0"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
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
        self.assertIsNotNone(port, f"清洁 PATH 下未解析到访问地址，输出: {lines}")

        # 页面（发行静态资源）与目录/详情/搜索/关联全链
        status, ctype, data = self.request(port, "GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype or "")
        self.assertIn(b"<script", data)  # 真实前端页面而非占位提示
        self.assertEqual(self.get_json(port, "/api/root")["counts"]["total"], 3)
        children = self.get_json(port, "/api/children?path=")
        self.assertEqual([c["name"] for c in children["children"]], ["apps"])
        detail = self.get_json(port, "/api/detail?path=apps/main.ts")
        self.assertEqual(detail["rel"][0]["path"], "apps/util.ts")
        self.assertTrue(detail["rel"][0]["exists"])
        back = self.get_json(port, "/api/detail?path=apps/util.ts")
        self.assertEqual([b["path"] for b in back["backrefs"]], ["apps/main.ts"])
        search = self.get_json(port, "/api/search?kw=入口")
        self.assertEqual(search["total"], 1)
        self.assertEqual(search["results"][0]["path"], "apps/main.ts")

        # 替换 JSON 后刷新生效，无需重新构建/重启
        new_data = viewer_sample_data()
        new_data["tree"]["docs"] = {"kind": "dir", "desc": "文档目录", "children": {}}
        self.snapshot.write_text(compact_dumps(new_data), encoding="utf-8", newline="\n")
        status, _ctype, data = self.request(port, "POST", "/api/refresh")
        self.assertEqual(status, 200, data[:200])
        payload = json.loads(data.decode("utf-8"))
        self.assertTrue(payload["refreshed"])
        self.assertEqual(payload["counts"]["total"], 4)
        self.assertEqual(self.get_json(port, "/api/root")["counts"]["total"], 4)

        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        reader.join(timeout=2)
        if proc.stdout:
            proc.stdout.close()


if __name__ == "__main__":
    unittest.main()
