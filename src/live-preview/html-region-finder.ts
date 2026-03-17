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
 */
export function findHtmlRegionsInRange(
  view: EditorView,
  from: number,
  to: number
): HtmlRegion[] {
  const regions: HtmlRegion[] = [];
  const tree = syntaxTree(view.state);

  tree.iterate({
    from,
    to,
    enter(node) {
      const nodeName = node.name;
      if (nodeName === 'HTMLBlock' || nodeName === 'HTMLTag') {
        const text = view.state.doc.sliceString(node.from, node.to);
        if (isSupportedHtmlTag(text)) {
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
