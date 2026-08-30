/**
 * 公式渲染封装
 * 调用 Obsidian 的 renderMath API
 */
import { renderMath, finishRenderMath } from 'obsidian';

/**
 * 渲染公式并返回 DOM 元素
 * @param content LaTeX 公式内容（不含 $ 符号）
 * @param isBlock 是否为块级公式
 * @returns 渲染后的 HTMLElement
 */
export function renderMathElement(content: string, isBlock: boolean): HTMLElement {
	return renderMath(content, isBlock);
}

/**
 * 完成 MathJax 渲染
 * 在所有公式渲染完成后调用，刷新 MathJax 样式表
 */
export async function completeMathRendering(): Promise<void> {
	await finishRenderMath();
}

/**
 * 渲染公式并替换文本节点
 * @param textNode 原始文本节点
 * @param match 匹配结果
 * @returns 是否成功渲染
 */
export async function renderAndReplace(
	textNode: Text,
	match: { content: string; type: 'block' | 'inline'; startIndex: number; endIndex: number }
): Promise<boolean> {
	const parent = textNode.parentNode;
	if (!parent) return false;

	try {
		// 渲染公式
		const mathEl = renderMathElement(match.content, match.type === 'block');

		// 分割文本节点
		const before = textNode.textContent?.substring(0, match.startIndex) ?? '';
		const after = textNode.textContent?.substring(match.endIndex) ?? '';

		// 创建新节点
		const fragment = document.createDocumentFragment();

		if (before) {
			fragment.appendChild(document.createTextNode(before));
		}

		fragment.appendChild(mathEl);

		if (after) {
			fragment.appendChild(document.createTextNode(after));
		}

		// 替换原节点
		parent.replaceChild(fragment, textNode);

		return true;
	} catch (error) {
		console.error('Failed to render math:', error);
		return false;
	}
}
