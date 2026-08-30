/**
 * 详情弹窗 UI
 * 显示所有格式问题的详细列表
 */

import { App, Modal } from 'obsidian';
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

		// 添加自定义类
		contentEl.addClass('html-math-fix-detail-modal');

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

		// 悬停显示完整行内容
		item.setAttribute('aria-label', problem.fullLine);
		item.addClass('has-tooltip');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
