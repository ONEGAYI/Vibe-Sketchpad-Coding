# 两份文件树快照的只读比较

此参考供 Agent 使用 `tree_tool.py diff`，或在查看器中比较两份 `tree.json`。两份文件都可位于仓库外；比较不读取 Git、不写快照，也不生成撤销历史。

## CLI：逐页取得变化

```bash
python .agents/skills/file-tree/scripts/tree_tool.py diff <旧tree.json> <新tree.json> [--page N] [--page-size N] [--status added|removed|modified]... [--scope entry|root|tag|view]... [--under 目录] [--expect-id ID]
```

- 默认返回第 1 页，每页 50 条；`page_size` 只能是 1–200。结果顺序固定为根名、标签、视图、条目；各类别内按大小写不敏感、码点决胜的路径或键名排序。越界页返回空 `results`，`total` 和 `total_pages` 仍报告实际值。
- `status` 与 `scope` 可重复，重复值取并集；不同筛选条件取交集。`--under` 按路径段限定条目子树（锚点自身含入），提供时不包含顶层元数据变化。先筛选，再分页。
- 输出为 JSON 对象：`schema_version`、`status`、`comparison_id`、`summary`、`filters`、`total`、`total_pages`、`page`、`page_size`、`results`。`summary.by_status` 和 `summary.by_scope` 统计**未筛选**的全部变化，`total` 是筛选后的条数。每条变化含 `scope`、`status`、`before`、`after`，条目使用 `path`，元数据使用 `key`。
- 首次调用保存 `comparison_id` 与 `total_pages`。后续每页重传同一对文件路径、相同筛选条件与 `--expect-id <首次返回的 ID>`。命令每次重新读取两份文件，不依赖后台进程或本机缓存；文件字节、路径或筛选条件变化时返回退出码 2、`stale_comparison` JSON 错误，提示从第 1 页重新读取。

比较的是规范化后的语义内容，JSON 缩进或换行差异不算变化。条目以路径为身份；移动表现为旧路径删除与新路径新增。每个已收录子项逐条计数，目录仅因子项变化时不另记一条目录修改。条目比较本地存储字段（`kind`、`desc`、`detail`、`rel`、`tags`、`collapsed`、`hidden`、`git-ignore`）；目录的 `children` 由子项变化表示。顶层 `root`、每个标签词表项及每个视图配置独立报告。

## 查询命令也有分页

`query --json` 默认返回同形分页信封（`query`、`total`、`total_pages`、`page`、`page_size`、`results`）；支持 `--page N --page-size N`，先执行原有组合过滤再分页。需要兼容旧调用方取得完整 JSON 数组时，显式使用 `query --json --all`；`--all` 不能与页码参数同用。未加 `--json` 的文本查询保持原有完整输出。

## 查看器：分页展示变化

```bash
python .agents/skills/file-tree/scripts/viewer.py <旧tree.json> --compare <新tree.json> [--port N] [--host H]
```

页面显示分页变化列表，可按状态、类别和路径子树筛选；点开一条查看字段前后值。只读接口为 `GET /api/diff`，接受 `status`、`scope`、`under`、`page`、`page_size`，响应在 CLI 分页对象上附加 `generation`。服务启动时一次读入两份快照并建立变化索引；翻页只切片内存结果。

点击刷新会从原路径重读**两份**快照。两份均有效才一起替换并递增 `generation`，页面回到第 1 页；任何一份读取失败则旧比较结果保持可用，错误明确显示。查看器不写文件。
