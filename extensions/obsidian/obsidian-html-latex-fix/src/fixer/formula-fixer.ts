/**
 * 公式格式修复器
 * 使用 Editor API 修复公式格式问题，支持撤销
 */

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
		return b.startIndex - a.startIndex;
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
