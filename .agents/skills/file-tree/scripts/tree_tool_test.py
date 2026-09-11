"""file-tree 技能脚本契约测试。

运行：python .agents/skills/file-tree/scripts/tree_tool_test.py
沙箱模式：所有用例在临时目录中构造 tree.json / SKILL.md / AGENTS.md，不触仓库。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from tree_tool import (  # noqa: E402
    ToolError,
    TreeTool,
    _cmd_add,
    _cmd_add_batch,
    _cmd_get,
    _cmd_mark,
    _cmd_mv,
    _cmd_mv_batch,
    _cmd_query,
    _cmd_rm_batch,
    _cmd_root,
    default_history_path,
    dumps_canonical,
    dumps_canonical_legacy,
    is_canonical_text,
    normalize_data,
    replace_block,
    resolve_git_dir,
    sort_key,
    split_rel_path,
)

AGENTS_TEMPLATE = "# AGENTS\n"


def make_data() -> dict:
    return {
        "tags": {"pure": "纯函数", "test": "测试"},
        "tree": {
            "apps": {
                "desc": "应用层",
                "children": {
                    "main.tsx": {"desc": "入口", "detail": ["分派主窗", "双面板"]},
                    "util.ts": {"desc": "工具", "detail": ["纯函数工具集"], "tags": ["pure"]},
                },
            },
            "Cargo.toml": {"desc": "根配置", "detail": ["workspace 根：成员与依赖版本、release 配置"]},
        },
    }


def legacy_dumps(data: dict) -> str:
    """独立旧编码规则（两空格缩进 + 末尾 LF）：标准库直调，不经被测写入路径。

    专用于构造"结构规范、仅排版旧"的历史样本。
    """
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def compact_dumps(data: dict) -> str:
    """独立新编码规则（紧凑单行 + 末尾 LF）：标准库直调，与被测实现无转发关系。

    作为参数化用例的独立期望（锁死 separators 组合本身，而非转发实现参数）。
    """
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"


class SandboxTest(unittest.TestCase):
    """基类：为每个用例搭临时沙箱并返回配置好的 TreeTool。"""

    def make_tool(
        self,
        data: dict | None = None,
        git_files: set[str] | None = None,
        tracked_files: set[str] | None = None,
        history_limit: int = 20,
    ) -> TreeTool:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        skill_dir = root / ".agents" / "skills" / "file-tree"
        (skill_dir / "scripts").mkdir(parents=True)
        tool = TreeTool(
            tree_json=skill_dir / "tree.json",
            agents_md=root / "AGENTS.md",
            repo_root=root,
            root_name="Demo",
            history_path=skill_dir / ".history.json",
            history_limit=history_limit,
        )
        tool.write_data(data if data is not None else make_data())
        tool.agents_md.write_text(AGENTS_TEMPLATE, encoding="utf-8", newline="\n")
        if git_files is not None:
            tool.git_files_override = git_files
        if tracked_files is not None:
            tool.git_tracked_override = tracked_files
        return tool


class SortKeyTest(unittest.TestCase):
    def test_case_insensitive_then_codepoint(self):
        names = ["b.ts", "A.ts", "a.ts", "B.ts", "_x", "Zz"]
        self.assertEqual(sorted(names, key=sort_key), ["_x", "A.ts", "a.ts", "B.ts", "b.ts", "Zz"])


class SplitPathTest(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(split_rel_path("a/b/c.rs"), ["a", "b", "c.rs"])
        self.assertEqual(split_rel_path("a//b/"), ["a", "b"])

    def test_rejects_absolute_and_dotdot(self):
        for bad in ("/a", "a/../b", "..", "C:\\a", "a/./b"):
            with self.assertRaises(ToolError, msg=bad):
                split_rel_path(bad)


class NormalizeTest(unittest.TestCase):
    def test_sorts_and_drops_empty_and_keeps_detail_order(self):
        data = {
            "tags": {"z": "", "a": "说明"},
            "tree": {
                "b.rs": {"desc": "b", "detail": [], "rel": ["x/a.rs", "x/a.rs"], "tags": ["t", "t"]},
                "a.rs": {"desc": "a", "detail": ["二", "一"], "children": {"z.rs": {"desc": "z"}, "y.rs": {"desc": "y"}}},
            },
        }
        out = normalize_data(data)
        self.assertEqual(list(out["tree"]), ["a.rs", "b.rs"])  # 排序
        self.assertEqual(list(out["tree"]["a.rs"]["children"]), ["y.rs", "z.rs"])  # 子级排序
        self.assertEqual(out["tree"]["a.rs"]["detail"], ["二", "一"])  # detail 顺序保留
        self.assertNotIn("detail", out["tree"]["b.rs"])  # 空列表移除
        self.assertEqual(out["tree"]["b.rs"]["rel"], ["x/a.rs"])  # rel 去重排序
        self.assertEqual(out["tree"]["b.rs"]["tags"], ["t"])
        self.assertEqual(list(out["tags"]), ["a"])  # 空说明的标签移除
        # 字段固定顺序：kind, desc, detail, rel, tags, collapsed, hidden, children
        keys = list(out["tree"]["a.rs"])
        self.assertEqual(keys, ["kind", "desc", "detail", "children"])

    def test_field_order_canonical(self):
        node = {"children": {}, "tags": ["t"], "rel": ["a.rs"], "detail": ["d"], "desc": "x"}
        out = normalize_data({"tags": {"t": "说明"}, "tree": {"n": node}})
        self.assertEqual(list(out["tree"]["n"]), ["kind", "desc", "detail", "rel", "tags", "children"])

    def test_render_flags_false_dropped_and_ordered(self):
        node = {"desc": "x", "collapsed": False, "hidden": False}
        out = normalize_data({"tags": {}, "tree": {"n": node}})
        self.assertEqual(list(out["tree"]["n"]), ["kind", "desc"])  # false 默认值不落盘
        node = {"desc": "x", "hidden": True, "collapsed": True, "children": {}}
        out = normalize_data({"tags": {}, "tree": {"n": node}})
        self.assertEqual(list(out["tree"]["n"]), ["kind", "desc", "collapsed", "hidden", "children"])

    def test_render_flags_must_be_bool(self):
        data = {"tags": {}, "tree": {"n": {"desc": "x", "hidden": "yes"}}}
        with self.assertRaises(ToolError):
            normalize_data(data)
        data = {"tags": {}, "tree": {"n": {"desc": "x", "children": {}, "collapsed": 1}}}
        with self.assertRaises(ToolError):
            normalize_data(data)

    def test_collapsed_rejected_on_file_node(self):
        data = {"tags": {}, "tree": {"f.rs": {"desc": "x", "collapsed": True}}}
        with self.assertRaises(ToolError):
            normalize_data(data)

    def test_git_ignore_flag_canonical(self):
        node = {"desc": "x", "git-ignore": False}
        out = normalize_data({"tags": {}, "tree": {"n": node}})
        # git-ignore 三态：键在即显式设置，true/false 均落盘（false 覆写祖先豁免）；缺省不落盘 = 继承
        self.assertEqual(list(out["tree"]["n"]), ["kind", "desc", "git-ignore"])
        self.assertIs(out["tree"]["n"]["git-ignore"], False)
        node = {"desc": "x", "hidden": False, "git-ignore": True}
        out = normalize_data({"tags": {}, "tree": {"n": node}})
        # hidden 维持旧惯例（false 默认值不落盘），仅 git-ignore 特殊
        self.assertEqual(list(out["tree"]["n"]), ["kind", "desc", "git-ignore"])
        self.assertIs(out["tree"]["n"]["git-ignore"], True)
        with self.assertRaises(ToolError):  # 非 bool 拒绝（同 collapsed/hidden）
            normalize_data({"tags": {}, "tree": {"n": {"desc": "x", "git-ignore": "yes"}}})


class AddRmTest(SandboxTest):
    def test_add_creates_parent_chain(self):
        tool = self.make_tool(data={"tags": {}, "tree": {}})
        tool.add("a/b/c.rs", desc="新文件")
        node = tool.get("a/b/c.rs")
        self.assertEqual(node["desc"], "新文件")
        self.assertEqual(tool.get("a")["desc"], "")  # 中间目录待补 desc
        self.assertEqual(tool.get("a/b")["children"]["c.rs"]["desc"], "新文件")

    def test_add_upsert_keeps_unspecified_fields(self):
        tool = self.make_tool()
        tool.add("apps/main.tsx", desc="旧", detail=["旧细节"], rel=["Cargo.toml"], tags=["pure"])
        tool.add("apps/main.tsx", desc="新")
        node = tool.get("apps/main.tsx")
        self.assertEqual(node["desc"], "新")
        self.assertEqual(node["detail"], ["旧细节"])
        self.assertEqual(node["rel"], ["Cargo.toml"])
        self.assertEqual(node["tags"], ["pure"])

    def test_add_dir_entry(self):
        tool = self.make_tool(data={"tags": {}, "tree": {}})
        tool.add("logs", desc="日志", is_dir_entry=True)
        self.assertEqual(tool.get("logs"), {"kind": "dir", "desc": "日志", "children": {}})

    def test_add_rejects_unknown_tag(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add("apps/x.rs", desc="x", tags=["nope"])

    def test_add_rejects_bad_path_and_dangling_rel(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add("../escape.rs", desc="x")
        with self.assertRaises(ToolError):
            tool.add("apps/x.rs", desc="x", rel=["not/in/tree.rs"])


class CmdAddTagsTest(SandboxTest):
    """CLI 层 _cmd_add 的 --tags 解析契约：逗号分隔、去空白、None 直通。"""

    def run_cmd_add(self, tool: TreeTool, tags):
        import types

        args = types.SimpleNamespace(
            path="apps/new.ts", desc="新文件", detail=None, rel=None, tags=tags, dir=False,
            collapsed=None, hidden=None, git_ignore=None,
        )
        _cmd_add(tool, args)

    def test_comma_separated_split_into_list(self):
        tool = self.make_tool()
        self.run_cmd_add(tool, "pure,test")
        self.assertEqual(tool.get("apps/new.ts")["tags"], ["pure", "test"])

    def test_trims_whitespace_and_drops_empty_segments(self):
        tool = self.make_tool()
        self.run_cmd_add(tool, " pure , , test ")
        self.assertEqual(tool.get("apps/new.ts")["tags"], ["pure", "test"])

    def test_none_keeps_field_absent(self):
        tool = self.make_tool()
        self.run_cmd_add(tool, None)
        self.assertNotIn("tags", tool.get("apps/new.ts"))

    def test_single_tag_not_split_into_chars(self):
        tool = self.make_tool()
        self.run_cmd_add(tool, "pure")
        self.assertEqual(tool.get("apps/new.ts")["tags"], ["pure"])

    def test_rm_prunes_empty_parents(self):
        tool = self.make_tool(data={"tags": {}, "tree": {}})
        tool.add("a/b/c.rs", desc="x")
        tool.rm("a/b/c.rs")
        self.assertEqual(tool.load()["tree"], {})

    def test_rm_keeps_siblings(self):
        tool = self.make_tool()
        tool.rm("apps/util.ts")
        self.assertIn("main.tsx", tool.get("apps")["children"])

    def test_rm_missing_raises(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.rm("nope.rs")


class TagVocabTest(SandboxTest):
    def test_add_and_remove(self):
        tool = self.make_tool()
        tool.tag_add("generated", desc="生成物")
        self.assertEqual(tool.load()["tags"]["generated"], "生成物")
        tool.tag_rm("generated")
        self.assertNotIn("generated", tool.load()["tags"])

    def test_remove_in_use_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.tag_rm("pure")  # util.ts 在用

    def test_duplicate_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.tag_add("pure", desc="重复")


class RenderTest(SandboxTest):
    def test_brief_snapshot(self):
        tool = self.make_tool()
        self.assertEqual(
            tool.render_brief_tree(),
            "\n".join(
                [
                    "Demo/",
                    "├── apps/      # 应用层",
                    "│   ├── main.tsx # 入口",
                    "│   └── util.ts  # 工具",
                    "└── Cargo.toml # 根配置",
                ]
            ),
        )

    def test_tags_table(self):
        tool = self.make_tool()
        self.assertEqual(
            tool.render_tags_table(),
            "\n".join(
                [
                    "| 标签 | 说明 |",
                    "| --- | --- |",
                    "| `pure` | 纯函数 |",
                    "| `test` | 测试 |",
                ]
            ),
        )

    def test_empty_desc_renders_without_comment(self):
        tool = self.make_tool()
        tool.add("empty_dir", desc="", is_dir_entry=True)
        tool.render()
        text = tool.agents_md.read_text(encoding="utf-8")
        self.assertIn("\n└── empty_dir/\n", text)

    def test_render_replaces_existing_marker(self):
        tool = self.make_tool()
        tool.render()  # 首跑附加两块
        tool.agents_md.write_text(
            tool.agents_md.read_text(encoding="utf-8").replace("# 入口", "# 被手改"),
            encoding="utf-8",
            newline="\n",
        )
        updated = tool.render()  # 再次渲染按标记替换
        self.assertEqual(updated, [tool.agents_md])
        agents = tool.agents_md.read_text(encoding="utf-8")
        self.assertIn("# 入口", agents)
        self.assertNotIn("# 被手改", agents)
        self.assertEqual(tool.render(), [])  # 幂等

    def test_render_appends_missing_blocks_to_tail(self):
        tool = self.make_tool()
        tool.render()
        agents = tool.agents_md.read_text(encoding="utf-8")
        # 简版树与词表块附加到尾部：带小节标题 + code fence 包裹树
        self.assertIn("## 文件树（简版速览）", agents)
        self.assertIn("## 文件树标签词表", agents)
        self.assertIn("# 入口", agents)
        self.assertIn("`pure`", agents)
        # 附加的树块被 code fence 包裹
        tail = agents[agents.index("## 文件树（简版速览）"):]
        self.assertTrue(tail.index("```") < tail.index("# 入口") < tail.index("```", tail.index("# 入口")))

    def test_render_creates_agents_when_missing(self):
        tool = self.make_tool()
        tool.agents_md.unlink()
        tool.render()
        agents = tool.agents_md.read_text(encoding="utf-8")
        self.assertTrue(agents.startswith("# AGENTS"))
        for marker in ("file-tree:tree:begin", "file-tree:tags:begin"):
            self.assertIn(marker, agents)
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_render_rejects_orphan_end_marker(self):
        tool = self.make_tool()
        tool.agents_md.write_text(
            "# AGENTS\n\n<!-- file-tree:tree:end -->\n", encoding="utf-8", newline="\n"
        )
        with self.assertRaises(ToolError):
            tool.render()


class KindFieldTest(SandboxTest):
    """kind 派生字段：由 children 判据推导（file/dir），落盘供机器消费，不参与渲染。"""

    def test_kind_derived_and_persisted(self):
        tool = self.make_tool()
        self.assertEqual(tool.get("apps")["kind"], "dir")
        self.assertEqual(tool.get("Cargo.toml")["kind"], "file")
        self.assertEqual(tool.get("apps/main.tsx")["kind"], "file")

    def test_hand_edited_kind_corrected_on_write(self):
        tool = self.make_tool()
        data = tool.load()
        data["tree"]["Cargo.toml"]["kind"] = "dir"  # 手改成错误值
        tool.write_data(data)  # 规范化写纠正为推导值
        self.assertEqual(tool.get("Cargo.toml")["kind"], "file")

    def test_legacy_data_without_kind_migrated_by_write(self):
        tool = self.make_tool()  # make_tool 经 write_data 已带 kind；手放旧形态数据
        legacy = {"tags": {}, "tree": {"old.rs": {"desc": "旧", "detail": ["旧数据"]}}}
        tool.tree_json.write_text(
            json.dumps(legacy, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8", newline="\n",
        )
        tool.write_data(tool.load())
        self.assertEqual(tool.get("old.rs")["kind"], "file")
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_kind_in_query_json(self):
        import contextlib
        import io
        import types

        tool = self.make_tool()
        args = types.SimpleNamespace(kw=None, tag=None, rel_of=None, under=None, depth=None, json=True)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_query(tool, args)
        payload = json.loads(buf.getvalue())
        by_path = {e["path"]: e for e in payload}
        self.assertEqual(by_path["apps"]["kind"], "dir")
        self.assertEqual(by_path["Cargo.toml"]["kind"], "file")

    def test_query_json_keeps_git_ignore_tri_state(self):
        # --json 三态保真：null=缺省继承、false=显式退出、true=豁免（二态默认值会把 null 拍平成 false）
        import contextlib
        import io
        import types

        tool = self.make_tool()
        tool.add("apps/exit.rs", desc="退出", detail=["x"], git_ignore=False)
        tool.add("apps/kept.rs", desc="豁免", detail=["x"], git_ignore=True)
        args = types.SimpleNamespace(kw=None, tag=None, rel_of=None, under="apps", depth=None, json=True)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_query(tool, args)
        by_path = {e["path"]: e for e in json.loads(buf.getvalue())}
        self.assertIsNone(by_path["apps/main.tsx"]["git-ignore"])  # 缺省继承
        self.assertIs(by_path["apps/exit.rs"]["git-ignore"], False)  # 显式退出
        self.assertIs(by_path["apps/kept.rs"]["git-ignore"], True)

    def test_cli_query_wires_under_and_depth(self):
        # 锁定 CLI 层接线：_cmd_query 必须把 under/depth 传给方法层（回归：曾整层漏传、参数被静默丢弃）
        import contextlib
        import io
        import types

        tool = self.make_tool()
        tool.add("apps/ui", desc="UI 层", is_dir_entry=True)
        tool.add("apps/ui/button.tsx", desc="按钮", detail=["x"])
        args = types.SimpleNamespace(kw=None, tag=None, rel_of=None, under="apps", depth=1, json=True)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_query(tool, args)
        self.assertEqual(
            [e["path"] for e in json.loads(buf.getvalue())],
            ["apps", "apps/main.tsx", "apps/ui", "apps/util.ts"],
        )

    def test_kind_not_rendered(self):
        tool = self.make_tool()
        self.assertNotIn("kind", tool.render_brief_tree())


class RenderControlTest(SandboxTest):
    """collapsed / hidden 渲染控制字段：只影响 AGENTS.md 简版树渲染，不影响数据与校验。"""

    def test_collapsed_dir_renders_ellipsis_without_children(self):
        tool = self.make_tool()
        tool.add("build", desc="构建产物", is_dir_entry=True)
        tool.add("build/out.exe", desc="产物", detail=["完整描述"])
        tool.add("build/tmp.rs", desc="临时", detail=["完整描述"])
        data = tool.load()
        data["tree"]["build"]["collapsed"] = True
        tool.write_data(data)
        rendered = tool.render_brief_tree()
        self.assertIn("build/…", rendered)  # 目录名后带省略号
        self.assertNotIn("out.exe", rendered)  # children 不展开
        self.assertNotIn("tmp.rs", rendered)

    def test_collapsed_empty_dir_renders_plain(self):
        tool = self.make_tool()
        tool.add("empty", desc="空目录", is_dir_entry=True, collapsed=True)
        rendered = tool.render_brief_tree()
        self.assertIn("empty/", rendered)
        self.assertNotIn("…", rendered)  # 空目录无可折叠内容，不加省略号

    def test_hidden_excludes_entry_and_subtree(self):
        tool = self.make_tool()
        tool.add("secrets", desc="密钥", is_dir_entry=True)
        tool.add("secrets/token.rs", desc="令牌", detail=["完整描述"])
        data = tool.load()
        data["tree"]["secrets"]["hidden"] = True
        data["tree"]["Cargo.toml"]["hidden"] = True
        tool.write_data(data)
        rendered = tool.render_brief_tree()
        self.assertNotIn("secrets", rendered)  # 条目及子树整体消失
        self.assertNotIn("token.rs", rendered)
        self.assertNotIn("Cargo.toml", rendered)
        self.assertIn("apps/", rendered)  # 其余照常渲染

    def test_hidden_entries_survive_in_data_and_check(self):
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml", "build/out.exe"})
        tool.add("build", desc="构建产物", is_dir_entry=True)
        tool.add("build/out.exe", desc="产物", detail=["完整描述"])
        data = tool.load()
        data["tree"]["build"]["collapsed"] = True
        data["tree"]["Cargo.toml"]["hidden"] = True
        tool.write_data(data)
        tool.render()
        # 隐藏/折叠 ≠ 删除：数据完整性、磁盘对照、产物一致性照常
        errors, warnings = tool.check()
        self.assertEqual((errors, warnings), ([], []))
        self.assertEqual([p for p, _ in tool.query(kw="根配置")], ["Cargo.toml"])  # 查询不受 hidden 影响
        agents = tool.agents_md.read_text(encoding="utf-8")
        self.assertNotIn("Cargo.toml", agents)

    def test_add_render_flags_and_upsert(self):
        tool = self.make_tool()
        tool.add("dist", desc="发布", is_dir_entry=True, collapsed=True)
        tool.add("Cargo.toml", desc="根配置", hidden=True)
        self.assertIs(tool.get("dist")["collapsed"], True)
        self.assertIs(tool.get("Cargo.toml")["hidden"], True)
        tool.add("Cargo.toml", desc="新描述")  # 未指定的标志保留
        self.assertIs(tool.get("Cargo.toml")["hidden"], True)
        tool.add("Cargo.toml", desc="新描述", hidden=False)  # 显式 false 撤销
        self.assertNotIn("hidden", tool.get("Cargo.toml"))
        tool.add("dist", desc="发布", is_dir_entry=True, collapsed=False)
        self.assertNotIn("collapsed", tool.get("dist"))

    def test_collapsed_rejected_on_file_entry(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add("apps/x.rs", desc="x", collapsed=True)  # add 层拒绝
        data = tool.load()
        data["tree"]["Cargo.toml"]["collapsed"] = True
        with self.assertRaises(ToolError):
            tool.write_data(data)  # 数据层兜底拒绝


class ReplaceBlockTest(unittest.TestCase):
    def test_replace_middle(self):
        text = "a\n<!-- b:begin -->\nold\n<!-- b:end -->\nz"
        self.assertEqual(
            replace_block(text, "<!-- b:begin -->", "<!-- b:end -->", "new1\nnew2"),
            "a\n<!-- b:begin -->\nnew1\nnew2\n<!-- b:end -->\nz",
        )

    def test_missing_marker_raises(self):
        with self.assertRaises(ToolError):
            replace_block("nothing", "<!-- b:begin -->", "<!-- b:end -->", "x")


class CheckTest(SandboxTest):
    def test_clean_after_render(self):
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        tool.render()
        errors, warnings = tool.check()
        self.assertEqual((errors, warnings), ([], []))

    def test_unknown_field(self):
        tool = self.make_tool()
        data = tool.load()
        data["tree"]["Cargo.toml"]["foo"] = 1
        tool.write_data(data)
        errors, _ = tool.check()
        self.assertTrue(any("foo" in e for e in errors))

    def test_tag_outside_vocab(self):
        tool = self.make_tool()
        data = tool.load()
        data["tree"]["Cargo.toml"]["tags"] = ["nope"]
        tool.write_data(data)  # 规范化写入保留未知 tag，由 check 语义层报错
        errors, _ = tool.check()
        self.assertTrue(any("nope" in e for e in errors))

    def test_dangling_and_self_rel(self):
        tool = self.make_tool()
        data = tool.load()
        data["tree"]["Cargo.toml"]["rel"] = ["apps/nope.ts"]
        tool.write_data(data)
        errors, _ = tool.check()
        self.assertTrue(any("apps/nope.ts" in e for e in errors))
        data["tree"]["Cargo.toml"]["rel"] = ["Cargo.toml"]
        tool.write_data(data)
        errors, _ = tool.check()
        self.assertTrue(any("自身" in e for e in errors))

    def test_noncanonical_bytes_detected(self):
        tool = self.make_tool()
        tool.render()
        data = tool.load()
        # 手改格式层（4 空格缩进），内容不变 → 规范形态检测应报错
        tool.tree_json.write_text(
            json.dumps(data, ensure_ascii=False, indent=4) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        errors, _ = tool.check()
        self.assertTrue(any("规范" in e for e in errors))

    def test_crlf_tolerated_but_rewritten_on_next_write(self):
        tool = self.make_tool()
        tool.render()
        raw = tool.tree_json.read_text(encoding="utf-8")
        tool.tree_json.write_text(raw.replace("\n", "\r\n"), encoding="utf-8", newline="")
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_stale_render_detected(self):
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml", "apps/x.rs"})
        tool.render()
        tool.add("apps/x.rs", desc="后加的", detail=["完整描述"])  # 只写数据不渲染
        errors, _ = tool.check()
        self.assertTrue(any("产物" in e for e in errors))
        tool.render()
        errors, warnings = tool.check()
        self.assertEqual((errors, warnings), ([], []))

    def test_git_compare_rules(self):
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml", "docs/x.md", "README.md"})
        tool.add("docs", desc="文档", is_dir_entry=True)
        tool.add("gone.rs", desc="已删除")
        tool.render()
        errors, warnings = tool.check()
        # gone.rs 在树不在 git → 错误
        self.assertTrue(any("gone.rs" in e for e in errors))
        joined_warnings = "\n".join(warnings)
        # apps 展开收录 → 漏掉的顶层 README.md 报未收录告警
        self.assertIn("README.md", joined_warnings)
        # docs 整目录收录 → 其下文件不告警
        self.assertNotIn("docs/x.md", joined_warnings)

    def test_desc_warnings_and_strict(self):
        tool = self.make_tool()
        tool.add("apps/x.rs", desc="这是一个超过二十个字符的超长描述用于触发告警", detail=["完整描述"])
        tool.add("apps/parent", desc="", is_dir_entry=True)
        tool.render()
        errors, warnings = tool.check()
        self.assertEqual(errors, [])
        self.assertEqual(len(warnings), 2)
        self.assertTrue(any("超长" in w for w in warnings))
        errors, _ = tool.check(strict=True)
        self.assertEqual(len(errors), 2)

    def test_field_completeness_detail(self):
        tool = self.make_tool()
        tool.add("apps/bare.rs", desc="只有一句话")  # 文件条目缺 detail
        tool.render()
        errors, warnings = tool.check()
        self.assertEqual(errors, [])
        # 仅文件条目报缺 detail；目录（apps/）一句话 desc 即完整，不告警
        self.assertEqual(
            [w for w in warnings if "缺 detail" in w],
            ["W: apps/bare.rs 缺 detail（完整描述待补，详版树将回退 desc）"],
        )

    def test_skill_pycache_exempt_from_git_compare(self):
        # 技能自身测试产生的 __pycache__ 不报"未收录"（运行时缓存，非仓库内容）
        tool = self.make_tool(git_files={
            "apps/main.tsx", "apps/util.ts", "Cargo.toml",
            ".agents/skills/file-tree/scripts/__pycache__/tree_tool.cpython-314.pyc",
        })
        tool.render()
        errors, warnings = tool.check()
        self.assertEqual((errors, warnings), ([], []))

    def test_other_pycache_still_reported(self):
        # 技能目录之外的 __pycache__ 是仓库卫生问题，照常告警
        tool = self.make_tool(git_files={
            "apps/main.tsx", "apps/util.ts", "Cargo.toml",
            "vendor/__pycache__/x.cpython-314.pyc",
        })
        tool.render()
        _, warnings = tool.check()
        self.assertTrue(any("vendor/__pycache__/x.cpython-314.pyc" in w for w in warnings))

    def test_git_compare_reports_disk_dir_as_type_mismatch(self):
        # 目录被录成文件条目：git ls-files 只列文件不列目录，磁盘实况是目录 →
        # 报类型错配并给修正指引，不再误报"磁盘不存在"把人带向根定位歧途
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        tool.add("testdata", desc="测试数据")  # 磁盘尚无 → 文件条目
        tool.repo_root.joinpath("testdata").mkdir()  # 磁盘后出现目录（模拟存量错配）
        tool.render()
        errors, _ = tool.check()
        self.assertTrue(any("testdata" in e and "目录" in e for e in errors))
        self.assertFalse(any("磁盘不存在" in e for e in errors))

    def test_git_compare_untracked_file_wording(self):
        # 磁盘上存在的文件未被 git 跟踪：只报 git 未跟踪，不叠加"磁盘不存在"的矛盾表述
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        tool.repo_root.joinpath("ignored.rs").write_text("x", encoding="utf-8")
        tool.add("ignored.rs", desc="未跟踪")  # 磁盘是文件，不影响自动识别
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(
            [e for e in errors if "ignored.rs" in e],
            ["E: 树中条目未被 git 跟踪: ignored.rs"],
        )


class GitIgnoreTest(SandboxTest):
    """git-ignore 校验控制字段：豁免"必须被 git 跟踪"的对照，check 只看磁盘存在与 git 排除态。

    注入口语义：git_files = tracked ∪ untracked-unignored（被 .gitignore 忽略的文件不在其中，
    同 git ls-files --cached --others --exclude-standard）；tracked_files = --cached 集合。
    """

    def write_disk(self, tool: TreeTool, rel: str, content: str = "x") -> None:
        path = tool.repo_root.joinpath(*split_rel_path(rel))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def test_add_and_upsert_git_ignore(self):
        tool = self.make_tool()
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        self.assertIs(tool.get("data.bin")["git-ignore"], True)
        tool.add("data.bin", desc="大文件")  # 未指定的标志保留
        self.assertIs(tool.get("data.bin")["git-ignore"], True)
        # 显式 false 落盘（覆写祖先豁免用），与 collapsed/hidden 的"清除"语义不同
        tool.add("data.bin", desc="大文件", git_ignore=False)
        self.assertIs(tool.get("data.bin")["git-ignore"], False)

    def test_add_batch_git_ignore_field(self):
        tool = self.make_tool(data={"tags": {}, "tree": {}})
        entries = [
            {"path": "data.bin", "desc": "大文件", "git-ignore": True},
            {"path": "pkg.zip", "desc": "离线包", "git-ignore": False},
        ]
        tool.add_batch(entries)
        self.assertIs(tool.get("data.bin")["git-ignore"], True)
        self.assertIs(tool.get("pkg.zip")["git-ignore"], False)  # 显式 false 同样落盘

    def test_check_passes_when_ignored_on_disk(self):
        # 磁盘存在 + 不在 git_files（被 .gitignore 忽略）→ 通过，不报"未被 git 跟踪"
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        self.write_disk(tool, "data.bin")
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        tool.render()
        self.assertEqual(tool.check(), ([], []))

    def test_check_reports_missing_disk(self):
        # 豁免只豁免 git 对照，不豁免磁盘存在性
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(
            [e for e in errors if "data.bin" in e],
            ["E: data.bin git-ignore 条目磁盘不存在"],
        )

    def test_check_reports_tracked_contradiction(self):
        # 标记 git-ignore 但实际被 git 跟踪：矛盾态（tracked ⊆ git_files，差集循环不可见，须单独拦截）
        base = {"apps/main.tsx", "apps/util.ts", "Cargo.toml"}
        tool = self.make_tool(git_files=base | {"data.bin"}, tracked_files=base | {"data.bin"})
        self.write_disk(tool, "data.bin")
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(
            [e for e in errors if "data.bin" in e],
            ["E: data.bin 标记 git-ignore 但实际被 git 跟踪（git rm --cached 或移除标记恢复对照）"],
        )

    def test_check_reports_unignored_untracked(self):
        # 磁盘存在、未跟踪、但 .gitignore 没覆盖（git status 会持续显示 untracked）→ 错误
        base = {"apps/main.tsx", "apps/util.ts", "Cargo.toml"}
        tool = self.make_tool(git_files=base | {"data.bin"}, tracked_files=base)
        self.write_disk(tool, "data.bin")
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(
            [e for e in errors if "data.bin" in e],
            ["E: data.bin 标记 git-ignore 但未被 .gitignore 排除（补 ignore 规则或移除标记）"],
        )

    def test_dir_git_ignore_exempts_subtree(self):
        # 目录标记 → 子树文件条目继承豁免；子树外条目照旧对照
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        self.write_disk(tool, "datasets/a.bin")
        self.write_disk(tool, "apps/gone.tsx")
        tool.add("datasets", desc="数据集", is_dir_entry=True, git_ignore=True)
        tool.add("datasets/a.bin", desc="数据", detail=["完整描述"])
        tool.add("apps/gone.tsx", desc="未豁免", detail=["完整描述"])
        tool.render()
        errors, _ = tool.check()
        self.assertFalse(any("datasets" in e for e in errors), errors)  # 子树豁免生效
        self.assertTrue(any("apps/gone.tsx" in e and "未被 git 跟踪" in e for e in errors), errors)

    def test_explicit_false_overrides_ancestor(self):
        # .gitignore ! 规则场景：目录整体豁免但个别子文件走 git（tracked）。
        # 继承会把 tracked 子文件卷进豁免集合 → 误报矛盾；显式 false 就近覆写后恢复正常对照
        base = {"apps/main.tsx", "apps/util.ts", "Cargo.toml"}
        tool = self.make_tool(git_files=base | {"datasets/README.md"},
                              tracked_files=base | {"datasets/README.md"})
        self.write_disk(tool, "datasets/README.md")
        tool.add("datasets", desc="数据集", is_dir_entry=True, git_ignore=True)
        tool.add("datasets/README.md", desc="说明", detail=["完整描述"])  # 无显式设置 → 继承 true
        tool.render()
        errors, _ = tool.check()
        self.assertTrue(any("README.md" in e and "被 git 跟踪" in e for e in errors), errors)  # 缺口基准：误报
        tool.add("datasets/README.md", desc="说明", git_ignore=False)  # 显式 false 覆写
        tool.render()
        errors, _ = tool.check()
        self.assertFalse(any("README.md" in e for e in errors), errors)  # 误报消除

    def test_false_inherits_down_subtree(self):
        # 就近覆写向下传递：爷 true + 中间目录 false + 孙无显式设置 → 孙不豁免
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        self.write_disk(tool, "datasets/sub/x.bin")
        tool.add("datasets", desc="数据集", is_dir_entry=True, git_ignore=True)
        tool.add("datasets/sub", desc="例外子集", is_dir_entry=True, git_ignore=False)
        tool.add("datasets/sub/x.bin", desc="数据", detail=["完整描述"])
        tool.render()
        errors, _ = tool.check()
        self.assertTrue(any("x.bin" in e and "未被 git 跟踪" in e for e in errors), errors)

    def test_git_ignore_keeps_render_and_query(self):
        # 校验控制字段不影响渲染：简版树照常显示；get / query --json 可见
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        self.write_disk(tool, "data.bin")
        tool.add("data.bin", desc="大文件", detail=["完整描述"], git_ignore=True)
        tool.render()
        self.assertIn("data.bin", tool.render_brief_tree())
        self.assertIs(tool.get("data.bin")["git-ignore"], True)
        import contextlib
        import io
        import types

        args = types.SimpleNamespace(kw="data.bin", tag=None, rel_of=None, under=None, depth=None, json=True)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_query(tool, args)
        payload = json.loads(buf.getvalue())
        self.assertIs(payload[0]["git-ignore"], True)

    def test_check_exempt_disk_dir_type_mismatch(self):
        # 豁免条目磁盘上是目录：报类型错配并给修正指引，不误诊为"磁盘不存在"（与非豁免分支对称）。
        # 先 add 后建目录（模拟存量错配）：先建目录会被 add 自动识别为目录条目，走不进豁免对照
        tool = self.make_tool(git_files={"apps/main.tsx", "apps/util.ts", "Cargo.toml"})
        tool.add("legacy.bin", desc="遗留大文件", detail=["完整描述"], git_ignore=True)
        tool.repo_root.joinpath("legacy.bin").mkdir()
        tool.render()
        errors, _ = tool.check()
        self.assertTrue(any("legacy.bin" in e and "磁盘上是目录" in e for e in errors), errors)
        self.assertFalse(any("磁盘不存在" in e for e in errors), errors)


class MarkTest(SandboxTest):
    """mark 子树批量标记：tags 追加/覆写、git-ignore 传播（仅文件条目）、depth 限制、单步历史。

    夹具 docs 子树：a.md(深1)、sub/(深1, 目录)、b.md(深2)、deep/(深2, 目录)、c.md(深3)——
    文件 3 / 目录 2 / 共 5 条；docs 自身与 Cargo.toml 在作用域外。
    """

    def make_mark_tool(self, git_files: set[str] | None = None, tracked_files: set[str] | None = None) -> TreeTool:
        return self.make_tool(
            data={
            "tags": {"doc": "文档", "big": "大文件"},
            "tree": {
                "docs": {"desc": "文档", "children": {
                    "a.md": {"desc": "a", "detail": ["x"]},
                    "sub": {"desc": "子目录", "children": {
                        "b.md": {"desc": "b", "detail": ["x"]},
                        "deep": {"desc": "更深层", "children": {
                            "c.md": {"desc": "c", "detail": ["x"]},
                        }},
                    }},
                }},
                "Cargo.toml": {"desc": "根配置", "detail": ["x"]},
            },
        }, git_files=git_files, tracked_files=tracked_files)

    def test_tags_add_union(self):
        tool = self.make_mark_tool()
        n_tags, n_git, _ = tool.mark("docs", tags=["doc"])
        self.assertEqual((n_tags, n_git), (5, 0))  # 子树全部条目（含目录）
        for path in ["docs/a.md", "docs/sub", "docs/sub/b.md", "docs/sub/deep", "docs/sub/deep/c.md"]:
            self.assertEqual(tool.get(path).get("tags"), ["doc"], path)
        n_tags, _, _ = tool.mark("docs", tags=["big"])  # 并集追加
        self.assertEqual(n_tags, 5)
        self.assertEqual(tool.get("docs/a.md")["tags"], ["big", "doc"])  # 规范化排序
        n_tags, _, _ = tool.mark("docs", tags=["doc"])  # 无新值 → 不计受影响
        self.assertEqual(n_tags, 0)

    def test_tags_replace_and_clear(self):
        tool = self.make_mark_tool()
        tool.mark("docs", tags=["doc"])
        n_tags, _, _ = tool.mark("docs", tags=["big"], tags_mode="replace")
        self.assertEqual(n_tags, 5)
        self.assertEqual(tool.get("docs/a.md")["tags"], ["big"])
        n_tags, _, _ = tool.mark("docs", tags=[], tags_mode="replace")  # 空列表 = 清空
        self.assertEqual(n_tags, 5)
        self.assertNotIn("tags", tool.get("docs/a.md"))
        n_tags, _, _ = tool.mark("docs", tags=[], tags_mode="replace")  # 已清空 → 不计
        self.assertEqual(n_tags, 0)

    def test_scope_excludes_target_and_outside(self):
        tool = self.make_mark_tool()
        tool.mark("docs", tags=["doc"])
        self.assertNotIn("tags", tool.get("docs"))  # 传播不含目标目录自身
        self.assertNotIn("tags", tool.get("Cargo.toml"))  # 子树外不受影响

    def test_depth_limit(self):
        tool = self.make_mark_tool()
        n_tags, n_git, _ = tool.mark("docs", tags=["doc"], git_ignore=True, depth=1)
        self.assertEqual(n_tags, 2)  # 仅深度 1：a.md、sub
        self.assertEqual(n_git, 1)  # 深度 1 的文件只有 a.md（git-ignore 不落目录，防继承穿透 depth）
        self.assertEqual(tool.get("docs/a.md")["tags"], ["doc"])
        self.assertEqual(tool.get("docs/a.md")["git-ignore"], True)
        self.assertNotIn("tags", tool.get("docs/sub/b.md"))
        self.assertNotIn("git-ignore", tool.get("docs/sub/b.md"))
        self.assertNotIn("git-ignore", tool.get("docs/sub"))  # 目录不落标记

    def test_git_ignore_files_only_and_check(self):
        # mark 传播豁免后 check 联动：文件豁免生效零错误、目录条目不落标记
        tool = self.make_mark_tool(git_files={"Cargo.toml"})
        for rel in ["docs/a.md", "docs/sub/b.md", "docs/sub/deep/c.md"]:  # 磁盘就位，不在 git_files = 模拟被忽略
            disk = tool.repo_root.joinpath(*split_rel_path(rel))
            disk.parent.mkdir(parents=True, exist_ok=True)
            disk.write_text("x", encoding="utf-8")
        _, n_git, n_skip = tool.mark("docs", git_ignore=True)
        self.assertEqual((n_git, n_skip), (3, 0))
        for path in ["docs/sub", "docs/sub/deep"]:
            self.assertNotIn("git-ignore", tool.get(path))  # 目录条目不落标记
        tool.render()
        self.assertEqual(tool.check(), ([], []))

    def test_git_ignore_false_overwrite(self):
        # false 传播作用于缺省态文件（批量退出豁免）；显式设置不被批量覆写
        tool = self.make_mark_tool()
        _, n_git, _ = tool.mark("docs/sub", git_ignore=False)
        self.assertEqual(n_git, 2)  # b.md、c.md 落显式 false（就近覆写三态）
        self.assertIs(tool.get("docs/sub/b.md")["git-ignore"], False)
        # 个体表态优先：显式 false 的条目不被后续 true 传播覆写
        _, n_git, _ = tool.mark("docs", git_ignore=True)
        self.assertEqual(n_git, 1)  # 仅缺省态的 a.md 落 true
        self.assertIs(tool.get("docs/a.md")["git-ignore"], True)
        self.assertIs(tool.get("docs/sub/b.md")["git-ignore"], False)

    def test_git_ignore_true_skips_tracked(self):
        # true 传播跳过 git 已跟踪文件（落 true 即矛盾标记，check 必报错）
        tool = self.make_mark_tool(git_files={"Cargo.toml", "docs/a.md"},
                                   tracked_files={"Cargo.toml", "docs/a.md"})
        _, n_git, n_skip = tool.mark("docs", git_ignore=True)
        self.assertEqual((n_git, n_skip), (2, 1))  # b.md、c.md 落 true；a.md 跳过
        self.assertNotIn("git-ignore", tool.get("docs/a.md"))

    def test_git_ignore_false_covers_tracked(self):
        # false 传播不跳 tracked：tracked 文件落显式 false 恰是"退出祖先豁免"的修复动作
        tool = self.make_mark_tool(git_files={"Cargo.toml", "docs/a.md"},
                                   tracked_files={"Cargo.toml", "docs/a.md"})
        _, n_git, n_skip = tool.mark("docs", git_ignore=False)
        self.assertEqual((n_git, n_skip), (3, 0))
        self.assertIs(tool.get("docs/a.md")["git-ignore"], False)

    def test_errors(self):
        tool = self.make_mark_tool()
        with self.assertRaises(ToolError):  # 目录条目不存在
            tool.mark("nope", tags=["doc"])
        with self.assertRaises(ToolError):  # 文件条目不能作为锚点
            tool.mark("Cargo.toml", tags=["doc"])
        with self.assertRaises(ToolError):  # 粗粒度目录无 children，无可传播条目
            tool.add("assets", desc="图标集", is_dir_entry=True)
            tool.mark("assets", tags=["doc"])
        with self.assertRaises(ToolError):  # 无动作参数
            tool.mark("docs")
        with self.assertRaises(ToolError):  # 未知标签
            tool.mark("docs", tags=["nope"])
        with self.assertRaises(ToolError):  # depth 正整数
            tool.mark("docs", tags=["doc"], depth=0)
        # 前置校验失败保持原子：无半落盘（含 assets 建链后的基线）
        before = tool.tree_json.read_bytes()
        with self.assertRaises(ToolError):
            tool.mark("docs", tags=["nope"])
        self.assertEqual(tool.tree_json.read_bytes(), before)

    def test_undo_single_step(self):
        tool = self.make_mark_tool()
        tool.mark("docs", tags=["doc"])
        tool.undo()
        for path in ["docs/a.md", "docs/sub", "docs/sub/b.md", "docs/sub/deep", "docs/sub/deep/c.md"]:
            self.assertNotIn("tags", tool.get(path), path)  # 一次 mark = 一步历史，undo 整体回滚

    def test_redo_roundtrip(self):
        tool = self.make_mark_tool()
        tool.mark("docs", tags=["doc"])
        tool.undo()
        tool.redo()
        self.assertEqual(tool.get("docs/a.md")["tags"], ["doc"])  # redo 完整恢复子树标记


class CmdMarkTest(SandboxTest):
    """CLI 层 _cmd_mark 的参数解析契约：--tags 空串/缺省区分、拆分去空白、输出文案。"""

    def run_cmd_mark(self, tool, path="apps", tags=None, tags_mode="add", git_ignore=None, depth=None):
        import types

        args = types.SimpleNamespace(path=path, tags=tags, tags_mode=tags_mode, git_ignore=git_ignore, depth=depth)
        _cmd_mark(tool, args)

    def test_tags_empty_string_means_clear(self):
        # --tags "" 是显式空列表（配 replace 清空），不折算为 None——CLI 解析独立于方法层，须单独锁定
        tool = self.make_tool()
        tool.mark("apps", tags=["pure"])
        self.run_cmd_mark(tool, tags="", tags_mode="replace")
        self.assertNotIn("tags", tool.get("apps/main.tsx"))

    def test_tags_none_keeps_field(self):
        tool = self.make_tool()
        tool.mark("apps", tags=["pure"])
        self.run_cmd_mark(tool, tags=None, git_ignore=False)
        self.assertEqual(tool.get("apps/main.tsx")["tags"], ["pure"])  # 缺省不动 tags
        self.assertIs(tool.get("apps/main.tsx")["git-ignore"], False)  # false 传播照常

    def test_tags_split_and_trim(self):
        tool = self.make_tool()
        self.run_cmd_mark(tool, tags=" pure , test ")
        self.assertEqual(tool.get("apps/main.tsx")["tags"], ["pure", "test"])

    def test_output_skip_note_by_direction(self):
        import contextlib
        import io

        tool = self.make_tool()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.run_cmd_mark(tool, tags="pure")
        self.assertNotIn("跳过", buf.getvalue())  # 无跳过不显示
        tool.add("apps/main.tsx", desc="入口", git_ignore=False)  # 制造一条显式设置
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.run_cmd_mark(tool, git_ignore=True)
        self.assertIn("跳过 1 条（显式设置/git 已跟踪不覆写）", buf.getvalue())  # true 方向文案
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.run_cmd_mark(tool, git_ignore=False)
        self.assertIn("跳过 2 条（显式设置不覆写）", buf.getvalue())  # false 方向：两条显式设置都跳过


class GitDirTest(unittest.TestCase):
    """git 私有区识别：以 <gitdir>/HEAD 为准，绝不创建 .git。"""

    def test_none_without_dotgit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertIsNone(resolve_git_dir(root))

    def test_rejects_empty_dotgit_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()  # 无效仓库：空 .git
            self.assertIsNone(resolve_git_dir(root))
            self.assertEqual(default_history_path(root, root / "skill"), root / "skill" / ".history.json")

    def test_accepts_dir_with_head(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".git").mkdir()
            (root / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
            self.assertEqual(resolve_git_dir(root), root / ".git")
            self.assertEqual(
                default_history_path(root, root / "skill"),
                root / ".git" / "file-tree" / "history.json",
            )

    def test_accepts_worktree_pointer(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = root / "realgit"
            real.mkdir()
            (real / "HEAD").write_text("ref: refs/heads/feat\n", encoding="utf-8")
            (root / ".git").write_text(f"gitdir: {real.as_posix()}\n", encoding="utf-8")
            self.assertEqual(resolve_git_dir(root), real)

    def test_history_writing_never_creates_dotgit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill = root / "skill"
            skill.mkdir()
            tool = TreeTool(
                tree_json=skill / "tree.json",
                agents_md=skill / "AGENTS.md",
                repo_root=root,
                root_name="Demo",
                history_path=default_history_path(root, skill),
            )
            tool.write_data({"tags": {}, "tree": {"a.rs": {"desc": "a", "detail": ["a"]}}})
            tool.agents_md.write_text("# AGENTS\n", encoding="utf-8", newline="\n")
            tool.add("b.rs", desc="b", detail=["b"])
            self.assertFalse((root / ".git").exists())  # 不凭空创建 .git
            self.assertTrue((skill / ".history.json").exists())  # 退化路径生效


class UndoRedoTest(SandboxTest):
    def test_undo_restores_previous_state(self):
        tool = self.make_tool()
        tool.add("apps/new.rs", desc="新增", detail=["描述"])
        self.assertIn("new.rs", tool.get("apps")["children"])
        op = tool.undo()
        self.assertEqual(op, "add apps/new.rs")
        self.assertNotIn("new.rs", tool.load()["tree"]["apps"]["children"])
        # 恢复后产物同步、check 干净
        self.assertEqual(tool.check()[0], [])
        self.assertIn("# 入口", tool.agents_md.read_text(encoding="utf-8"))

    def test_redo_roundtrip(self):
        tool = self.make_tool()
        tool.rm("apps/util.ts")
        self.assertNotIn("util.ts", tool.get("apps")["children"])
        tool.undo()
        op = tool.redo()
        self.assertEqual(op, "rm apps/util.ts")
        self.assertNotIn("util.ts", tool.get("apps")["children"])

    def test_undo_empty_raises(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.undo()
        with self.assertRaises(ToolError):
            tool.redo()

    def test_new_op_truncates_redo_branch(self):
        tool = self.make_tool()
        tool.add("apps/a.rs", desc="a", detail=["a"])
        tool.undo()
        tool.add("apps/b.rs", desc="b", detail=["b"])  # 新操作截断 redo 分支
        with self.assertRaises(ToolError):
            tool.redo()

    def test_history_limit_drops_oldest(self):
        tool = self.make_tool(history_limit=2)
        for name in ("a.rs", "b.rs", "c.rs"):
            tool.add(name, desc=name, detail=[name])
        undo_ops, _ = tool.history_summary()
        self.assertEqual(undo_ops, ["add a.rs", "add b.rs", "add c.rs"][-2:])
        tool.undo()  # 撤销 add c.rs
        tool.undo()  # 撤销 add b.rs
        with self.assertRaises(ToolError):  # a.rs 的快照已被丢弃
            tool.undo()

    def test_validation_failure_leaves_no_history(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add("bad/path/../x.rs", desc="x")  # 校验失败
        undo_ops, _ = tool.history_summary()
        self.assertEqual(undo_ops, [])


class HistoryMigrationTest(SandboxTest):
    """git 初始化晚于技能使用：旧位置历史自动收敛进 git 私有区，undo 栈不断裂。"""

    def _simulate_git_init(self, tool: TreeTool) -> Path:
        legacy = tool.history_path
        canonical = tool.repo_root / ".git" / "file-tree" / "history.json"
        tool.history_path = canonical
        tool.legacy_history_paths = (legacy,)
        return legacy

    def test_migrates_legacy_history_into_gitdir(self):
        tool = self.make_tool()
        legacy = tool.history_path
        tool.add("apps/first.rs", desc="一", detail=["一"])  # git init 前：历史落在技能目录
        self.assertTrue(legacy.exists())
        self._simulate_git_init(tool)
        # 旧历史仍可读（含迁移前的撤销栈）
        undo_ops, _ = tool.history_summary()
        self.assertEqual(undo_ops, ["add apps/first.rs"])
        # 下一次写操作完成收敛：栈延续、旧文件删除
        tool.add("apps/second.rs", desc="二", detail=["二"])
        undo_ops, _ = tool.history_summary()
        self.assertEqual(undo_ops, ["add apps/first.rs", "add apps/second.rs"])
        canonical = tool.history_path
        self.assertTrue(canonical.exists())
        self.assertFalse(legacy.exists())

    def test_undo_reads_legacy_and_converges(self):
        tool = self.make_tool()
        tool.add("apps/old.rs", desc="旧", detail=["旧"])
        self._simulate_git_init(tool)
        op = tool.undo()  # 直接 undo：读旧位置历史，恢复后写 canonical
        self.assertEqual(op, "add apps/old.rs")
        self.assertNotIn("old.rs", tool.load()["tree"]["apps"]["children"])
        self.assertFalse(self.legacy_exists(tool))
        op = tool.redo()  # redo 栈同样延续
        self.assertEqual(op, "add apps/old.rs")

    def legacy_exists(self, tool: TreeTool) -> bool:
        return any(p.exists() for p in tool.legacy_history_paths if p != tool.history_path)

    def test_check_warns_on_pending_migration(self):
        tool = self.make_tool()
        tool.add("apps/x.rs", desc="x", detail=["x"])
        tool.render()
        self._simulate_git_init(tool)
        errors, warnings = tool.check()
        self.assertEqual(errors, [])
        self.assertTrue(any("旧位置" in w for w in warnings))


class QueryTest(SandboxTest):
    def test_filters(self):
        tool = self.make_tool()
        tool.add("apps/render.rs", desc="渲染纯函数", tags=["pure"])
        paths = [p for p, _ in tool.query(kw="渲染")]
        self.assertEqual(paths, ["apps/render.rs"])
        paths = [p for p, _ in tool.query(tag="pure")]
        self.assertEqual(paths, ["apps/render.rs", "apps/util.ts"])
        # 反查：谁关联到 Cargo.toml
        tool.add("apps/main.tsx", rel=["Cargo.toml"])
        paths = [p for p, _ in tool.query(rel_of="Cargo.toml")]
        self.assertEqual(paths, ["apps/main.tsx"])

    def test_under_filters_subtree_and_includes_self(self):
        # --under 锚点自身也算"这块"的条目；子树全量、子树外排除
        tool = self.make_tool()
        tool.add("apps/render.rs", desc="渲染", detail=["x"])
        paths = [p for p, _ in tool.query(under="apps")]
        self.assertEqual(paths, ["apps", "apps/main.tsx", "apps/render.rs", "apps/util.ts"])

    def test_under_depth(self):
        tool = self.make_tool()
        tool.add("apps/ui", desc="UI 层", is_dir_entry=True)
        tool.add("apps/ui/button.tsx", desc="按钮", detail=["x"])
        # depth=1：锚点自身（相对深度 0）+ 直接子级
        paths = [p for p, _ in tool.query(under="apps", depth=1)]
        self.assertEqual(paths, ["apps", "apps/main.tsx", "apps/ui", "apps/util.ts"])

    def test_under_combines_with_other_filters(self):
        tool = self.make_tool()
        paths = [p for p, _ in tool.query(under="apps", tag="pure")]
        self.assertEqual(paths, ["apps/util.ts"])

    def test_under_and_depth_errors(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):  # --under 必须是树中目录条目
            tool.query(under="apps/main.tsx")
        with self.assertRaises(ToolError):
            tool.query(under="nope")
        with self.assertRaises(ToolError):  # depth 须与 under 同用
            tool.query(depth=1)
        with self.assertRaises(ToolError):  # depth 正整数
            tool.query(under="apps", depth=0)

    def test_get_missing_raises(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.get("nope.rs")

    def test_get_multiple_paths(self):
        # get 多路径批量查看：逐条输出、条间空行分隔；单路径输出与旧格式一致
        import contextlib
        import io
        import types

        tool = self.make_tool()
        args = types.SimpleNamespace(path=["Cargo.toml", "apps/util.ts"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_get(tool, args)
        out = buf.getvalue()
        self.assertIn("Cargo.toml", out)
        self.assertIn("apps/util.ts", out)
        self.assertIn("类型: 文件", out)
        self.assertTrue(out.index("Cargo.toml") < out.index("apps/util.ts"))
        args = types.SimpleNamespace(path=["Cargo.toml"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            _cmd_get(tool, args)
        self.assertFalse(buf.getvalue().startswith("\n"))  # 单路径无前导空行


class AddBatchTest(SandboxTest):
    """add-batch：批量 upsert 一次变更一步历史，任一条非法整批拒绝，不变量校验照常。"""

    def entries_basic(self) -> list[dict]:
        return [
            {"path": "apps/new.ts", "desc": "新页面", "detail": ["路由与视图"], "tags": ["pure"]},
            {"path": "docs/guide.md", "desc": "指南"},
            {"path": "lib.rs", "desc": "库根", "detail": ["公共 API"]},
        ]

    def test_writes_all_entries_with_auto_parents(self):
        tool = self.make_tool()
        n = tool.add_batch(self.entries_basic())
        self.assertEqual(n, 3)
        node = tool.get("apps/new.ts")
        self.assertEqual(node["desc"], "新页面")
        self.assertEqual(node["tags"], ["pure"])
        self.assertEqual(tool.get("docs/guide.md")["desc"], "指南")
        self.assertEqual(tool.get("lib.rs")["detail"], ["公共 API"])
        self.assertIn("guide.md", tool.load()["tree"]["docs"]["children"])

    def test_single_history_step_undo_rolls_back_all(self):
        tool = self.make_tool()
        tool.add_batch(self.entries_basic())
        undo, redo = tool.history_summary()
        self.assertEqual(len(undo), 1)
        self.assertIn("add-batch", undo[0])
        self.assertEqual(redo, [])
        tool.undo()
        data = tool.load()
        self.assertNotIn("lib.rs", data["tree"])
        self.assertNotIn("docs", data["tree"])
        self.assertNotIn("new.ts", data["tree"]["apps"]["children"])

    def test_upsert_keeps_untouched_fields(self):
        tool = self.make_tool()
        tool.add_batch([{"path": "apps/util.ts", "desc": "工具集"}])
        node = tool.get("apps/util.ts")
        self.assertEqual(node["desc"], "工具集")
        self.assertEqual(node["detail"], ["纯函数工具集"])
        self.assertEqual(node["tags"], ["pure"])

    def test_internal_rel_between_batch_entries(self):
        tool = self.make_tool()
        tool.add_batch([
            {"path": "apps/a.ts", "desc": "甲", "rel": ["apps/b.ts"]},
            {"path": "apps/b.ts", "desc": "乙", "rel": ["apps/a.ts"]},
        ])
        self.assertEqual(tool.get("apps/a.ts")["rel"], ["apps/b.ts"])
        self.assertEqual(tool.get("apps/b.ts")["rel"], ["apps/a.ts"])

    def test_atomic_reject_unknown_tag(self):
        tool = self.make_tool()
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError):
            tool.add_batch([
                {"path": "apps/ok.ts", "desc": "没问题"},
                {"path": "apps/bad.ts", "desc": "坏标签", "tags": ["ghost"]},
            ])
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)
        undo, _ = tool.history_summary()
        self.assertEqual(undo, [])

    def test_atomic_reject_mid_path_conflict(self):
        tool = self.make_tool()
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError):
            tool.add_batch([
                {"path": "apps/x.ts", "desc": "文件"},
                {"path": "apps/x.ts/child.rs", "desc": "路径中段冲突"},
            ])
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)

    def test_atomic_reject_rel_missing_target(self):
        tool = self.make_tool()
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "apps/c.ts", "desc": "丙", "rel": ["not/in/tree.rs"]}])
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)

    def test_reject_rel_self_reference(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "apps/d.ts", "desc": "丁", "rel": ["apps/d.ts"]}])

    def test_reject_duplicate_paths_in_batch(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([
                {"path": "apps/e.ts", "desc": "一"},
                {"path": "apps/e.ts", "desc": "二"},
            ])

    def test_reject_unknown_entry_field(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "a.ts", "desc": "x", "typo_field": 1}])

    def test_reject_bad_field_types(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": 123, "desc": "x"}])
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "a.ts", "desc": "x", "detail": "不是数组"}])
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "a.ts", "desc": "x", "tags": ["pure", 1]}])
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "a.ts", "desc": "x", "collapsed": "yes"}])

    def test_dir_entry_with_collapsed(self):
        tool = self.make_tool()
        tool.add_batch([{"path": "assets/icons", "desc": "图标集", "dir": True, "collapsed": True}])
        node = tool.get("assets/icons")
        self.assertEqual(node["children"], {})
        self.assertTrue(node["collapsed"])

    def test_collapsed_on_file_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "apps/f.ts", "desc": "x", "collapsed": True}])

    def test_empty_entries_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([])

    def test_reject_path_variant_duplicates(self):
        """反斜杠/双斜杠变体与正斜杠形式是同一路径，批内同现必须拒绝（判重按归一化路径）。"""
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([
                {"path": "src/w.ts", "desc": "一"},
                {"path": "src\\w.ts", "desc": "二"},
            ])

    def test_rel_normalized_to_forward_slashes_and_check_clean(self):
        """rel 非规范分隔符形式应规范为正斜杠落盘，check 的精确比较不再报 E。"""
        tool = self.make_tool()
        tool.add_batch([{"path": "apps/ref.ts", "desc": "引用", "rel": ["apps\\main.tsx"]}])
        self.assertEqual(tool.get("apps/ref.ts")["rel"], ["apps/main.tsx"])
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_empty_rel_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.add_batch([{"path": "a.ts", "desc": "x", "rel": [""]}])

    def test_redo_restores_whole_batch(self):
        tool = self.make_tool()
        tool.add_batch(self.entries_basic())
        tool.undo()
        op = tool.redo()
        self.assertIn("add-batch", op)
        data = tool.load()
        self.assertIn("lib.rs", data["tree"])
        self.assertIn("new.ts", data["tree"]["apps"]["children"])
        self.assertIn("guide.md", data["tree"]["docs"]["children"])

    def test_rel_to_auto_created_intermediate_dir(self):
        """rel 指向批内自动创建的中间目录：最终树中存在该节点即合法。"""
        tool = self.make_tool()
        tool.add_batch([{"path": "x/y/z.ts", "desc": "深层", "rel": ["x"]}])
        self.assertEqual(tool.get("x/y/z.ts")["rel"], ["x"])

    def test_null_switches_treated_as_absent(self):
        """dir/collapsed/hidden 显式 null 与缺省同义，不报类型错。"""
        tool = self.make_tool()
        tool.add_batch([{"path": "apps/n.ts", "desc": "x", "dir": None, "collapsed": None, "hidden": None}])
        self.assertNotIn("children", tool.get("apps/n.ts"))


class DiskDirAutoDetectTest(SandboxTest):
    """写入防呆：磁盘上是目录的路径未声明 dir 时自动收录为目录条目。

    目录路径录成文件条目没有任何合法存续场景（git ls-files 不列目录，check 必报错），
    自动识别消除"清单漏标 dir → check 报磁盘不存在 → 误诊根定位"的整条摩擦链。
    """

    def test_add_disk_dir_auto_recorded_as_dir(self):
        tool = self.make_tool()
        tool.repo_root.joinpath("testdata", "input").mkdir(parents=True)
        tool.add("testdata/input", desc="测试数据")  # 未声明 dir，磁盘是目录 → 自动识别
        node = tool.get("testdata/input")
        self.assertIn("children", node)  # 目录条目（children 空 = 整目录粗粒度收录）
        self.assertEqual(node["children"], {})

    def test_add_disk_file_stays_file(self):
        tool = self.make_tool()
        tool.repo_root.joinpath("real.rs").write_text("x", encoding="utf-8")
        tool.add("real.rs", desc="真实文件")
        self.assertNotIn("children", tool.get("real.rs"))

    def test_declared_dir_without_disk_still_dir(self):
        tool = self.make_tool()  # 磁盘无该路径（虚拟目录是合法特性）
        tool.add("virtual/group", desc="聚合分类", is_dir_entry=True)
        self.assertIn("children", tool.get("virtual/group"))

    def test_add_existing_file_entry_not_flipped(self):
        tool = self.make_tool()
        tool.add("legacy", desc="旧条目")  # 先录文件条目（磁盘尚无）
        tool.repo_root.joinpath("legacy").mkdir()  # 磁盘后变成目录
        tool.add("legacy", desc="更新")  # upsert 不隐式翻转既有类型，存量错配由 check 报
        self.assertNotIn("children", tool.get("legacy"))

    def test_add_batch_disk_dir_auto(self):
        tool = self.make_tool()
        tool.repo_root.joinpath("assets", "icons").mkdir(parents=True)
        n = tool.add_batch([
            {"path": "assets/icons", "desc": "图标集"},  # 清单未标 dir，磁盘是目录
            {"path": "docs/guide.md", "desc": "指南"},
        ])
        self.assertEqual(n, 2)
        self.assertIn("children", tool.get("assets/icons"))
        self.assertNotIn("children", tool.get("docs/guide.md"))


class RmBatchTest(SandboxTest):
    """rm-batch：批量删除一次变更一步历史，原子生效，修剪变空父目录语义保留。"""

    def test_removes_all_and_prunes_emptied_roots(self):
        tool = self.make_tool()
        tool.add_batch([
            {"path": "tmp/a.rs", "desc": "临时"},
            {"path": "tmp/b.rs", "desc": "临时"},
            {"path": "tmp/sub/c.rs", "desc": "临时"},
        ])
        n = tool.rm_batch(["tmp/a.rs", "tmp/sub/c.rs", "tmp/b.rs"])
        self.assertEqual(n, 3)
        self.assertNotIn("tmp", tool.load()["tree"])

    def test_single_history_step_undo_restores_all(self):
        tool = self.make_tool()
        tool.rm_batch(["apps/main.tsx", "Cargo.toml"])
        undo, _ = tool.history_summary()
        self.assertEqual(len(undo), 1)
        self.assertIn("rm-batch", undo[0])
        tool.undo()
        data = tool.load()
        self.assertIn("main.tsx", data["tree"]["apps"]["children"])
        self.assertIn("Cargo.toml", data["tree"])

    def test_parent_kept_when_sibling_remains(self):
        tool = self.make_tool()
        tool.rm_batch(["apps/util.ts"])
        self.assertIn("main.tsx", tool.load()["tree"]["apps"]["children"])

    def test_atomic_reject_missing_entry(self):
        tool = self.make_tool()
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError):
            tool.rm_batch(["apps/main.tsx", "no/such.rs"])
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)
        undo, _ = tool.history_summary()
        self.assertEqual(undo, [])

    def test_reject_duplicate_paths(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.rm_batch(["apps/util.ts", "apps/util.ts"])

    def test_reject_ancestor_descendant_mix(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.rm_batch(["apps", "apps/main.tsx"])

    def test_sibling_prefix_not_misjudged(self):
        """a/b 与 a/bc 是兄弟而非祖先-后代，前缀判断不得误伤。"""
        tool = self.make_tool()
        tool.add_batch([
            {"path": "tmp/a/b.rs", "desc": "临时"},
            {"path": "tmp/a/bc.rs", "desc": "临时"},
        ])
        tool.rm_batch(["tmp/a/b.rs", "tmp/a/bc.rs"])
        self.assertNotIn("tmp", tool.load()["tree"])


class MvTest(SandboxTest):
    """mv：条目带信息迁移（含子树）——数据层操作不碰磁盘，全树自动重写指向旧路径的 rel 边。"""

    def assert_mv_rejected(self, tool: TreeTool, src: str, dst: str) -> None:
        """拒绝即原子：tree.json 字节不变，撤销栈与重做栈均空（调用前须无历史）。"""
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError):
            tool.mv(src, dst)
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)
        undo, redo = tool.history_summary()
        self.assertEqual((undo, redo), ([], []))

    def test_moves_file_with_all_fields(self):
        tool = self.make_tool()
        tool.add("apps/util.ts", rel=["Cargo.toml"])
        tool.mv("apps/util.ts", "lib/util.ts")
        node = tool.get("lib/util.ts")
        self.assertEqual(node["desc"], "工具")
        self.assertEqual(node["detail"], ["纯函数工具集"])
        self.assertEqual(node["tags"], ["pure"])
        self.assertEqual(node["rel"], ["Cargo.toml"])  # 指向未移动目标的边不动
        with self.assertRaises(ToolError):
            tool.get("apps/util.ts")
        self.assertIn("main.tsx", tool.get("apps")["children"])  # 有兄弟则源父目录保留

    def test_moves_dir_subtree_intact(self):
        tool = self.make_tool()
        tool.mv("apps", "src/apps")
        apps = tool.get("src/apps")
        self.assertEqual(apps["desc"], "应用层")
        self.assertEqual(apps["children"]["main.tsx"]["desc"], "入口")
        self.assertEqual(apps["children"]["util.ts"]["tags"], ["pure"])
        self.assertNotIn("apps", tool.load()["tree"])

    def test_rewrites_rel_edge_pointing_to_old_path(self):
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["文档"], rel=["apps/util.ts"])
        n = tool.mv("apps/util.ts", "lib/util.ts")
        self.assertEqual(n, 1)
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["lib/util.ts"])

    def test_rewrites_rel_edges_pointing_into_subtree(self):
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["文档"], rel=["apps/main.tsx", "apps/util.ts"])
        tool.mv("apps", "src")
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["src/main.tsx", "src/util.ts"])

    def test_rewrites_rel_edges_inside_moved_subtree(self):
        """子树内部条目的 rel 存全路径，目录迁移后若不前缀重写即悬空。"""
        tool = self.make_tool()
        tool.add("apps/main.tsx", rel=["apps/util.ts"])
        tool.mv("apps", "src")
        tool.render()
        self.assertEqual(tool.get("src/main.tsx")["rel"], ["src/util.ts"])
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_rel_of_query_hits_new_path(self):
        tool = self.make_tool()
        tool.add("apps/main.tsx", rel=["apps/util.ts"])
        tool.mv("apps/util.ts", "lib/util.ts")
        self.assertEqual([p for p, _ in tool.query(rel_of="lib/util.ts")], ["apps/main.tsx"])
        self.assertEqual(tool.query(rel_of="apps/util.ts"), [])

    def test_single_history_step_undo_restores(self):
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["文档"], rel=["apps/util.ts"])
        tool.mv("apps/util.ts", "lib/util.ts")
        undo, _ = tool.history_summary()
        self.assertEqual(undo, ["add docs/guide.md", "mv apps/util.ts -> lib/util.ts"])
        tool.undo()
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["apps/util.ts"])
        self.assertEqual(tool.get("apps/util.ts")["desc"], "工具")
        with self.assertRaises(ToolError):
            tool.get("lib/util.ts")

    def test_reject_missing_src_leaves_untouched(self):
        tool = self.make_tool()
        self.assert_mv_rejected(tool, "nope.rs", "lib/nope.rs")

    def test_reject_existing_dst(self):
        tool = self.make_tool()
        self.assert_mv_rejected(tool, "apps/util.ts", "Cargo.toml")
        self.assert_mv_rejected(tool, "apps\\util.ts", "apps\\main.tsx")  # 反斜杠变体归一化后同判

    def test_reject_same_src_dst(self):
        tool = self.make_tool()
        self.assert_mv_rejected(tool, "apps/util.ts", "apps/util.ts")
        self.assert_mv_rejected(tool, "apps\\util.ts", "apps//util.ts")  # 分隔符变体归一化后同判

    def test_reject_dst_inside_src_subtree(self):
        tool = self.make_tool()
        self.assert_mv_rejected(tool, "apps", "apps/sub")
        # 粗粒度收录（无 children）时目标在"虚拟子树"下同样拒绝
        coarse = self.make_tool(data={"tags": {}, "tree": {"assets": {"desc": "图标集"}}})
        self.assert_mv_rejected(coarse, "assets", "assets/icons")

    def test_rename_in_place_keeps_parent_info(self):
        """时序回归：同父重命名且源是父目录唯一孩子，父目录不得被修剪后以空骨架重建。"""
        data = {"tags": {}, "tree": {"solo": {
            "desc": "独子目录", "detail": ["不该丢"],
            "children": {"only.rs": {"desc": "唯一", "detail": ["x"]}},
        }}}
        tool = self.make_tool(data=data)
        tool.mv("solo/only.rs", "solo/renamed.rs")
        parent = tool.get("solo")
        self.assertEqual(parent["desc"], "独子目录")
        self.assertEqual(parent["detail"], ["不该丢"])
        self.assertEqual(parent["children"]["renamed.rs"]["desc"], "唯一")
        self.assertNotIn("only.rs", parent["children"])

    def test_prunes_emptied_source_parents(self):
        data = {"tags": {}, "tree": {"a": {"desc": "", "children": {"b.rs": {"desc": "x", "detail": ["d"]}}}}}
        tool = self.make_tool(data=data)
        tool.mv("a/b.rs", "b.rs")
        self.assertEqual(set(tool.load()["tree"]), {"b.rs"})

    def test_auto_creates_dst_parents(self):
        tool = self.make_tool()
        tool.mv("apps/util.ts", "lib/core/util.ts")
        self.assertIn("util.ts", tool.get("lib/core")["children"])
        self.assertEqual(tool.get("lib")["desc"], "")  # 自动建的父链 desc 待补
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_reject_dst_mid_path_is_file(self):
        tool = self.make_tool()
        self.assert_mv_rejected(tool, "apps/util.ts", "Cargo.toml/util.ts")

    def test_moves_dir_keeps_collapsed_flag(self):
        data = {"tags": {}, "tree": {"legacy": {
            "desc": "旧模块", "collapsed": True,
            "children": {"old.rs": {"desc": "旧", "detail": ["x"]}},
        }}}
        tool = self.make_tool(data=data)
        tool.mv("legacy", "archived/legacy")
        node = tool.get("archived/legacy")
        self.assertIs(node["collapsed"], True)
        self.assertIn("old.rs", node["children"])

    def test_moves_file_keeps_hidden_flag(self):
        data = {"tags": {}, "tree": {"apps": {"desc": "应用层", "children": {
            "util.ts": {"desc": "工具", "detail": ["纯函数"], "hidden": True}}}}}
        tool = self.make_tool(data=data)
        tool.mv("apps/util.ts", "lib/util.ts")
        self.assertIs(tool.get("lib/util.ts")["hidden"], True)
        tool.render()
        self.assertNotIn("工具", tool.agents_md.read_text(encoding="utf-8"))  # 隐藏渲染仍生效

    def test_no_rewrite_on_sibling_prefix(self):
        """指向兄弟前缀路径（apps2/x）的边不得被裸前缀匹配误伤。"""
        tool = self.make_tool()
        tool.add("apps2/x.rs", desc="x", detail=["x"])
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["apps2/x.rs"])
        tool.mv("apps", "src")
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["apps2/x.rs"])

    def test_mixed_rel_keeps_misses(self):
        """命中与未命中混合的 rel 列表：只改命中项，未命中项原样保留。"""
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["Cargo.toml", "apps/util.ts"])
        n = tool.mv("apps/util.ts", "lib/util.ts")
        self.assertEqual(n, 1)
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["Cargo.toml", "lib/util.ts"])

    def test_returns_edge_count_not_entry_count(self):
        """n 按重写的边数计（非发生重写的条目数）：单节点两条命中边计 2。"""
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"],
                 rel=["Cargo.toml", "apps/util.ts", "apps/main.tsx"])
        n = tool.mv("apps", "src")
        self.assertEqual(n, 2)
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["Cargo.toml", "src/main.tsx", "src/util.ts"])

    def test_mv_not_blocked_by_preexisting_dangling_rel(self):
        """既有悬空 rel（rm 的合法产物）不阻塞无关 mv——mv 正是修复悬空的手段。"""
        tool = self.make_tool()
        tool.add("apps/tmp.rs", desc="t", detail=["t"])
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["apps/tmp.rs"])
        tool.rm("apps/tmp.rs")  # rm 不重写 rel，guide.md 的边悬空
        tool.mv("Cargo.toml", "Cargo.lock")
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["apps/tmp.rs"])  # 悬空边原样留给 check 报告

    def test_pruned_ancestor_rel_left_dangling_for_check(self):
        """源端父链修剪可使指向被修剪祖先的 rel 边悬空——同 rm 口径，由 check 报 E 兜底。"""
        data = {"tags": {}, "tree": {
            "apps": {"desc": "应用层", "children": {"util.ts": {"desc": "工具", "detail": ["x"]}}},
            "docs.md": {"desc": "文档", "detail": ["d"], "rel": ["apps"]},
        }}
        tool = self.make_tool(data=data)
        n = tool.mv("apps/util.ts", "lib/util.ts")  # apps 变空被修剪
        self.assertEqual(n, 0)  # 指向祖先 apps 的边不在前缀改写范围
        self.assertEqual(tool.get("docs.md")["rel"], ["apps"])  # 悬空边原样保留
        with self.assertRaises(ToolError):
            tool.get("apps")
        tool.render()
        errors, _ = tool.check()
        self.assertTrue(any("rel 目标不在树中" in e for e in errors))

    def test_mv_leaves_disk_files_alone(self):
        """数据层迁移不碰磁盘：真实文件留在原位，新路径不产生文件。"""
        tool = self.make_tool()
        src_file = tool.repo_root / "apps" / "util.ts"
        src_file.parent.mkdir(parents=True, exist_ok=True)
        src_file.write_text("x", encoding="utf-8")
        tool.mv("apps/util.ts", "lib/util.ts")
        self.assertTrue(src_file.exists())
        self.assertFalse((tool.repo_root / "lib" / "util.ts").exists())

    def test_redo_restores_move(self):
        tool = self.make_tool()
        tool.mv("apps/util.ts", "lib/util.ts")
        tool.undo()
        op = tool.redo()
        self.assertEqual(op, "mv apps/util.ts -> lib/util.ts")
        self.assertEqual(tool.get("lib/util.ts")["desc"], "工具")
        with self.assertRaises(ToolError):
            tool.get("apps/util.ts")

    def test_top_level_rename(self):
        tool = self.make_tool()
        tool.mv("Cargo.toml", "Cargo.lock")
        self.assertEqual(tool.get("Cargo.lock")["desc"], "根配置")
        self.assertNotIn("Cargo.toml", tool.load()["tree"])


class CmdMvTest(SandboxTest):
    """CLI 层 mv：参数直通 + 写后自动重渲染 AGENTS.md。"""

    def test_cmd_mv_passes_args_and_renders(self):
        import types

        tool = self.make_tool()
        _cmd_mv(tool, types.SimpleNamespace(src="apps/util.ts", dst="lib/util.ts"))
        self.assertEqual(tool.get("lib/util.ts")["desc"], "工具")
        text = tool.agents_md.read_text(encoding="utf-8")
        self.assertIn("lib/", text)  # 简版树为多行树形，目录与文件名分行渲染
        self.assertIn("工具", text)

    def test_cmd_mv_reports_rewrite_count(self):
        import io
        import types
        from contextlib import redirect_stdout

        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["apps/util.ts"])
        buf = io.StringIO()
        with redirect_stdout(buf):
            _cmd_mv(tool, types.SimpleNamespace(src="apps/util.ts", dst="lib/util.ts"))
        self.assertIn("已迁移并重渲染: apps/util.ts -> lib/util.ts（重写 1 条 rel 边）", buf.getvalue())


class MvBatchTest(SandboxTest):
    """mv-batch：一份清单 = 一次变更 = 一步历史；批内互斥预校验，任一非法整批拒绝。"""

    def moves_basic(self) -> list[dict]:
        return [
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "Cargo.toml", "dst": "conf/Cargo.toml"},
        ]

    def assert_batch_rejected(self, tool: TreeTool, moves, msg: str | None = None) -> None:
        """拒绝即原子：tree.json 字节不变，撤销栈与重做栈均空（调用前须无历史）。msg 标注子场景。"""
        before = tool.tree_json.read_text(encoding="utf-8")
        with self.assertRaises(ToolError, msg=msg):
            tool.mv_batch(moves)
        self.assertEqual(tool.tree_json.read_text(encoding="utf-8"), before)
        undo, redo = tool.history_summary()
        self.assertEqual((undo, redo), ([], []))

    def test_moves_all_entries_with_fields(self):
        tool = self.make_tool()
        n, edges = tool.mv_batch(self.moves_basic())
        self.assertEqual((n, edges), (2, 0))
        util = tool.get("lib/util.ts")
        self.assertEqual(util["desc"], "工具")
        self.assertEqual(util["detail"], ["纯函数工具集"])
        self.assertEqual(util["tags"], ["pure"])
        self.assertEqual(tool.get("conf/Cargo.toml")["detail"][0][:9], "workspace")
        with self.assertRaises(ToolError):
            tool.get("apps/util.ts")
        self.assertIn("main.tsx", tool.get("apps")["children"])  # 有兄弟则源父目录保留

    def test_shared_dst_parent_auto_created(self):
        tool = self.make_tool()
        tool.mv_batch([
            {"src": "apps/util.ts", "dst": "lib/core/util.ts"},
            {"src": "Cargo.toml", "dst": "lib/conf.toml"},
        ])
        lib_children = set(tool.get("lib")["children"])
        self.assertEqual(lib_children, {"core", "conf.toml"})
        self.assertIn("util.ts", tool.get("lib/core")["children"])

    def test_rel_rewrite_stacking_batch_internal(self):
        """批内互指：两者都移动，rel 边最终指向对方新路径（与清单顺序无关）。"""
        tool = self.make_tool()
        tool.add("apps/main.tsx", rel=["apps/util.ts"])
        tool.mv_batch([
            {"src": "apps/main.tsx", "dst": "src/main.tsx"},
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
        ])
        self.assertEqual(tool.get("src/main.tsx")["rel"], ["lib/util.ts"])
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_rel_rewrite_stacking_order_independent(self):
        """叠加顺序无关的另一半：反序清单结果一致，且 edges 按重写动作累计。"""
        tool = self.make_tool()
        tool.add("apps/main.tsx", rel=["apps/util.ts"])
        n, edges = tool.mv_batch([
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "apps/main.tsx", "dst": "src/main.tsx"},
        ])
        self.assertEqual((n, edges), (2, 1))
        self.assertEqual(tool.get("src/main.tsx")["rel"], ["lib/util.ts"])
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_prunes_dir_when_all_children_moved(self):
        """批量移光目录全部孩子：最后一条触发父目录修剪，undo 完整恢复子树。"""
        tool = self.make_tool()
        tool.mv_batch([
            {"src": "apps/main.tsx", "dst": "src/main.tsx"},
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
        ])
        self.assertNotIn("apps", tool.load()["tree"])
        self.assertEqual(tool.get("lib/util.ts")["tags"], ["pure"])
        tool.undo()
        apps = tool.get("apps")
        self.assertEqual(set(apps["children"]), {"main.tsx", "util.ts"})
        self.assertEqual(apps["desc"], "应用层")

    def test_promote_out_of_dir_in_batch(self):
        """同条目的 dst 与自身 src 祖先关系不进交叉检查（i != j）：批内提升合法。"""
        tool = self.make_tool()
        tool.mv_batch([
            {"src": "apps/util.ts", "dst": "util.ts"},
            {"src": "Cargo.toml", "dst": "conf/Cargo.toml"},
        ])
        self.assertEqual(tool.get("util.ts")["tags"], ["pure"])
        self.assertIn("main.tsx", tool.get("apps")["children"])  # 有兄弟则源父保留

    def test_rel_rewrite_stacking_external(self):
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"],
                 rel=["Cargo.toml", "apps/util.ts"])
        _, edges = tool.mv_batch(self.moves_basic())
        self.assertEqual(edges, 2)
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["conf/Cargo.toml", "lib/util.ts"])

    def test_moves_dir_with_subtree(self):
        tool = self.make_tool()
        tool.mv_batch([{"src": "apps", "dst": "src/apps"}])
        self.assertEqual(tool.get("src/apps")["desc"], "应用层")
        self.assertIn("main.tsx", tool.get("src/apps")["children"])
        self.assertNotIn("apps", tool.load()["tree"])

    def test_single_history_step_undo_restores_all(self):
        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["apps/util.ts"])
        tool.mv_batch(self.moves_basic())
        undo, redo = tool.history_summary()
        self.assertEqual(undo, ["add docs/guide.md", "mv-batch 2 条"])
        self.assertEqual(redo, [])
        tool.undo()
        self.assertEqual(tool.get("apps/util.ts")["desc"], "工具")
        self.assertEqual(tool.get("docs/guide.md")["rel"], ["apps/util.ts"])
        with self.assertRaises(ToolError):
            tool.get("lib/util.ts")
        with self.assertRaises(ToolError):
            tool.get("conf/Cargo.toml")

    def test_redo_restores_whole_batch(self):
        tool = self.make_tool()
        tool.mv_batch(self.moves_basic())
        tool.undo()
        op = tool.redo()
        self.assertEqual(op, "mv-batch 2 条")
        self.assertEqual(tool.get("lib/util.ts")["desc"], "工具")

    def test_reject_bad_manifest_structure(self):
        tool = self.make_tool()
        for bad in ([], {}, {"no_moves": []}, {"moves": "x"}, {"moves": []}):
            with self.assertRaises(ToolError, msg=repr(bad)):
                tool.mv_batch(bad)

    def test_reject_bad_entry(self):
        tool = self.make_tool()
        for bad in (
            ["not-object"],
            [{"src": "apps/util.ts"}],                       # 缺 dst
            [{"dst": "lib/util.ts"}],                        # 缺 src
            [{"src": "apps/util.ts", "dst": ""}],            # 空 dst
            [{"src": 1, "dst": "lib/util.ts"}],              # 非字符串
            [{"src": "apps/util.ts", "dst": "lib/x", "why": "x"}],  # 未知字段
        ):
            with self.assertRaises(ToolError, msg=repr(bad)):
                tool.mv_batch(bad)

    def test_reject_path_variant_duplicates(self):
        """反斜杠/双斜杠变体归一化后同判批内重复。"""
        tool = self.make_tool()
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "a.ts"},
            {"src": "apps\\util.ts", "dst": "b.rs"},
        ])
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "Cargo.toml", "dst": "lib//util.ts"},
        ])

    def test_reject_single_entry_violations(self):
        """单条四关（src==dst / src 缺失 / dst 已存在 / 自嵌套）任一失败整批拒绝。"""
        tool = self.make_tool()
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "apps/util.ts"},
            {"src": "Cargo.toml", "dst": "conf/Cargo.toml"},
        ])
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "nope.rs", "dst": "lib/nope.rs"},
        ])
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "Cargo.toml", "dst": "apps/main.tsx"},
        ])
        self.assert_batch_rejected(tool, [
            {"src": "apps", "dst": "apps/sub"},
        ])

    def test_reject_src_ancestor_descendant(self):
        tool = self.make_tool()
        self.assert_batch_rejected(tool, [
            {"src": "apps", "dst": "src/apps"},
            {"src": "apps/main.tsx", "dst": "src/main.tsx"},
        ])

    def test_reject_dst_ancestor_descendant(self):
        tool = self.make_tool()
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "t/u"},
            {"src": "Cargo.toml", "dst": "t/u/v"},
        ])

    def test_reject_move_chain(self):
        """不支持批内移动链：第一条的 dst 恰是第二条的 src——静态交叉检查（目的地落在他人源路径上）拦截。"""
        data = {"tags": {}, "tree": {
            "apps": {"desc": "应用层", "children": {"util.ts": {"desc": "工具", "detail": ["x"]}}},
            "mid": {"desc": "中转", "children": {"x.rs": {"desc": "x", "detail": ["x"]}}},
        }}
        tool = self.make_tool(data=data)
        self.assert_batch_rejected(tool, [
            {"src": "apps/util.ts", "dst": "mid/x.rs"},
            {"src": "mid/x.rs", "dst": "end/x.rs"},
        ])

    def test_reject_src_inside_other_dst_subtree(self):
        """对称交叉：源路径落在其他移动的目的地上——后续条会"看见"前序结果，破坏初始树语义。"""
        # 形态一：第二条 src 在第一条 dst 子树内（初始树不存在，逐条应用会因前序挂载而存在）
        data = {"tags": {}, "tree": {
            "a": {"desc": "A目录", "children": {"x.rs": {"desc": "x", "detail": ["x"]}}},
        }}
        tool = self.make_tool(data=data)
        self.assert_batch_rejected(tool, [
            {"src": "a", "dst": "b"},
            {"src": "b/x.rs", "dst": "d"},
        ], msg="src 在他人 dst 子树内")
        # 形态二：第二条 dst 是第一条 src 修剪后的变空祖先（初始树存在应拒，应用期被修剪后静默重建）
        data_b = {"tags": {}, "tree": {
            "a": {"desc": "A目录"},
            "d": {"desc": "D目录", "detail": ["不该丢"], "children": {"x.rs": {"desc": "x", "detail": ["x"]}}},
        }}
        tool_b = self.make_tool(data=data_b)
        self.assert_batch_rejected(tool_b, [
            {"src": "d/x.rs", "dst": "e"},
            {"src": "a", "dst": "d"},
        ], msg="dst 是他人 src 修剪后的变空祖先")

    def test_reject_dst_inside_other_src_subtree(self):
        """目的地不得落在批内其他移动的源子树内（否则随源整体被搬走）。清单顺序两种都拒。"""
        tool = self.make_tool()
        moves = [
            {"src": "apps", "dst": "src/apps"},
            {"src": "Cargo.toml", "dst": "apps/renamed.toml"},
        ]
        self.assert_batch_rejected(tool, moves)
        self.assert_batch_rejected(tool, list(reversed(moves)))


class CmdMvBatchTest(SandboxTest):
    """CLI 层 mv-batch：清单读取/解析契约与写后自动渲染。"""

    def write_manifest(self, tool: TreeTool, obj) -> str:
        path = tool.tree_json.parent / "moves.json"
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def test_cmd_reads_manifest_and_renders(self):
        import types

        tool = self.make_tool()
        manifest = self.write_manifest(tool, {"moves": [{"src": "apps/util.ts", "dst": "lib/util.ts"}]})
        _cmd_mv_batch(tool, types.SimpleNamespace(manifest=manifest))
        self.assertEqual(tool.get("lib/util.ts")["desc"], "工具")
        self.assertIn("lib/", tool.agents_md.read_text(encoding="utf-8"))

    def test_cmd_reports_count_and_edges(self):
        import io
        import types
        from contextlib import redirect_stdout

        tool = self.make_tool()
        tool.add("docs/guide.md", desc="指南", detail=["d"], rel=["apps/util.ts", "Cargo.toml"])
        manifest = self.write_manifest(tool, {"moves": [
            {"src": "apps/util.ts", "dst": "lib/util.ts"},
            {"src": "Cargo.toml", "dst": "conf/Cargo.toml"},
        ]})
        buf = io.StringIO()
        with redirect_stdout(buf):
            _cmd_mv_batch(tool, types.SimpleNamespace(manifest=manifest))
        self.assertIn("已批量迁移并重渲染: 2 条（重写 2 条 rel 边；一次变更，单步历史）", buf.getvalue())

    def test_cmd_output_omits_edges_when_zero(self):
        import io
        import types
        from contextlib import redirect_stdout

        tool = self.make_tool()
        manifest = self.write_manifest(tool, {"moves": [{"src": "apps/util.ts", "dst": "lib/util.ts"}]})
        buf = io.StringIO()
        with redirect_stdout(buf):
            _cmd_mv_batch(tool, types.SimpleNamespace(manifest=manifest))
        self.assertIn("已批量迁移并重渲染: 1 条（一次变更，单步历史）", buf.getvalue())
        self.assertNotIn("重写", buf.getvalue())

    def test_cmd_rejects_missing_file_and_bad_json(self):
        import types

        tool = self.make_tool()
        with self.assertRaises(ToolError):
            _cmd_mv_batch(tool, types.SimpleNamespace(manifest=str(tool.tree_json.parent / "nope.json")))
        path = tool.tree_json.parent / "moves.json"
        path.write_text("{不是JSON", encoding="utf-8")
        with self.assertRaises(ToolError):
            _cmd_mv_batch(tool, types.SimpleNamespace(manifest=str(path)))

    def test_cmd_rejects_non_moves_structure(self):
        import types

        tool = self.make_tool()
        for obj in ([], {}, {"no_moves": []}, {"moves": "x"}, {"moves": []}):
            manifest = self.write_manifest(tool, obj)
            with self.assertRaises(ToolError, msg=repr(obj)):
                _cmd_mv_batch(tool, types.SimpleNamespace(manifest=manifest))


class CmdBatchTest(SandboxTest):
    """CLI 层：add-batch 清单读取/解析契约，rm-batch 参数直通。"""

    def write_manifest(self, tool: TreeTool, obj) -> str:
        path = tool.tree_json.parent / "batch.json"
        path.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        return str(path)

    def test_cmd_add_batch_reads_manifest_and_renders(self):
        import types

        tool = self.make_tool()
        manifest = self.write_manifest(tool, {"entries": [{"path": "apps/cli.ts", "desc": "CLI"}]})
        _cmd_add_batch(tool, types.SimpleNamespace(manifest=manifest))
        self.assertEqual(tool.get("apps/cli.ts")["desc"], "CLI")
        self.assertIn("cli.ts", tool.agents_md.read_text(encoding="utf-8"))

    def test_cmd_add_batch_missing_file(self):
        import types

        tool = self.make_tool()
        args = types.SimpleNamespace(manifest=str(tool.tree_json.parent / "nope.json"))
        with self.assertRaises(ToolError):
            _cmd_add_batch(tool, args)

    def test_cmd_add_batch_rejects_non_object_and_bad_entries(self):
        import types

        tool = self.make_tool()
        for obj in ([], {}, {"no_entries": []}, {"entries": "x"}):
            manifest = self.write_manifest(tool, obj)
            with self.assertRaises(ToolError):
                _cmd_add_batch(tool, types.SimpleNamespace(manifest=manifest))

    def test_cmd_add_batch_rejects_bad_json(self):
        import types

        tool = self.make_tool()
        path = tool.tree_json.parent / "batch.json"
        path.write_text("{不是JSON", encoding="utf-8")
        with self.assertRaises(ToolError):
            _cmd_add_batch(tool, types.SimpleNamespace(manifest=str(path)))

    def test_cmd_rm_batch_passes_paths(self):
        import types

        tool = self.make_tool()
        _cmd_rm_batch(tool, types.SimpleNamespace(paths=["apps/main.tsx", "Cargo.toml"]))
        data = tool.load()
        self.assertEqual(data["tree"]["apps"]["children"], {"util.ts": data["tree"]["apps"]["children"]["util.ts"]})
        self.assertNotIn("Cargo.toml", data["tree"])


class RootTest(SandboxTest):
    """root：固定/清除渲染根名——防 worktree 检出目录名漂移；未设置时自动取仓库根目录名。"""

    def brief_first_line(self, tool: TreeTool) -> str:
        return tool.render_brief_tree().split("\n", 1)[0]

    def test_default_uses_repo_root_name(self):
        tool = self.make_tool()
        self.assertEqual(self.brief_first_line(tool), "Demo/")

    def test_set_root_persists_and_renders(self):
        tool = self.make_tool()
        tool.set_root("Fixed")
        self.assertEqual(tool.load()["root"], "Fixed")
        self.assertEqual(self.brief_first_line(tool), "Fixed/")
        tool.render()
        errors, _ = tool.check()
        self.assertEqual(errors, [])

    def test_canonical_puts_root_first(self):
        tool = self.make_tool()
        tool.set_root("Fixed")
        text = tool.tree_json.read_text(encoding="utf-8")
        self.assertLess(text.index('"root"'), text.index('"tags"'))

    def test_clear_root_restores_auto(self):
        tool = self.make_tool()
        tool.set_root("Fixed")
        tool.clear_root()
        self.assertNotIn("root", tool.load())
        self.assertEqual(self.brief_first_line(tool), "Demo/")

    def test_clear_without_custom_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.clear_root()

    def test_set_root_rejects_empty(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            tool.set_root("")
        with self.assertRaises(ToolError):
            tool.set_root(None)

    def test_root_change_is_single_undo_step(self):
        tool = self.make_tool()
        tool.set_root("Fixed")
        undo, _ = tool.history_summary()
        self.assertEqual(len(undo), 1)
        tool.undo()
        self.assertNotIn("root", tool.load())

    def test_worktree_dir_rename_does_not_drift(self):
        """同一 tree.json 在不同检出目录名下：未固定根名随目录漂移，设置后渲染稳定。"""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        skill_dir = root / ".agents" / "skills" / "file-tree"
        (skill_dir / "scripts").mkdir(parents=True)
        common = dict(
            tree_json=skill_dir / "tree.json", agents_md=root / "AGENTS.md",
            repo_root=root, history_path=skill_dir / ".history.json",
        )
        tool_a = TreeTool(root_name="QuotaTray", **common)
        tool_a.write_data(make_data())
        tool_b = TreeTool(root_name="QuotaTray-feat", **common)  # 同数据、不同检出目录名
        self.assertNotEqual(self.brief_first_line(tool_a), self.brief_first_line(tool_b))
        tool_a.set_root("QuotaTray")
        self.assertEqual(self.brief_first_line(tool_a), self.brief_first_line(tool_b))

    def test_normalize_rejects_bad_root(self):
        for bad in (123, "", [], {}, None):
            with self.assertRaises(ToolError):
                normalize_data({"root": bad, "tags": {}, "tree": {}})

    def test_check_reports_hand_edited_bad_root(self):
        tool = self.make_tool()
        tool.render()
        original = tool.tree_json.read_text(encoding="utf-8")
        tool.tree_json.write_text(original.replace("{", '{"root": 1,', 1), encoding="utf-8", newline="\n")
        errors, _ = tool.check()
        self.assertTrue(any("结构非法" in e for e in errors))


class CmdRootTest(SandboxTest):
    """CLI 层 root 命令：查看/设置/清除与互斥约束。"""

    def make_args(self, name=None, clear=False):
        import types

        return types.SimpleNamespace(name=name, clear=clear)

    def test_view_without_args_shows_current(self):
        tool = self.make_tool()
        _cmd_root(tool, self.make_args())  # 仅查看，不抛错即通过

    def test_set_then_clear_roundtrip(self):
        tool = self.make_tool()
        _cmd_root(tool, self.make_args(name="Fixed"))
        self.assertEqual(tool.load()["root"], "Fixed")
        self.assertIn("Fixed/", tool.agents_md.read_text(encoding="utf-8"))
        _cmd_root(tool, self.make_args(clear=True))
        self.assertNotIn("root", tool.load())
        self.assertIn("Demo/", tool.agents_md.read_text(encoding="utf-8"))

    def test_clear_with_name_rejected(self):
        tool = self.make_tool()
        with self.assertRaises(ToolError):
            _cmd_root(tool, self.make_args(name="X", clear=True))


class CompactWriteContractTest(SandboxTest):
    """新规范写入编码的独立字节契约（规格 F02/F03）。

    期望全部为手写固定字面量（含中文、字符串内空白/换行/转义、空树、末尾 LF），
    不得用被测 serializer 自己生成唯一期望。
    """

    def test_exact_bytes_handwritten(self):
        # 字符串内部空格保真（desc 内空格）、换行/引号/反斜杠以 JSON 转义保真（detail 行）。
        # 期望为手写转义字面量（\\n 等即 JSON 文本中的两字符转义序列），不经 serializer 生成。
        data = {
            "tags": {"文档": "文档类"},
            "tree": {
                "说明.md": {
                    "desc": "中文 说明",
                    "detail": ["第一行\n第二行 \"引号\" \\ 反斜杠"],
                    "tags": ["文档"],
                },
            },
        }
        tool = self.make_tool(data=data)
        expected = (
            '{"tags":{"文档":"文档类"},'
            '"tree":{"说明.md":{"kind":"file","desc":"中文 说明",'
            '"detail":["第一行\\n第二行 \\"引号\\" \\\\ 反斜杠"],"tags":["文档"]}}}'
            "\n"
        ).encode("utf-8")
        self.assertEqual(tool.tree_json.read_bytes(), expected)

    def test_empty_tree_bytes(self):
        tool = self.make_tool(data={"tags": {}, "tree": {}})  # 空 tags 词表被规范化剔除
        self.assertEqual(tool.tree_json.read_bytes(), b'{"tree":{}}\n')

    def test_single_trailing_lf_no_bom_one_line(self):
        tool = self.make_tool()
        raw = tool.tree_json.read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))  # UTF-8 无 BOM
        self.assertTrue(raw.endswith(b"\n"))
        self.assertFalse(raw.endswith(b"\n\n"))  # 末尾恰好一个 LF
        self.assertNotIn(b"\n", raw[:-1])  # 正文单行：紧凑无缩进

    def test_root_key_first_in_compact(self):
        tool = self.make_tool()
        tool.set_root("固定根")
        self.assertTrue(tool.tree_json.read_text(encoding="utf-8").startswith('{"root":"固定根",'))

    def test_repeat_write_identical_bytes(self):
        tool = self.make_tool()
        first = tool.tree_json.read_bytes()
        tool.write_data(tool.load())  # 重复写入同一规范化内容
        self.assertEqual(tool.tree_json.read_bytes(), first)

    def test_dumps_functions_two_forms(self):
        # 共享判定来源的原料：同一规范化数据恰有两种规范序列化形态
        data = normalize_data(make_data())
        self.assertEqual(dumps_canonical(data), compact_dumps(data))
        self.assertEqual(dumps_canonical_legacy(data), legacy_dumps(data))
        self.assertNotEqual(dumps_canonical(data), dumps_canonical_legacy(data))


class LegacyCheckCompatTest(SandboxTest):
    """旧两空格规范格式的读取与检查兼容（规格 F04/F05/F06）。

    旧格式样本一律由独立旧编码规则（legacy_dumps）字面构造，不经新的 write_data。
    """

    def write_legacy(self, tool: TreeTool, data: dict) -> None:
        tool.tree_json.write_text(legacy_dumps(normalize_data(data)), encoding="utf-8", newline="\n")

    def test_check_strict_accepts_both_formats(self):
        tool = self.make_tool()
        tool.render()
        self.assertEqual(tool.check(strict=True), ([], []))  # 新规范
        self.write_legacy(tool, make_data())
        errors, warnings = tool.check(strict=True)  # 旧规范：无格式错误、无 strict 告警
        self.assertEqual((errors, warnings), ([], []))

    def test_crlf_legacy_also_accepted(self):
        # CRLF 兼容口径对新旧两种规范形态同时生效
        tool = self.make_tool()
        tool.render()
        self.write_legacy(tool, make_data())
        raw = tool.tree_json.read_text(encoding="utf-8")
        tool.tree_json.write_text(raw.replace("\n", "\r\n"), encoding="utf-8", newline="")
        self.assertEqual(tool.check()[0], [])

    def test_readonly_commands_preserve_legacy_bytes(self):
        # 查询类命令不因读取触发重写：字节与撤销历史均不动（规格 F04/命令行为矩阵）
        tool = self.make_tool()
        self.write_legacy(tool, make_data())
        tool.render()
        before = tool.tree_json.read_bytes()
        tool.get("Cargo.toml")
        tool.query(kw="入口")
        tool.history_summary()
        tool.current_root_name()
        tool.check()
        tool.render()
        self.assertEqual(tool.tree_json.read_bytes(), before)
        self.assertEqual(tool.history_summary(), ([], []))

    def test_is_canonical_text_two_forms_and_rejections(self):
        # 单一判定来源：序列化文本级双形态比较，对象相等不足以通过
        data = normalize_data(make_data())
        self.assertTrue(is_canonical_text(compact_dumps(data)))
        self.assertTrue(is_canonical_text(legacy_dumps(data)))
        self.assertTrue(is_canonical_text(compact_dumps(data).replace("\n", "\r\n")))
        self.assertTrue(is_canonical_text(legacy_dumps(data).replace("\n", "\r\n")))
        self.assertFalse(is_canonical_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n"))
        self.assertFalse(is_canonical_text(json.dumps(data, ensure_ascii=False, separators=(", ", ": ")) + "\n"))
        self.assertFalse(is_canonical_text(compact_dumps(data).rstrip("\n")))  # 缺末尾 LF
        self.assertFalse(is_canonical_text(compact_dumps(data) + "\n"))  # 冗余末尾 LF
        # 键序错乱（对象相等但 tree 在前）与冗余空字段（detail:[]）继续判否
        reordered = {k: data[k] for k in reversed(list(data))}
        self.assertFalse(is_canonical_text(compact_dumps(reordered)))
        self.assertFalse(
            is_canonical_text(compact_dumps({"tags": {}, "tree": {"a.rs": {"kind": "file", "desc": "x", "detail": []}}}))
        )
        self.assertFalse(is_canonical_text("not json"))
        self.assertFalse(is_canonical_text('{"tree":"不是对象"}\n'))  # 结构非法

    def test_check_rejects_disallowed_layouts(self):
        # 其余排版一律拒绝：对象相等不放行任意缩进/键序/空字段（规格 F06）
        data = normalize_data(make_data())
        variants = {
            "indent-4": json.dumps(data, ensure_ascii=False, indent=4) + "\n",
            "keys-reordered": compact_dumps({k: data[k] for k in reversed(list(data))}),
            "spaced-separators": json.dumps(data, ensure_ascii=False, separators=(", ", ": ")) + "\n",
            "empty-detail-kept": compact_dumps(
                {"tags": {}, "tree": {"a.rs": {"kind": "file", "desc": "x", "detail": []}}}
            ),
            "missing-trailing-lf": compact_dumps(data).rstrip("\n"),
        }
        for name, text in variants.items():
            with self.subTest(variant=name):
                tool = self.make_tool()
                tool.render()
                tool.tree_json.write_text(text, encoding="utf-8", newline="\n")
                errors, _ = tool.check()
                self.assertTrue(any("规范" in e for e in errors), text[:60])


class WriteMigrationTest(SandboxTest):
    """旧格式延迟转换：真正写入时输出新规范，拒绝操作不迁移，undo/redo 保持新规范（F07/F08/F09）。"""

    def write_legacy(self, tool: TreeTool, data: dict) -> None:
        tool.tree_json.write_text(legacy_dumps(normalize_data(data)), encoding="utf-8", newline="\n")

    def make_legacy_tool(self, data: dict | None = None) -> TreeTool:
        tool = self.make_tool(data=data)
        self.write_legacy(tool, data if data is not None else make_data())
        return tool

    def assert_compact_on_disk(self, tool: TreeTool) -> None:
        text = tool.tree_json.read_text(encoding="utf-8")
        self.assertNotIn("\n", text[:-1])  # 正文单行
        self.assertEqual(text, compact_dumps(json.loads(text)))  # 与独立新编码规则逐字节一致

    def test_every_write_category_converts(self):
        # 参数化覆盖全部写入类别：任一现有写入入口在旧格式样本上落盘均为新规范
        cases = {
            "add": lambda t: t.add("apps/new.rs", desc="新增", detail=["完整"]),
            "rm": lambda t: t.rm("Cargo.toml"),
            "mv": lambda t: t.mv("Cargo.toml", "conf/Cargo.toml"),
            "add-batch": lambda t: t.add_batch(
                [{"path": "a.rs", "desc": "a", "detail": ["x"]}, {"path": "b.rs", "desc": "b", "detail": ["y"]}]
            ),
            "rm-batch": lambda t: t.rm_batch(["apps/main.tsx", "apps/util.ts"]),
            "mv-batch": lambda t: t.mv_batch([{"src": "Cargo.toml", "dst": "x/Cargo.toml"}]),
            "mark": lambda t: t.mark("apps", tags=["test"]),
            "tag-add": lambda t: t.tag_add("新标签", "说明"),
            "tag-rm": lambda t: t.tag_rm("test"),  # test 标签未被条目使用，可删
            "root-set": lambda t: t.set_root("固定名"),
            "root-clear": lambda t: t.clear_root(),
        }
        for name, op in cases.items():
            with self.subTest(op=name):
                data = make_data()
                if name == "root-clear":
                    data["root"] = "旧名"  # clear 需已有自定义根名
                tool = self.make_legacy_tool(data)
                op(tool)
                self.assert_compact_on_disk(tool)
                undo_ops, redo_ops = tool.history_summary()
                self.assertEqual((len(undo_ops), redo_ops), (1, []))  # 批量也只记一步历史

    def test_undo_redo_after_migration_stay_compact(self):
        # 旧格式 → 业务写入 → undo → redo：三次落盘均新规范，迁移不占历史步（规格 F09）
        tool = self.make_legacy_tool()
        original = normalize_data(make_data())
        tool.add("apps/new.rs", desc="新增", detail=["完整"])
        self.assertIn("new.rs", tool.load()["tree"]["apps"]["children"])
        self.assert_compact_on_disk(tool)  # 落盘 1：业务写入转新规范
        op = tool.undo()
        self.assertEqual(op, "add apps/new.rs")
        self.assertEqual(tool.load(), original)  # 撤销恢复业务数据
        self.assert_compact_on_disk(tool)  # 落盘 2：undo 不退回旧排版
        self.assertEqual(tool.history_summary(), ([], ["add apps/new.rs"]))
        tool.redo()
        self.assertIn("new.rs", tool.load()["tree"]["apps"]["children"])
        self.assert_compact_on_disk(tool)  # 落盘 3：redo 新规范
        undo_ops, redo_ops = tool.history_summary()
        self.assertEqual((len(undo_ops), len(redo_ops)), (1, 0))  # 全程仅一步业务历史

    def test_rejected_operations_keep_legacy_bytes(self):
        # 写入前拒绝的操作不触发预先迁移：旧文件字节与历史状态保持原样（规格 F08）
        tool = self.make_legacy_tool()
        cases = {
            "add-bad-path": lambda t: t.add("a/../x.rs", desc="x"),
            "add-unknown-tag": lambda t: t.add("y.rs", desc="y", tags=["nope"]),
            "mv-dst-exists": lambda t: t.mv("Cargo.toml", "apps/main.tsx"),
            "rm-missing": lambda t: t.rm("nope.rs"),
            "add-batch-unknown-field": lambda t: t.add_batch([{"path": "a.rs", "desc": "a", "bogus": 1}]),
            "rm-batch-missing": lambda t: t.rm_batch(["apps/main.tsx", "nope.rs"]),
            "mv-batch-bad-entry": lambda t: t.mv_batch([{"src": "Cargo.toml"}]),
            "mark-file-anchor": lambda t: t.mark("Cargo.toml", tags=["test"]),
            "mark-no-action": lambda t: t.mark("apps"),
            "tag-add-exists": lambda t: t.tag_add("pure", "重复"),
            "tag-rm-in-use": lambda t: t.tag_rm("pure"),
            "root-empty": lambda t: t.set_root(""),
            "root-clear-unset": lambda t: t.clear_root(),
            "undo-empty": lambda t: t.undo(),
        }
        before = tool.tree_json.read_bytes()
        for name, op in cases.items():
            with self.subTest(op=name):
                with self.assertRaises(ToolError):
                    op(tool)
                self.assertEqual(tool.tree_json.read_bytes(), before)
        self.assertEqual(tool.history_summary(), ([], []))


class DisplayStabilityTest(SandboxTest):
    """展示接口稳定（规格 F13）：query --json 与 AGENTS.md 渲染不因数据排版新旧而改变。"""

    def test_query_json_and_render_same_across_formats(self):
        import contextlib
        import io
        import types

        compact_tool = self.make_tool()
        legacy_tool = self.make_tool()
        legacy_tool.tree_json.write_text(
            legacy_dumps(normalize_data(make_data())), encoding="utf-8", newline="\n"
        )
        args = types.SimpleNamespace(kw=None, tag=None, rel_of=None, under=None, depth=None, json=True)
        outputs = []
        for tool in (compact_tool, legacy_tool):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                _cmd_query(tool, args)
            outputs.append(buf.getvalue())
        self.assertEqual(outputs[0], outputs[1])
        compact_tool.render()
        legacy_tool.render()
        self.assertEqual(
            compact_tool.agents_md.read_text(encoding="utf-8"),
            legacy_tool.agents_md.read_text(encoding="utf-8"),
        )


class SelfHostTest(unittest.TestCase):
    """自举冒烟：本技能自身的 tree.json 应通过 check（规范形态）。"""

    def test_self_check(self):
        skill_dir = Path(__file__).resolve().parents[1]
        repo_root = skill_dir.parents[2]
        tool = TreeTool(
            tree_json=skill_dir / "tree.json",
            agents_md=repo_root / "AGENTS.md",
            repo_root=repo_root,
            root_name=repo_root.name,
            history_path=default_history_path(repo_root, skill_dir),
        )
        if not tool.tree_json.exists():
            self.skipTest("tree.json 尚未迁移")
        errors, _ = tool.check()
        self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
