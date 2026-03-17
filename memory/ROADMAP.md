# Obsidian HTML Tag LaTeX Fix - Roadmap

## Phase 1: 阅读模式 (当前)
- [ ] 使用 MarkdownPostProcessor 拦截 DOM
- [ ] TreeWalker 遍历文本节点
- [ ] 正则匹配 $...$ 和 $$...$$
- [ ] 调用 obsidian.renderMath() 渲染

## Phase 2: 实时预览模式 (未来)
- [ ] CodeMirror 6 扩展
- [ ] ViewPlugin + WidgetType
- [ ] 语法树解析 HTML 区块

## 未来扩展功能
- [ ] **自动格式化助手**：检测并提示用户将 HTML 标签内公式中的 `<`、`>` 等符号替换为 `&lt;`、`&gt;`，避免被浏览器错误解析
  - 可作为编辑器 lint 提示或自动修复功能
  - 属于预防性功能，不影响渲染核心

### 配置项（Phase 1 后续迭代）
- [ ] 插件开关
- [ ] 选择处理的标签类型（如只处理 div/span 还是全部）
- [ ] 自定义公式边界正则
- [ ] 排除规则（如跳过特定 class 的元素）
- [ ] 性能调优参数（防抖延迟等）
