import { readFileSync, writeFileSync } from "fs";

/**
 * 版本升级脚本
 * 用法: node version-bump.mjs [patch|minor|major]
 *   patch: 修复 bug (0.1.0 -> 0.1.1)
 *   minor: 新功能 (0.1.0 -> 0.2.0)
 *   major: 重大变更 (0.1.0 -> 1.0.0)
 */

const bumpType = process.argv[2] || "patch";

if (!["patch", "minor", "major"].includes(bumpType)) {
	console.error(`错误: 无效的版本类型 "${bumpType}"`);
	console.error("用法: node version-bump.mjs [patch|minor|major]");
	process.exit(1);
}

// 读取当前版本
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const currentVersion = pkg.version;
const versionParts = currentVersion.split(".").map(Number);

if (versionParts.length !== 3 || versionParts.some(isNaN)) {
	console.error(`错误: 无效的版本号格式 "${currentVersion}"`);
	process.exit(1);
}

let [major, minor, patch] = versionParts;

// 根据类型升级版本
switch (bumpType) {
	case "major":
		major++;
		minor = 0;
		patch = 0;
		break;
	case "minor":
		minor++;
		patch = 0;
		break;
	case "patch":
		patch++;
		break;
}

const newVersion = `${major}.${minor}.${patch}`;

console.log(`版本升级: ${currentVersion} -> ${newVersion} (${bumpType})`);

// 更新 package.json
pkg.version = newVersion;
writeFileSync("package.json", JSON.stringify(pkg, null, "\t"));
console.log("✅ 已更新 package.json");

// 更新 manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = newVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
console.log("✅ 已更新 manifest.json");

// 更新 versions.json
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (!Object.prototype.hasOwnProperty.call(versions, newVersion)) {
	versions[newVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
	console.log("✅ 已更新 versions.json");
} else {
	console.log("ℹ️  versions.json 中已存在该版本");
}

console.log(`\n🎉 版本已升级到 ${newVersion}`);
