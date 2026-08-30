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

		// 处理所有文本节点（每个节点一次性替换所有公式）
		let needsFinishRender = false;

		for (const { node, matches } of processingQueue) {
			const success = await processTextNode(node, matches);
			if (success) {
				needsFinishRender = true;
			}
		}

		// 完成渲染
		if (needsFinishRender) {
			await completeMathRendering();
		}
	};
}

/**
 * 处理单个文本节点中的所有公式匹配
 * 一次性替换所有公式，避免多次 DOM 操作导致的引用问题
 */
async function processTextNode(
	textNode: Text,
	matches: MathMatch[]
): Promise<boolean> {
	const parent = textNode.parentNode;
	if (!parent) return false;

	const text = textNode.textContent;
	if (!text) return false;

	try {
		const { renderMathElement } = await import('./math-renderer');

		// 创建文档片段，按顺序插入文本和公式
		const fragment = document.createDocumentFragment();
		let lastIndex = 0;

		for (const match of matches) {
			// 添加匹配前的普通文本
			if (match.startIndex > lastIndex) {
				const beforeText = text.substring(lastIndex, match.startIndex);
				fragment.appendChild(document.createTextNode(beforeText));
			}

			// 渲染并添加公式元素
			const mathEl = renderMathElement(match.content, match.type === 'block');
			fragment.appendChild(mathEl);

			lastIndex = match.endIndex;
		}

		// 添加最后一个匹配后的文本
		if (lastIndex < text.length) {
			const afterText = text.substring(lastIndex);
			fragment.appendChild(document.createTextNode(afterText));
		}

		// 一次性替换原节点
		parent.replaceChild(fragment, textNode);

		return true;
	} catch (error) {
		console.error('HtmlMathFix: Failed to render math:', error);
		return false;
	}
}
