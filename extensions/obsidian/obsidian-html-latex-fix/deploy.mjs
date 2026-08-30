/**
 * 部署脚本：将编译后的插件复制到 Obsidian 插件目录
 * 用法: node deploy.mjs
 */

import { cp, mkdir, access } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 从环境变量或配置文件读取目标路径
let targetDir = process.env.OBSIDIAN_PLUGIN_DIR;

if (!targetDir) {
	// 尝试读取本地配置文件
	try {
		const { default: config } = await import('./deploy.config.local.mjs');
		targetDir = config.pluginDir;
	} catch {
		console.error('❌ 未配置部署目标路径');
		console.error('');
		console.error('请创建 deploy.config.local.mjs 文件:');
		console.error('  export default { pluginDir: "D:/path/to/.obsidian/plugins/html-latex-fix" }');
		console.error('');
		console.error('或设置环境变量:');
		console.error('  OBSIDIAN_PLUGIN_DIR=D:/path/to/.obsidian/plugins/html-latex-fix node deploy.mjs');
		process.exit(1);
	}
}

const pluginName = 'html-latex-fix';
const fullTargetDir = resolve(targetDir, pluginName);

async function deploy() {
	console.log('🚀 开始部署...');
	console.log(`   目标目录: ${fullTargetDir}`);

	// 确保目标目录存在
	await mkdir(fullTargetDir, { recursive: true });

	// 复制文件
	const files = ['main.js', 'manifest.json'];

	for (const file of files) {
		const src = resolve(__dirname, file);
		const dest = resolve(fullTargetDir, file);

		try {
			await access(src);
			await cp(src, dest);
			console.log(`   ✅ ${file}`);
		} catch (err) {
			console.error(`   ❌ ${file}: ${(err).message}`);
		}
	}

	console.log('');
	console.log('✨ 部署完成！请在 Obsidian 中重新加载插件。');
}

deploy().catch(console.error);
