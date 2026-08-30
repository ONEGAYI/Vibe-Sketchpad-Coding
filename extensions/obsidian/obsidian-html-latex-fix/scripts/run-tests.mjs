/**
 * 测试运行器：esbuild 捆绑 src 下所有 *.test.ts 到 temp/tests，再用 node:test 执行
 */
import { build } from 'esbuild';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const OUT = fileURLToPath(new URL('../temp/tests', import.meta.url));

function collectTestFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, name.name);
		if (name.isDirectory()) out.push(...collectTestFiles(full));
		else if (name.name.endsWith('.test.ts')) out.push(full);
	}
	return out;
}

const entryPoints = collectTestFiles(SRC);
if (entryPoints.length === 0) {
	console.error('未找到测试文件（src/**/*.test.ts）');
	process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
	entryPoints,
	outdir: OUT,
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node20',
	sourcemap: false,
	logLevel: 'warning',
});

const testFiles = readdirSync(OUT).filter(f => f.endsWith('.test.js')).map(f => join(OUT, f));
const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status ?? 1);
