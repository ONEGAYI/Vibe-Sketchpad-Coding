/**
 * Live Preview 模块入口
 *
 * 导出 CodeMirror 扩展，用于在实时预览模式下渲染 HTML 标签内的公式
 */

import { htmlMathPlugin } from './html-math-plugin';

/**
 * 实时预览扩展集合
 *
 * 在 main.ts 中通过 this.registerEditorExtension(livePreviewExtensions) 注册
 */
export const livePreviewExtensions = [
  htmlMathPlugin,
];

// 导出类型和工具函数（供外部使用或测试）
export { MathWidget } from './math-widget';
export {
  findHtmlRegions,
  findHtmlRegionsInRange,
  findMathInHtmlRegion
} from './html-region-finder';
export type { HtmlRegion, MathInRegionMatch } from './html-region-finder';
