# obsidian-html-latex-fix

修复 Obsidian **阅读视图中 HTML 标签内 LaTeX 公式不渲染**的问题（如 `<div>$x^2$</div>` 被当作纯文本显示）。本目录由独立仓库 `Obsidian-Html-Tag-Fix` 前缀合并迁入：原仓库 22 个提交经合并提交第二父链全部可达（`git log ^main HEAD`），按源路径视角可查（`git log e465b45 -- src/main.ts`）；注意 `git log --follow` 不跨前缀合并追认新路径。

## 功能

- **公式检测与修复**：识别 HTML 块中被吞掉的行内/块级公式，恢复其 LaTeX 渲染；采用严格扫描（伪匹配回退、code 区域过滤、块级优先去重），详见 `src/utils.ts` 的 `findMathMatchesStrict`
- **自动格式化助手**（Phase 1.5）：对检测到的问题提供格式化建议
- **实时预览模式修复**（Phase 2，进行中）：`src/live-preview/` 模块基于 CodeMirror 6 ViewPlugin + WidgetType 实现编辑视图内的公式装饰，架构就绪、核心功能暂缓（见 `memory/ROADMAP.md`）

## 用法

在本目录内执行：

```bash
npm install        # 安装依赖（依赖不提升到 monorepo 根）
npm run build      # 类型检查 + esbuild 产出 main.js
npm test           # 类型检查 + 运行契约测试（scripts/run-tests.mjs）
npm run deploy     # 按 deploy.config.local.mjs 部署到 Obsidian 插件目录（本地配置不入库）
```

构建产物 `main.js` 与 `manifest.json`、`src/styles.css` 一并放入 vault 的 `.obsidian/plugins/html-latex-fix/` 即可启用。

## 技术栈

TypeScript · esbuild · Obsidian Plugin API（阅读视图 postProcessor + CodeMirror 6）

## 文档

- `CHANGELOG.md`：版本变更记录
- `memory/ROADMAP.md`：路线图（Phase 2.1 实时预览闪烁问题待解决）
- `docs/superpowers/`：设计规格与实施计划
