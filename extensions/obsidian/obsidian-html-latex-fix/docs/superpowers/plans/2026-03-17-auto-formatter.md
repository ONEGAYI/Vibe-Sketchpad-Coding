# 自动格式化助手 - 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 HTML 标签内 LaTeX 公式中 `<` `>` 符号的自动检测与修复功能

**Architecture:** 正则扫描源文件 → 收集问题列表 → UI 弹窗提示 → Editor API 修复（支持撤销）

**Tech Stack:** TypeScript, Obsidian API (Plugin, Modal, Notice, Editor)

---

## 文件结构

```
src/
├── main.ts                 # 修改：添加事件监听和协调逻辑
├── checker/
│   └── formula-checker.ts  # 新建：检测逻辑
├── fixer/
│   └── formula-fixer.ts    # 新建：修复逻辑
├── ui/
│   ├── notice-ui.ts        # 新建：右下角通知弹窗
│   └── detail-modal.ts     # 新建：详情弹窗
└── types/
    └── problem.ts          # 新建：类型定义
```

---

### Task 1: 类型定义

**Files:**
- Create: `src/types/problem.ts`

- [ ] **Step 1: 创建 ProblemItem 接口**

```typescript
/**
 * 公式格式问题项
 */
export interface ProblemItem {
  line: number;        // 行号（1-based）
  column: number;      // 列号（1-based）
  symbol: '<' | '>';   // 问题符号
  replacement: string; // 替换内容 ('\lt' 或 '\gt')
  context: string;     // 上下文（截断后，用于显示）
  fullLine: string;    // 完整行内容
  startIndex: number;  // 问题符号在行内的起始位置
  endIndex: number;    // 问题符号在行内的结束位置
}

/**
 * 检测结果
 */
export interface CheckResult {
  hasProblems: boolean;
  problems: ProblemItem[];
  filePath: string;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/types/problem.ts
git commit -m "feat: 添加 ProblemItem 和 CheckResult 类型定义"
```

---

### Task 2: 检测器

**Files:**
- Create: `src/checker/formula-checker.ts`

- [ ] **Step 1: 实现检测逻辑**

```typescript
import { ProblemItem } from '../types/problem';

// HTML 标签正则（匹配 <tag>...</tag>）
const HTML_TAG_REGEX = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*>[\s\S]*?<\/\1>/g;

// 公式正则
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$)([^\$\n]+?)\$/g;
const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;

// 问题符号
const PROBLEM_SYMBOLS = {
  '<': { replacement: '\\lt', name: '小于号' },
  '>': { replacement: '\\gt', name: '大于号' },
} as const;

/**
 * 检测文本中 HTML 标签内公式的问题符号
 * @param content 源文件内容
 * @returns 问题列表
 */
export function checkFormulaProblems(content: string): ProblemItem[] {
  const problems: ProblemItem[] = [];
  const lines = content.split('\n');

  // 重置正则
  HTML_TAG_REGEX.lastIndex = 0;

  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = HTML_TAG_REGEX.exec(content)) !== null) {
    const htmlBlock = htmlMatch[0];
    const htmlStart = htmlMatch.index;

    // 在 HTML 块内查找公式
    const formulaProblems = findProblemsInHtmlBlock(htmlBlock, htmlStart, lines);
    problems.push(...formulaProblems);
  }

  // 按行号排序
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * 在 HTML 块内查找公式问题
 */
function findProblemsInHtmlBlock(
  htmlBlock: string,
  htmlStart: number,
  lines: string[]
): ProblemItem[] {
  const problems: ProblemItem[] = [];

  // 查找块级公式
  BLOCK_MATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_MATH_REGEX.exec(htmlBlock)) !== null) {
    const formulaContent = match[1];
    const formulaStart = htmlStart + match.index;
    const found = findSymbolsInFormula(formulaContent, formulaStart + 2, lines);
    problems.push(...found);
  }

  // 查找行内公式
  INLINE_MATH_REGEX.lastIndex = 0;
  while ((match = INLINE_MATH_REGEX.exec(htmlBlock)) !== null) {
    const formulaContent = match[1];
    const formulaStart = htmlStart + match.index;
    const found = findSymbolsInFormula(formulaContent, formulaStart + 1, lines);
    problems.push(...found);
  }

  return problems;
}

/**
 * 在公式内容中查找问题符号
 */
function findSymbolsInFormula(
  formulaContent: string,
  formulaStart: number,
  lines: string[]
): ProblemItem[] {
  const problems: ProblemItem[] = [];

  // 计算公式起始位置对应的行列
  let charCount = 0;
  let startLine = 0;
  let startColumn = 0;

  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= formulaStart) {
      startLine = i;
      startColumn = formulaStart - charCount;
      break;
    }
    charCount += lines[i].length + 1; // +1 for \n
  }

  // 在公式内查找 < 和 >
  for (let i = 0; i < formulaContent.length; i++) {
    const char = formulaContent[i];
    if (char === '<' || char === '>') {
      // 检查是否已转义
      if (i > 0 && formulaContent[i - 1] === '\\') continue;

      // 检查是否已是 \lt 或 \gt 的一部分
      if (isPartOfReplacement(formulaContent, i)) continue;

      // 计算全局行列
      const globalPos = formulaStart + i;
      const { line, column } = getLineColumn(lines, globalPos);

      // 获取上下文
      const context = extractContext(formulaContent, i);

      problems.push({
        line: line + 1, // 1-based
        column: column + 1,
        symbol: char as '<' | '>',
        replacement: PROBLEM_SYMBOLS[char].replacement,
        context,
        fullLine: lines[line],
        startIndex: column,
        endIndex: column + 1,
      });
    }
  }

  return problems;
}

/**
 * 检查位置是否已是替换内容的一部分
 */
function isPartOfReplacement(content: string, index: number): boolean {
  // 检查 \lt
  if (content.slice(index - 3, index + 1) === '\\lt>') return true;
  // 检查 \gt
  if (content.slice(index - 3, index + 1) === '\\gt>') return true;
  return false;
}

/**
 * 根据全局位置计算行列
 */
function getLineColumn(lines: string[], pos: number): { line: number; column: number } {
  let charCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (charCount + lines[i].length >= pos) {
      return { line: i, column: pos - charCount };
    }
    charCount += lines[i].length + 1;
  }
  return { line: lines.length - 1, column: lines[lines.length - 1].length };
}

/**
 * 提取上下文（问题符号前后各 20 字符）
 */
function extractContext(content: string, index: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(content.length, index + 21);
  let context = content.slice(start, end);
  if (start > 0) context = '...' + context;
  if (end < content.length) context = context + '...';
  return context;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/checker/formula-checker.ts
git commit -m "feat: 实现公式格式问题检测逻辑"
```

---

### Task 3: 修复器

**Files:**
- Create: `src/fixer/formula-fixer.ts`

- [ ] **Step 1: 实现修复逻辑**

```typescript
import { Editor, EditorPosition } from 'obsidian';
import { ProblemItem } from '../types/problem';

/**
 * 修复公式格式问题
 * @param editor Obsidian 编辑器实例
 * @param problems 问题列表
 * @returns 修复的问题数量
 */
export function fixFormulaProblems(editor: Editor, problems: ProblemItem[]): number {
  if (problems.length === 0) return 0;

  // 按行号倒序排序，从后往前替换避免位置偏移
  const sortedProblems = [...problems].sort((a, b) => {
    if (a.line !== b.line) return b.line - a.line;
    return b.column - a.column;
  });

  let fixedCount = 0;

  for (const problem of sortedProblems) {
    try {
      const from: EditorPosition = { line: problem.line - 1, ch: problem.startIndex };
      const to: EditorPosition = { line: problem.line - 1, ch: problem.endIndex };

      editor.replaceRange(problem.replacement, from, to);
      fixedCount++;
    } catch (error) {
      console.error('HtmlMathFix: Failed to fix problem at line', problem.line, error);
    }
  }

  return fixedCount;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/fixer/formula-fixer.ts
git commit -m "feat: 实现公式格式问题修复逻辑"
```

---

### Task 4: 通知弹窗 UI (notice-ui.ts)

**Files:**
- Create: `src/ui/notice-ui.ts`

- [ ] **Step 1: 实现通知弹窗**

```typescript
import { App, Notice, setIcon } from 'obsidian';
import { ProblemItem } from '../types/problem';

/**
 * 显示格式问题通知
 */
export function showProblemNotice(
  app: App,
  problemCount: number,
  problems: ProblemItem[],
  onFix: () => void,
  onOpenSettings: () => void
): void {
  // 创建通知容器
  const noticeEl = document.createDocumentFragment();

  // 标题
  const title = noticeEl.createDiv({ cls: 'html-math-fix-notice-title' });
  title.setText(`⚠️ 检测到 ${problemCount} 处公式格式问题`);

  // 说明
  const desc = noticeEl.createDiv({ cls: 'html-math-fix-notice-desc' });
  desc.setText('若不修复，可能导致：公式渲染错误、HTML 解析异常');

  // 按钮容器
  const buttons = noticeEl.createDiv({ cls: 'html-math-fix-notice-buttons' });

  // 一键修复按钮
  const fixBtn = buttons.createEl('button', { cls: 'mod-cta' });
  fixBtn.setText('一键修复');
  fixBtn.addEventListener('click', () => {
    notice.hide();
    onFix();
  });

  // 查看详情按钮
  const detailBtn = buttons.createEl('button');
  detailBtn.setText('查看详情');
  detailBtn.addEventListener('click', () => {
    notice.hide();
    // 详情弹窗在 main.ts 中调用
    (notice as any)._openDetail = true;
    (notice as any)._problems = problems;
  });

  // 设置按钮（齿轮图标）
  const settingsBtn = buttons.createEl('button', { cls: 'html-math-fix-settings-btn' });
  setIcon(settingsBtn, 'settings');
  settingsBtn.addEventListener('click', () => {
    notice.hide();
    onOpenSettings();
  });

  // 显示通知（设置较长的超时时间）
  const notice = new Notice(noticeEl, 0);
}

/**
 * 检查通知是否需要打开详情弹窗
 */
export function checkNoticeDetailAction(noticeData: any): { openDetail: boolean; problems: ProblemItem[] } | null {
  if (noticeData._openDetail) {
    return {
      openDetail: true,
      problems: noticeData._problems,
    };
  }
  return null;
}
```

- [ ] **Step 2: 添加样式到 main.ts 或单独的 CSS**

在 `src/` 目录创建 `styles.css`：

```css
/* 通知弹窗样式 */
.html-math-fix-notice-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.html-math-fix-notice-desc {
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: 12px;
}

.html-math-fix-notice-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.html-math-fix-settings-btn {
  padding: 4px 8px !important;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/ui/notice-ui.ts src/styles.css
git commit -m "feat: 实现格式问题通知弹窗 UI"
```

---

### Task 5: 详情弹窗 (detail-modal.ts)

**Files:**
- Create: `src/ui/detail-modal.ts`

- [ ] **Step 1: 实现详情弹窗**

```typescript
import { App, Modal, setIcon } from 'obsidian';
import { ProblemItem } from '../types/problem';

export class DetailModal extends Modal {
  private problems: ProblemItem[];
  private onFix: () => void;

  constructor(app: App, problems: ProblemItem[], onFix: () => void) {
    super(app);
    this.problems = problems;
    this.onFix = onFix;
  }

  onOpen() {
    const { contentEl } = this;

    // 标题
    contentEl.createEl('h2', { text: '公式格式问题详情' });

    // 问题数量
    contentEl.createDiv({ cls: 'detail-modal-count' })
      .setText(`共 ${this.problems.length} 处问题：`);

    // 问题列表容器
    const listContainer = contentEl.createDiv({ cls: 'detail-modal-list' });

    // 添加每个问题项
    for (const problem of this.problems) {
      this.addProblemItem(listContainer, problem);
    }

    // 按钮区域
    const buttonContainer = contentEl.createDiv({ cls: 'detail-modal-buttons' });

    const fixBtn = buttonContainer.createEl('button', { cls: 'mod-cta', text: '一键修复' });
    fixBtn.addEventListener('click', () => {
      this.close();
      this.onFix();
    });

    const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
    cancelBtn.addEventListener('click', () => {
      this.close();
    });
  }

  private addProblemItem(container: HTMLElement, problem: ProblemItem) {
    const item = container.createDiv({ cls: 'detail-modal-item' });

    // 行号
    const lineInfo = item.createDiv({ cls: 'detail-modal-line' });
    lineInfo.createEl('span', { cls: 'detail-modal-line-num', text: `第 ${problem.line} 行` });

    // 上下文
    const contextEl = item.createDiv({ cls: 'detail-modal-context' });
    contextEl.setText(problem.context);

    // 问题指示
    const indicator = item.createDiv({ cls: 'detail-modal-indicator' });
    const symbolName = problem.symbol === '<' ? '小于号' : '大于号';
    indicator.setText(`↑ ${symbolName}需替换为 ${problem.replacement}`);

    // 悬停显示完整内容
    item.setAttribute('aria-label', problem.fullLine);
    item.addClass('has-tooltip');
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
```

- [ ] **Step 2: 添加详情弹窗样式到 styles.css**

```css
/* 详情弹窗样式 */
.detail-modal-count {
  color: var(--text-muted);
  margin-bottom: 16px;
}

.detail-modal-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--background-modifier-border);
  border-radius: 4px;
  margin-bottom: 16px;
}

.detail-modal-item {
  padding: 12px;
  border-bottom: 1px solid var(--background-modifier-border);
}

.detail-modal-item:last-child {
  border-bottom: none;
}

.detail-modal-item:hover {
  background: var(--background-secondary);
}

.detail-modal-line {
  font-weight: 600;
  margin-bottom: 4px;
}

.detail-modal-line-num {
  color: var(--text-accent);
}

.detail-modal-context {
  font-family: var(--font-monospace);
  font-size: 12px;
  background: var(--background-primary-alt);
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-modal-indicator {
  color: var(--text-warning);
  font-size: 11px;
}

.detail-modal-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.has-tooltip {
  cursor: help;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/ui/detail-modal.ts src/styles.css
git commit -m "feat: 实现详情弹窗 UI"
```

---

### Task 6: 主入口集成 (main.ts 修改)

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 修改 main.ts 添加事件监听和协调逻辑**

```typescript
/**
 * HTML LaTeX Fix Plugin for Obsidian
 *
 * 修复 HTML 标签内 LaTeX 公式无法渲染的问题
 */

import { Plugin, MarkdownView, WorkspaceLeaf, Notice } from 'obsidian';
import { createHtmlMathProcessor } from './processor';
import { checkFormulaProblems } from './checker/formula-checker';
import { fixFormulaProblems } from './fixer/formula-fixer';
import { showProblemNotice } from './ui/notice-ui';
import { DetailModal } from './ui/detail-modal';

// 防抖计时器
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export default class HtmlMathFixPlugin extends Plugin {
  private processor: ReturnType<typeof createHtmlMathProcessor> | null = null;
  private currentNotice: Notice | null = null;

  async onload() {
    console.log('HtmlMathFix: Loading plugin');

    // 注册样式
    this.registerStyles();

    // 创建并注册 PostProcessor（Phase 1 功能）
    this.processor = createHtmlMathProcessor();
    this.registerMarkdownPostProcessor(this.processor);

    // 注册事件监听（Phase 1.5 自动格式化助手）
    this.registerEventListeners();

    console.log('HtmlMathFix: Plugin loaded successfully');
  }

  onunload() {
    console.log('HtmlMathFix: Unloading plugin');
    this.processor = null;
    if (checkDebounceTimer) {
      clearTimeout(checkDebounceTimer);
    }
  }

  /**
   * 注册样式
   */
  private registerStyles() {
    // 样式通过 styles.css 自动加载
  }

  /**
   * 注册事件监听
   */
  private registerEventListeners() {
    // 切换视图/文档时检测
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
        this.debouncedCheck(leaf);
      })
    );

    // 打开文件时检测
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.debouncedCheck(this.app.workspace.activeLeaf);
      })
    );

    // 保存时检测
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile && file.path === activeFile.path) {
          this.debouncedCheck(this.app.workspace.activeLeaf);
        }
      })
    );
  }

  /**
   * 防抖检测
   */
  private debouncedCheck(leaf: WorkspaceLeaf | null) {
    if (checkDebounceTimer) {
      clearTimeout(checkDebounceTimer);
    }

    checkDebounceTimer = setTimeout(() => {
      this.checkCurrentDocument(leaf);
    }, 300);
  }

  /**
   * 检测当前文档
   */
  private checkCurrentDocument(leaf: WorkspaceLeaf | null) {
    if (!leaf) return;

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;

    // 检查是否为阅读模式
    const isReadingMode = view.getMode() === 'preview';
    if (!isReadingMode) return;

    // 获取源文件内容
    const file = view.file;
    if (!file) return;

    this.app.vault.read(file).then((content) => {
      const problems = checkFormulaProblems(content);

      if (problems.length > 0) {
        this.showProblemNotification(problems, view);
      }
    }).catch((error) => {
      console.error('HtmlMathFix: Failed to read file', error);
    });
  }

  /**
   * 显示问题通知
   */
  private showProblemNotification(problems: any[], view: MarkdownView) {
    // 避免重复弹窗
    if (this.currentNotice) {
      this.currentNotice.hide();
    }

    const onFix = () => {
      this.fixProblems(problems, view);
    };

    const onOpenSettings = () => {
      // TODO: 打开设置页面（占位）
      new Notice('设置页面开发中...');
    };

    // 使用自定义通知
    const noticeEl = document.createDocumentFragment();

    const title = noticeEl.createDiv({ cls: 'html-math-fix-notice-title' });
    title.setText(`⚠️ 检测到 ${problems.length} 处公式格式问题`);

    const desc = noticeEl.createDiv({ cls: 'html-math-fix-notice-desc' });
    desc.setText('若不修复，可能导致：公式渲染错误、HTML 解析异常');

    const buttons = noticeEl.createDiv({ cls: 'html-math-fix-notice-buttons' });

    const fixBtn = buttons.createEl('button', { cls: 'mod-cta' });
    fixBtn.setText('一键修复');
    fixBtn.addEventListener('click', () => {
      this.currentNotice?.hide();
      this.fixProblems(problems, view);
    });

    const detailBtn = buttons.createEl('button');
    detailBtn.setText('查看详情');
    detailBtn.addEventListener('click', () => {
      this.currentNotice?.hide();
      new DetailModal(this.app, problems, () => this.fixProblems(problems, view)).open();
    });

    const settingsBtn = buttons.createEl('button', { cls: 'html-math-fix-settings-btn' });
    settingsBtn.setText('⚙');
    settingsBtn.addEventListener('click', () => {
      this.currentNotice?.hide();
      new Notice('设置页面开发中...');
    });

    this.currentNotice = new Notice(noticeEl, 0);
  }

  /**
   * 执行修复
   */
  private fixProblems(problems: any[], view: MarkdownView) {
    const editor = view.editor;
    if (!editor) {
      new Notice('无法获取编辑器');
      return;
    }

    const fixedCount = fixFormulaProblems(editor, problems);

    if (fixedCount > 0) {
      new Notice(`✅ 已修复 ${fixedCount} 处问题`);
    } else {
      new Notice('修复失败，请手动检查');
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/main.ts
git commit -m "feat: 集成自动格式化助手到主入口"
```

---

### Task 7: 构建与测试

**Files:**
- Modify: `src/styles.css`（如需要补充样式）
- Build and Deploy

- [ ] **Step 1: 构建项目**

```bash
npm run build
```

- [ ] **Step 2: 部署到 Obsidian**

```bash
npm run deploy
```

- [ ] **Step 3: 手动测试清单**

1. 创建测试文件 `test.md`：
```markdown
<div>$a < b$</div>
<span>$x > y$</span>
<div>$$p < q$$</div>

普通段落 $m < n$ 不应检测
```

2. 测试场景：
   - [ ] 打开文档（阅读模式）→ 弹窗显示
   - [ ] 切换到阅读模式 → 弹窗显示
   - [ ] 点击「一键修复」→ 符号替换成功
   - [ ] Ctrl+Z 撤销 → 恢复原始内容
   - [ ] 点击「查看详情」→ 弹窗显示问题列表
   - [ ] 普通段落的公式不检测

- [ ] **Step 4: 最终提交**

```bash
npm run bump:patch
```

---

## 完成标准

- [ ] 所有文件创建/修改完成
- [ ] 构建成功无错误
- [ ] 手动测试全部通过
- [ ] 版本号更新并提交
