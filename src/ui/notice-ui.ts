/**
 * 通知弹窗 UI
 * 右下角弹窗提示格式问题
 */

import { Notice } from 'obsidian';
import { ProblemItem } from '../types/problem';

/**
 * 显示格式问题通知
 */
export function showProblemNotice(
	problemCount: number,
	problems: ProblemItem[],
	onFix: () => void,
	onShowDetail: () => void,
	onOpenSettings: () => void
): Notice {
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
	fixBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		notice.hide();
		onFix();
	});

	// 查看详情按钮
	const detailBtn = buttons.createEl('button');
	detailBtn.setText('查看详情');
	detailBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		notice.hide();
		onShowDetail();
	});

	// 设置按钮（齿轮图标）
	const settingsBtn = buttons.createEl('button', { cls: 'html-math-fix-settings-btn' });
	settingsBtn.setText('⚙');
	settingsBtn.setAttribute('aria-label', '设置');
	settingsBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		notice.hide();
		onOpenSettings();
	});

	// 显示通知（0 = 不自动消失）
	const notice = new Notice(noticeEl, 0);
	return notice;
}
