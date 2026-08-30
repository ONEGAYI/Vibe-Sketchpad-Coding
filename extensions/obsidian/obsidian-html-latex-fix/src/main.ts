/**
 * HTML LaTeX Fix Plugin for Obsidian
 *
 * 修复 HTML 标签内 LaTeX 公式无法渲染的问题
 *
 * Example:
 *   <div>$E=mc^2$</div>  →  <div>[渲染后的公式]</div>
 *
 * Phase 1.5: 自动格式化助手
 *   检测 HTML 标签内公式中的 < > 符号，提示用户修复
 */

import { Plugin, MarkdownView, WorkspaceLeaf, Notice, TFile } from 'obsidian';
import { createHtmlMathProcessor } from './processor';
import { checkFormulaProblems } from './checker/formula-checker';
import { fixFormulaProblems } from './fixer/formula-fixer';
import { showProblemNotice } from './ui/notice-ui';
import { DetailModal } from './ui/detail-modal';
import { ProblemItem } from './types/problem';
import { livePreviewExtensions } from './live-preview';

// 防抖计时器
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export default class HtmlMathFixPlugin extends Plugin {
	private processor: ReturnType<typeof createHtmlMathProcessor> | null = null;
	private currentNotice: Notice | null = null;
	private lastCheckedFile: string | null = null;

	async onload() {
		console.log('HtmlMathFix: 加载插件');

		// 创建并注册 PostProcessor（Phase 1 功能）
		this.processor = createHtmlMathProcessor();
		this.registerMarkdownPostProcessor(this.processor);

		// 注册实时预览扩展（Phase 2 功能）
		this.registerEditorExtension(livePreviewExtensions);

		// 注册事件监听（Phase 1.5 自动格式化助手）
		this.registerEventListeners();

		console.log('HtmlMathFix: 插件加载完成');
	}

	onunload() {
		console.log('HtmlMathFix: Unloading plugin');
		this.processor = null;
		if (checkDebounceTimer) {
			clearTimeout(checkDebounceTimer);
		}
		if (this.currentNotice) {
			this.currentNotice.hide();
		}
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
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (file) {
					this.debouncedCheck(this.app.workspace.activeLeaf);
				}
			})
		);

		// 保存时检测（强制重新检测当前文件）
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && file.path === activeFile.path) {
					// 重置缓存以允许重新检测
					this.lastCheckedFile = null;
					this.debouncedCheck(this.app.workspace.activeLeaf);
				}
			})
		);

		// 布局变化时检测（包括模式切换：编辑模式 ↔ 阅读模式）
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const leaf = this.app.workspace.activeLeaf;
				if (leaf && leaf.view instanceof MarkdownView) {
					const view = leaf.view as MarkdownView;
					// 只在切换到阅读模式时检测
					if (view.getMode() === 'preview') {
						// 重置缓存以允许重新检测
						this.lastCheckedFile = null;
						this.debouncedCheck(leaf);
					}
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

		// 获取源文件内容
		const file = view.file;
		if (!file) return;

		// 避免重复检测同一文件
		if (this.lastCheckedFile === file.path) return;
		this.lastCheckedFile = file.path;

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
	private showProblemNotification(problems: ProblemItem[], view: MarkdownView) {
		// 避免重复弹窗
		if (this.currentNotice) {
			this.currentNotice.hide();
		}

		this.currentNotice = showProblemNotice(
			problems.length,
			problems,
			() => this.fixProblems(problems, view),
			() => this.openDetailModal(problems, view),
			() => this.openSettings()
		);
	}

	/**
	 * 打开详情弹窗
	 */
	private openDetailModal(problems: ProblemItem[], view: MarkdownView) {
		new DetailModal(this.app, problems, () => this.fixProblems(problems, view)).open();
	}

	/**
	 * 打开设置页面（占位）
	 */
	private openSettings() {
		new Notice('设置页面开发中...');
	}

	/**
	 * 执行修复
	 */
	private async fixProblems(problems: ProblemItem[], view: MarkdownView) {
		// 如果在阅读模式，先切换到编辑模式
		const currentMode = view.getMode();
		if (currentMode === 'preview') {
			// 使用内部 API 切换到源码模式
			const leaf = this.app.workspace.getLeaf();
			await leaf.setViewState({
				type: 'markdown',
				state: { mode: 'source' }
			}, { focus: true });

			// 等待视图切换完成
			await new Promise(resolve => setTimeout(resolve, 150));
		}

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
