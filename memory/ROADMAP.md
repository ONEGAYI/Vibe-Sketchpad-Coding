# Obsidian HTML Tag LaTeX Fix - Roadmap

## Phase 1: 阅读模式 ✅ (已完成)

- [x] 使用 MarkdownPostProcessor 拦截 DOM
- [x] TreeWalker 遍历文本节点
- [x] 正则匹配 $...$ 和 $$...$$
- [x] 调用 obsidian.renderMath() 渲染
- [x] 修复同一文本节点中多个公式渲染问题

## Phase 1.5: 自动格式化助手 ✅ (已完成)

- [x] 检测 HTML 标签内公式中的 `<` `>` 符号
- [x] 右下角弹窗提示 + 一键修复按钮
- [x] 详情弹窗显示所有问题（行号、上下文）
- [x] 触发时机：打开文档、切换阅读模式、保存
- [x] 支持 Ctrl+Z 撤销
- [x] 齿轮按钮跳转设置（占位）
- [x] 智能空格处理（符号紧邻字母时自动添加空格）

**设计文档**: `docs/superpowers/specs/2026-03-17-auto-formatter-design.md`

## Phase 2: 实时预览模式 (未来)

- [ ] CodeMirror 6 扩展
- [ ] ViewPlugin + WidgetType
- [ ] 语法树解析 HTML 区块

## 未来扩展功能

### 自动格式化助手后续
- [ ] 设置页面：开关、自定义触发时机
- [ ] 批量处理：多文档检测
- [ ] 更多符号：`&` → `\&` 等

### 配置项（Phase 1 后续迭代）
- [ ] 插件开关
- [ ] 选择处理的标签类型（如只处理 div/span 还是全部）
- [ ] 自定义公式边界正则
- [ ] 排除规则（如跳过特定 class 的元素）
- [ ] 性能调优参数（防抖延迟等）
