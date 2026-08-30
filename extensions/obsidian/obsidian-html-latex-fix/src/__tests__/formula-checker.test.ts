/**
 * formula-checker 契约测试
 * 核心回归场景：MIPS 汇编寄存器 `$s0` 等打乱 `$` 奇偶配对，
 * 导致 HTML 结构标签被误判进公式区间而遭替换（2026-08 教材损坏事件）
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormulaProblems } from '../checker/formula-checker';

/** MIPS 寄存器表格：bug 现场（DDCA 教材典型形态） */
const MIPS_TABLE = [
	'<table>',
	'<tr><td>add $s0, $s1, $s2</td><td>若 $a < b$ 则跳转</td></tr>',
	'<tr><td>lw $t0, 0($sp)</td><td>取值</td></tr>',
	'</table>',
].join('\n');

describe('T1 寄存器 $ 不打乱公式配对（bug 现场）', () => {
	test('结构标签 </td><td> 不被报告为问题符号', () => {
		const problems = checkFormulaProblems(MIPS_TABLE);
		// 修复前：4 个来自伪公式 "s2</td><td>若 " 的误报
		const structural = problems.filter(p =>
			/td|tr|table/.test(p.context)
		);
		assert.equal(structural.length, 0, `结构标签被误报: ${JSON.stringify(structural)}`);
	});

	test('真公式 $a < b$ 的 < 仍被检出', () => {
		const problems = checkFormulaProblems(MIPS_TABLE);
		// 修复前：真公式被伪匹配吞掉，检出 0 个
		const real = problems.filter(p => p.context.includes('a < b'));
		assert.equal(real.length, 1, `真公式检出异常: ${JSON.stringify(problems)}`);
	});
});

describe('T2 基本检出能力保持', () => {
	test('HTML 块内行内公式 $a < b$ 报 1 个 <，前后空格时 replacement 为 \\lt', () => {
		const doc = '<table><tr><td>区间 $a < b$ 成立</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
		assert.equal(problems[0].symbol, '<');
		assert.equal(problems[0].replacement, '\\lt');
	});

	test('符号紧邻字母时前后补空格：$a<b$ → " \\lt "', () => {
		const doc = '<table><tr><td>当 $a<b$ 时</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
		assert.equal(problems[0].replacement, ' \\lt ');
	});

	test('块级公式 $$a < b$$ 内的 < 被检出', () => {
		const doc = '<div>$$a < b$$</div>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
		assert.equal(problems[0].symbol, '<');
	});

	test('块级公式与行内公式不重复报告同一符号', () => {
		// $$ 内含 $ 的文本：块级整体一次 + 行内不再重复扫
		const doc = '<div>$$x < y \\text{ 且 } z$$</div>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
	});

	test('HTML 块外的公式不检测（原有语义）', () => {
		const doc = '普通段落 $a < b$ 不处理';
		assert.equal(checkFormulaProblems(doc).length, 0);
	});

	test('内积 $<x,y>$ 照常检出（伪公式判据不得扩大到任意标签）', () => {
		const doc = '<table><tr><td>内积 $<x,y>$ 定义</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 2);
		assert.equal(problems[0].symbol, '<');
		assert.equal(problems[1].symbol, '>');
	});

	test('连不等 $a<b>c$ 照常检出（<b> 形态仍视为数学符号）', () => {
		const doc = '<table><tr><td>当 $a<b>c$ 时</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 2);
	});
});

describe('T3 转义与幂等', () => {
	test('\\$ 转义的 $ 不作定界，真公式照常检出', () => {
		const doc = '<table><tr><td>价格 \\$5 与 $x < y$ 比较</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].context.includes('x < y'));
	});

	test('已替换的 \\lt / \\gt 不重复报告（幂等）', () => {
		const doc = '<table><tr><td>$a \\lt V_{III}$</td></tr></table>';
		assert.equal(checkFormulaProblems(doc).length, 0);
	});
});

describe('T4 代码区域跳过', () => {
	test('<code> 内的 < 和 $ 不参与公式判定', () => {
		const doc = '<table><tr><td><code>if (a<b) $s0=1</code></td></tr></table>';
		assert.equal(checkFormulaProblems(doc).length, 0);
	});

	test('code 内寄存器 $ 不与 code 外真公式错位', () => {
		const doc = '<table><tr><td><code>set $s0, $t0</code></td><td>$x < y$</td></tr></table>';
		const problems = checkFormulaProblems(doc);
		assert.equal(problems.length, 1);
		assert.ok(problems[0].context.includes('x < y'));
	});

	test('<pre> 区域同样跳过', () => {
		const doc = '<table><tr><td><pre>cmp $a0, $a1</pre></td></tr></table>';
		assert.equal(checkFormulaProblems(doc).length, 0);
	});
});
