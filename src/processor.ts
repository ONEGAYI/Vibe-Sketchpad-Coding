/**
 * MarkdownPostProcessor 核心逻辑
 * 遍历 DOM 树，查找并渲染 HTML 标签内的 LaTeX 公式
 */

import { MarkdownPostProcessorContext } from 'obsidian';
import { shouldSkipNode, findMathMatches, MathMatch } from './utils';
import { renderAndReplace, completeMathRendering } from './math-renderer';

/**
 * 创建 HTML 标签内 LaTeX 公式的 PostProcessor
 */
export function createHtmlMathProcessor() {
	return async (el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> => {
		// 收集所有需要处理的文本节点和匹配
		const processingQueue: Array<{ node: Text; matches: MathMatch[] }> = [];

		// 使用 TreeWalker 遍历所有文本节点
		const walker = document.createTreeWalker(
			el,
			NodeFilter.SHOW_TEXT,
			null
		);

		let textNode: Text | null;
		while ((textNode = walker.nextNode() as Text | null)) {
			// 检查是否应该跳过
			if (shouldSkipNode(textNode)) {
				continue;
			}

			const text = textNode.textContent;
			if (!text) continue;

			// 查找公式匹配
			const matches = findMathMatches(text);
			if (matches.length > 0) {
				processingQueue.push({ node: textNode, matches });
			}
		}

		// 如果没有需要处理的，直接返回
		if (processingQueue.length === 0) {
			return;
		}

		// 处理所有匹配（从后往前，避免索引偏移问题）
		let needsFinishRender = false;

		for (const { node, matches } of processingQueue) {
			// 从后往前处理，这样索引不会变化
			const sortedMatches = [...matches].sort((a, b) => b.startIndex - a.startIndex);

			for (const match of sortedMatches) {
				const success = await processMatch(node, match);
				if (success) {
					needsFinishRender = true;
				}
			}
		}

		// 完成渲染
		if (needsFinishRender) {
			await completeMathRendering();
		}
	};
}

/**
 * 处理单个匹配
 * 注意：每次处理后文本节点会被分割，需要返回新的文本节点供后续使用
 */
async function processMatch(
	textNode: Text,
	match: MathMatch
): Promise<boolean> {
	const parent = textNode.parentNode;
	if (!parent) return false;

	const text = textNode.textContent;
	if (!text) return false;

	// 检查索引是否仍然有效（可能被之前的处理改变）
	if (match.startIndex >= text.length || match.endIndex > text.length) {
		return false;
	}

	// 验证匹配内容
	const actualContent = text.substring(match.startIndex, match.endIndex);
	const expectedPrefix = match.type === 'block' ? '$$' : '$';
	if (!actualContent.startsWith(expectedPrefix)) {
		return false;
	}

	try {
		// 渲染公式
		const { renderMathElement } = await import('./math-renderer');
		const mathEl = renderMathElement(match.content, match.type === 'block');

		// 分割文本并插入公式节点
		const beforeText = text.substring(0, match.startIndex);
		const afterText = text.substring(match.endIndex);

		// 创建文档片段
		const fragment = document.createDocumentFragment();

		if (beforeText) {
			fragment.appendChild(document.createTextNode(beforeText));
		}
		fragment.appendChild(mathEl);
		if (afterText) {
			fragment.appendChild(document.createTextNode(afterText));
		}

		// 替换原节点
		parent.replaceChild(fragment, textNode);

		return true;
	} catch (error) {
		console.error('HtmlMathFix: Failed to render math:', error);
		return false;
	}
}
