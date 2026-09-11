"""deploy-file-tree-skill 契约测试。

运行：python ~/.agents/skills/deploy-file-tree-skill/scripts/deploy_test.py
沙箱模式：临时目录模拟目标仓库与源仓库，dist 只读（update-dist 用独立 dist_root）。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import deploy  # noqa: E402
from deploy import DIST, DIST_FILES  # noqa: E402
from deploy import deploy as run_deploy  # noqa: E402
from deploy import update_dist  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
