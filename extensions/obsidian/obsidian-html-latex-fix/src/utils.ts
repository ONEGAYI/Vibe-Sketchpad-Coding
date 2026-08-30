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

// ============================================================
// 严格公式扫描（供修复器在源文本层面使用）
//
// 与 findMathMatches（渲染路径）的区别：
// - 伪匹配回退：MIPS 汇编寄存器（$s0、$sp）等单个 $ 会打乱奇偶配对，
//   使"伪公式"区间横跨 </td><td> 等结构标签。若公式内容出现表格结构
//   标签的完整形态（数学公式内不可能出现），则开定界视为普通字符，
//   从其后重扫，让被吞掉的真公式重新配对。
//   注意判据只收表格结构标签，不能扩大到任意标签样式：
//   $<x,y>$（内积）、$a<b>c$（连不等）是合法公式，需照常检出。
// - code 区域：HTML 块内 <code>/<pre> 中的 $ 与 < 不参与公式判定
//   （与渲染路径 shouldSkipNode 跳过 CODE/PRE 对齐）。
// ============================================================

// 表格结构标签的完整形态（含闭合 >），作为伪公式判据
const TABLE_TAG_REGEX = /<\/?(?:td|th|tr|table|tbody|thead|tfoot|caption|col|colgroup)\b[^<>]*>/;

// HTML 块内的代码区域
const CODE_REGION_REGEX = /<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

interface Region {
	start: number;
	end: number;
}

function findCodeRegions(text: string): Region[] {
	const regions: Region[] = [];
	CODE_REGION_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CODE_REGION_REGEX.exec(text)) !== null) {
		regions.push({ start: match.index, end: CODE_REGION_REGEX.lastIndex });
	}
	return regions;
}

/**
 * 判断一个候选公式是否为伪匹配（应回退）
 * @param content 公式内容
 * @param start 公式区间起点（含定界符）
 * @param end 公式区间终点（含定界符）
 * @param codeRegions 代码区域列表
 */
function isSpuriousMatch(content: string, start: number, end: number, codeRegions: Region[]): boolean {
	if (TABLE_TAG_REGEX.test(content)) return true;
	return codeRegions.some(r => start < r.end && end > r.start);
}

/**
 * 严格扫描公式匹配：块级优先，行内排除块级覆盖区；
 * 伪匹配（含表格结构标签、与 code 区域相交）时回退重试。
 * @param text 待扫描文本（通常是单个 HTML 块）
 */
export function findMathMatchesStrict(text: string): MathMatch[] {
	const codeRegions = findCodeRegions(text);

	// 块级 $$...$$：伪匹配时开定界回退一位重扫
	const blockMatches: MathMatch[] = [];
	let i = 0;
	while (true) {
		const open = text.indexOf('$$', i);
		if (open === -1) break;
		if (open > 0 && text[open - 1] === '\\') {
			i = open + 1;
			continue;
		}
		const close = text.indexOf('$$', open + 2);
		if (close === -1) break;
		if (!isSpuriousMatch(text.slice(open + 2, close), open, close + 2, codeRegions)) {
			blockMatches.push({
				type: 'block',
				content: text.slice(open + 2, close),
				startIndex: open,
				endIndex: close + 2,
			});
			i = close + 2;
		} else {
			i = open + 1;
		}
	}

	// 行内 $...$：手动配对（转义 \$、相邻 $$ 不作定界；内容不跨行）
	const inlineMatches: MathMatch[] = [];
	let p = 0;
	while (p < text.length) {
		if (text[p] !== '$') {
			p++;
			continue;
		}
		// 开定界条件：前非 \、前非 $（$$ 属块级）、后非 $（$$ 开头）
		if (
			(p > 0 && (text[p - 1] === '\\' || text[p - 1] === '$')) ||
			text[p + 1] === '$'
		) {
			p++;
			continue;
		}
		// 找闭定界：下一个非转义 $，遇换行视为无匹配
		let closed = -1;
		for (let q = p + 1; q < text.length; q++) {
			if (text[q] === '\n') break;
			if (text[q] === '$') {
				if (text[q - 1] === '\\') continue;
				closed = q;
				break;
			}
		}
		if (closed === -1) {
			p++;
			continue;
		}
		const overlapsBlock = blockMatches.some(
			m => p < m.endIndex && closed + 1 > m.startIndex
		);
		const content = text.slice(p + 1, closed);
		if (!overlapsBlock && !isSpuriousMatch(content, p, closed + 1, codeRegions)) {
			inlineMatches.push({
				type: 'inline',
				content,
				startIndex: p,
				endIndex: closed + 1,
			});
			p = closed + 1;
		} else {
			p++;
		}
	}

	return [...blockMatches, ...inlineMatches].sort((a, b) => a.startIndex - b.startIndex);
}
