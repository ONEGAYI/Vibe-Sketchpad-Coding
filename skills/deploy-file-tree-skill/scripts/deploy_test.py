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
        # 空数据为脚本规范形态
        self.assertEqual(
            (skill / "tree.json").read_text(encoding="utf-8"), '{\n  "tree": {}\n}\n'
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
        # 再次部署不再迁移（幂等）
        log = run_deploy(target)
        self.assertNotIn("规范化迁移", "".join(log))

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
