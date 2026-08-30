/**
 * 工具函数：正则定义、节点过滤、文本分割
 */

// 块级公式 $$...$$，支持多行
export const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;

// 行内公式 $...$，支持 \$ 转义，不支持跨行
export const INLINE_MATH_REGEX = /(?<!\\)\$([^\$\n]+?)(?<!\\)\$/g;

// 需要跳过的父节点标签名
const SKIP_TAGS = new Set(['CODE', 'PRE']);

// 需要跳过的父节点 class
const SKIP_CLASSES = new Set(['math', 'math-inline', 'math-block']);

/**
 * 判断文本节点是否应该被跳过
 * 跳过：代码块、已渲染的公式节点
 */
export function shouldSkipNode(node: Text): boolean {
	const parent = node.parentElement;
	if (!parent) return false;

	// 检查标签名
	if (SKIP_TAGS.has(parent.tagName)) {
		return true;
	}

	// 检查 class
	if (parent.classList) {
		for (const cls of SKIP_CLASSES) {
			if (parent.classList.contains(cls)) {
				return true;
			}
		}
	}

	// 检查 data-math 属性
	if (parent.hasAttribute('data-math')) {
		return true;
	}

	return false;
}

/**
 * 重置正则表达式的 lastIndex
 */
export function resetRegex(regex: RegExp): void {
	regex.lastIndex = 0;
}

/**
 * 匹配结果接口
 */
export interface MathMatch {
	type: 'block' | 'inline';
	content: string;
	startIndex: number;
	endIndex: number;
}

/**
 * 在文本中查找所有公式匹配
 * 块级公式优先于行内公式
 */
export function findMathMatches(text: string): MathMatch[] {
	const matches: MathMatch[] = [];

	// 先匹配块级公式
	resetRegex(BLOCK_MATH_REGEX);
	let match: RegExpExecArray | null;
	while ((match = BLOCK_MATH_REGEX.exec(text)) !== null) {
		matches.push({
			type: 'block',
			content: match[1],
			startIndex: match.index,
			endIndex: BLOCK_MATH_REGEX.lastIndex
		});
	}

	// 再匹配行内公式，跳过已被块级公式覆盖的区域
	resetRegex(INLINE_MATH_REGEX);
	while ((match = INLINE_MATH_REGEX.exec(text)) !== null) {
		const start = match.index;
		const end = INLINE_MATH_REGEX.lastIndex;

		// 检查是否与块级公式重叠
		const overlaps = matches.some(m =>
			(start >= m.startIndex && start < m.endIndex) ||
			(end > m.startIndex && end <= m.endIndex)
		);

		if (!overlaps) {
			matches.push({
				type: 'inline',
				content: match[1],
				startIndex: start,
				endIndex: end
			});
		}
	}

	// 按位置排序
	matches.sort((a, b) => a.startIndex - b.startIndex);

	return matches;
}
