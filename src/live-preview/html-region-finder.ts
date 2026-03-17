import { EditorView } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { findMathMatches, MathMatch } from '../utils';

/**
 * HTML 区域（语法树节点范围）
 */
export interface HtmlRegion {
  from: number;  // 起始位置（文档绝对位置）
  to: number;    // 结束位置（文档绝对位置）
}

/**
 * HTML 区域内的公式匹配
 */
export interface MathInRegionMatch {
  from: number;       // 文档绝对位置
  to: number;         // 文档绝对位置
  content: string;    // 公式内容（不含 $ 符号）
  isBlock: boolean;   // true = $$...$$, false = $...$
}

/**
 * 支持的 HTML 标签名称（小写）
 */
const SUPPORTED_TAGS = new Set([
  'div', 'span', 'details', 'summary', 'mark'
]);

/**
 * 识别文档中的所有 HTML 区域
 *
 * 策略：遍历语法树，找到 HTMLBlock/HTMLTag 节点，
 *       检查标签名是否在支持列表中
 */
export function findHtmlRegions(view: EditorView): HtmlRegion[] {
  const regions: HtmlRegion[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    enter(node) {
      // 检查是否是 HTML 块或标签
      const nodeName = node.name;
      if (nodeName === 'HTMLBlock' || nodeName === 'HTMLTag') {
        const text = view.state.doc.sliceString(node.from, node.to);
        // 验证是否是支持的标签
        if (isSupportedHtmlTag(text)) {
          // 提取标签内容区域（不含开闭标签）
          const innerRegion = extractInnerRegion(node.from, node.to, text);
          if (innerRegion) {
            regions.push(innerRegion);
          }
        }
      }
    }
  });

  return regions;
}

/**
 * 在指定范围内识别 HTML 区域（性能优化版本）
 *
 * Obsidian/HyperMD 语法树结构：
 * - bracket_hmd-html-begin_tag: <
 * - tag: div (标签名)
 * - attribute: style
 * - string: "text-align: center;"
 * - bracket_tag: > 或 />
 * - bracket_hmd-html-end_tag: >
 * - bracket_tag: </ (闭标签开始)
 * - tag: div (闭标签名)
 * - bracket_hmd-html-end_tag: >
 */
export function findHtmlRegionsInRange(
  view: EditorView,
  from: number,
  to: number
): HtmlRegion[] {
  const regions: HtmlRegion[] = [];
  const doc = view.state.doc;

  // 获取完整的可见范围（合并所有 visibleRanges）
  // 因为 HTML 标签可能跨越多个不连续的可见范围
  const minFrom = Math.min(...view.visibleRanges.map(r => r.from));
  const maxTo = Math.max(...view.visibleRanges.map(r => r.to));

  // 使用正则直接在文档中查找 HTML 标签
  // 这是更可靠的方法，因为语法树结构复杂
  const text = doc.sliceString(minFrom, maxTo);

  // 匹配 <tag ...>content</tag> 格式
  const htmlTagRegex = /<(div|span|details|summary|mark)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = htmlTagRegex.exec(text)) !== null) {
    const tagName = match[1];
    const attributes = match[2];
    const content = match[3];
    const fullMatchStart = minFrom + match.index;
    const openTagEnd = fullMatchStart + `<${tagName}${attributes}>`.length;
    const closeTagStart = fullMatchStart + match[0].length - `</${tagName}>`.length;

    if (content.trim()) {
      console.log('[HtmlRegionFinder] 发现 HTML 区域: <%s> (位置 %d-%d)', tagName, openTagEnd, closeTagStart);
      regions.push({
        from: openTagEnd,
        to: closeTagStart
      });
    }
  }

  return regions;
}

/**
 * 在 HTML 区域内查找公式匹配
 *
 * 将 utils.findMathMatches 的结果转换为文档绝对位置
 */
export function findMathInHtmlRegion(
  text: string,
  regionFrom: number
): MathInRegionMatch[] {
  const matches = findMathMatches(text);
  return matches.map(m => ({
    from: regionFrom + m.startIndex,
    to: regionFrom + m.endIndex,
    content: m.content,
    isBlock: m.type === 'block'
  }));
}

/**
 * 检查 HTML 文本是否是支持的标签
 */
function isSupportedHtmlTag(htmlText: string): boolean {
  // 提取开标签中的标签名
  const match = htmlText.match(/^<(\w+)/);
  if (!match) return false;
  const tagName = match[1].toLowerCase();
  return SUPPORTED_TAGS.has(tagName);
}

/**
 * 提取 HTML 标签内部内容的位置
 *
 * 输入: <div>content</div>
 * 输出: 内容区域的位置（不含 <div> 和 </div>）
 */
function extractInnerRegion(
  nodeFrom: number,
  nodeTo: number,
  htmlText: string
): HtmlRegion | null {
  // 找到开标签的结束位置
  const openTagEnd = htmlText.indexOf('>');
  if (openTagEnd === -1) return null;

  // 找到闭标签的开始位置
  const closeTagStart = htmlText.lastIndexOf('</');
  if (closeTagStart === -1 || closeTagStart <= openTagEnd) {
    // 自闭合标签或没有闭标签
    return null;
  }

  // 计算内容区域的绝对位置
  const contentFrom = nodeFrom + openTagEnd + 1;
  const contentTo = nodeFrom + closeTagStart;

  if (contentFrom >= contentTo) {
    // 空内容
    return null;
  }

  return {
    from: contentFrom,
    to: contentTo
  };
}
