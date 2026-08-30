/**
 * 公式格式检测器
 * 检测 HTML 标签内 LaTeX 公式中的 < 和 > 符号
 */

import { ProblemItem } from '../types/problem';

// HTML 标签正则（匹配 <tag>...</tag>）
const HTML_TAG_REGEX = /<([a-zA-Z][a-zA-Z0-9]*)[^>]*>[\s\S]*?<\/\1>/g;

// 公式正则
const INLINE_MATH_REGEX = /(?<!\$)\$(?!\$)([^\$\n]+?)\$/g;
const BLOCK_MATH_REGEX = /\$\$([\s\S]+?)\$\$/g;

// 问题符号配置
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

	// 在公式内查找 < 和 >
	for (let i = 0; i < formulaContent.length; i++) {
		const char = formulaContent[i];
		if (char === '<' || char === '>') {
			// 检查是否已转义（前一个是反斜杠）
			if (i > 0 && formulaContent[i - 1] === '\\') continue;

			// 检查是否已是 \lt 或 \gt 的一部分
			if (isPartOfReplacement(formulaContent, i)) continue;

			// 计算全局行列
			const globalPos = formulaStart + i;
			const { line, column } = getLineColumn(lines, globalPos);

			// 获取上下文
			const context = extractContext(formulaContent, i);

			// 智能计算 replacement：如果紧邻字母则添加空格
			const replacement = buildSmartReplacement(formulaContent, i, char as '<' | '>');

			problems.push({
				line: line + 1, // 1-based
				column: column + 1,
				symbol: char as '<' | '>',
				replacement,
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
 * 构建智能替换字符串
 * 如果符号紧邻字母，需要添加空格隔开
 */
function buildSmartReplacement(content: string, index: number, symbol: '<' | '>'): string {
	const baseReplacement = PROBLEM_SYMBOLS[symbol].replacement;
	let result = baseReplacement;

	// 检查前面字符
	const prevChar = index > 0 ? content[index - 1] : '';
	const needsLeadingSpace = /[a-zA-Z]/.test(prevChar);

	// 检查后面字符
	const nextChar = index < content.length - 1 ? content[index + 1] : '';
	const needsTrailingSpace = /[a-zA-Z]/.test(nextChar);

	// 构建最终替换字符串
	if (needsLeadingSpace) {
		result = ' ' + result;
	}
	if (needsTrailingSpace) {
		result = result + ' ';
	}

	return result;
}

/**
 * 检查位置是否已是替换内容的一部分（\lt> 或 \gt>）
 */
function isPartOfReplacement(content: string, index: number): boolean {
	// 检查 \lt>（即当前 > 是 \lt 的结尾）
	if (content.slice(index - 3, index + 1) === '\\lt>') return true;
	// 检查 \gt>
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
		charCount += lines[i].length + 1; // +1 for \n
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
