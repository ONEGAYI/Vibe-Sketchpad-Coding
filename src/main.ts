/**
 * HTML LaTeX Fix Plugin for Obsidian
 *
 * 修复 HTML 标签内 LaTeX 公式无法渲染的问题
 *
 * Example:
 *   <div>$E=mc^2$</div>  →  <div>[渲染后的公式]</div>
 */

import { Plugin } from 'obsidian';
import { createHtmlMathProcessor } from './processor';

export default class HtmlMathFixPlugin extends Plugin {
	private processor: ReturnType<typeof createHtmlMathProcessor> | null = null;

	async onload() {
		console.log('HtmlMathFix: Loading plugin');

		// 创建并注册 PostProcessor
		this.processor = createHtmlMathProcessor();
		this.registerMarkdownPostProcessor(this.processor);

		console.log('HtmlMathFix: Plugin loaded successfully');
	}

	onunload() {
		console.log('HtmlMathFix: Unloading plugin');
		this.processor = null;
	}
}
