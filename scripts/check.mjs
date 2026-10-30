#!/usr/bin/env node
/**
 * 轻量自检：不启动 DSH，只检查插件清单、素材与两侧常量是否自洽。
 * 运行：node scripts/check.mjs
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderClient } from "./build-client.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

async function mustExist(rel) {
	try {
		const info = await stat(join(root, rel));
		if (!info.isFile()) problems.push(`不是文件：${rel}`);
		return info;
	} catch {
		problems.push(`缺少文件：${rel}`);
		return null;
	}
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const patch = await readFile(join(root, "cordis.patch.yml"), "utf8");
const client = await readFile(join(root, "lib/client.js"), "utf8");
const host = await readFile(join(root, "lib/index.js"), "utf8");

if (pkg.name !== "dsh-k-on-pet") problems.push(`包名应为 dsh-k-on-pet，实际 ${pkg.name}`);
if (!/^\s+- id: dsh-k-on-pet\s*$/m.test(patch)) problems.push("cordis.patch.yml 缺少 id: dsh-k-on-pet");
if (!patch.includes("name: 'dsh-k-on-pet'")) problems.push("cordis.patch.yml 缺少 name: 'dsh-k-on-pet'");
if (!pkg.dsh?.bundle?.patch) problems.push("package.json 缺少 dsh.bundle.patch");
if (!pkg.dsh?.client?.platform) problems.push("package.json 缺少 dsh.client.platform");
if (!pkg.dsh?.compatibility?.dshReleases) problems.push("package.json 缺少 dsh.compatibility.dshReleases");
if (!pkg.icon) problems.push("package.json 缺少 icon");
if (!pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-ui-layout")) problems.push("dsh.client.inject 缺少 ui-layout");
if (!Array.isArray(pkg.files) || !pkg.files.includes("src")) problems.push("package.json files 缺少 src（发布包需要源码）");

const expectedClient = await renderClient();
if (client !== expectedClient) problems.push("lib/client.js 与 src/ 不同步，请运行 npm run build");

for (const rel of [
	"assets/icon.png",
	"assets/table/desk00.png",
	"assets/table/desk01.png",
	"assets/table/mio.png",
	"assets/table/ritsu.png",
	"assets/table/yui.png",
	"assets/table/tsumugi.png",
	"assets/table/azusa.png",
	"src/core.cjs",
	"src/client.js",
	"test/core.test.mjs",
	"lib/index.js",
	"lib/client.js",
	"cordis.patch.yml",
	"README.md",
	"LICENSE",
	"THIRD_PARTY_NOTICES.md",
	...Object.values(pkg.exports).map((entry) => entry.default).filter(Boolean).map((p) => p.replace(/^\.\//, "")),
]) {
	await mustExist(rel);
}

const iconInfo = await mustExist("assets/icon.png");
if (iconInfo && iconInfo.size > 256 * 1024) problems.push(`assets/icon.png 超过 256KiB（${iconInfo.size} 字节）`);

const hostPrefix = host.match(/const PREFIX = "([^"]+)"/)?.[1];
const clientBase = client.match(/const ASSET_BASE = "([^"]+)"/)?.[1];
if (!hostPrefix || !clientBase || hostPrefix !== clientBase) {
	problems.push(`素材路径不一致：host=${hostPrefix} client=${clientBase}`);
}

const REQUIRED_ACTIONS = ["idle", "walkLeft", "walkRight", "click", "dance", "sleep", "held"];
const charDir = join(root, "assets/characters");
const roster = ["yui", "mio", "ritsu", "tsumugi", "azusa"];
for (const id of roster) {
	const sheetInfo = await mustExist(`assets/characters/${id}/sheet.png`);
	if (!sheetInfo) continue;
	let meta;
	try {
		meta = JSON.parse(await readFile(join(charDir, id, "meta.json"), "utf8"));
	} catch (error) {
		problems.push(`${id}: meta.json 读取失败：${error.message}`);
		continue;
	}
	const { columns, rows, cell } = meta.sheet;
	if (cell !== 96) problems.push(`${id}: cell 应为 96`);
	if (!Number.isInteger(columns) || !Number.isInteger(rows)) problems.push(`${id}: sheet 行列数异常`);
	const total = columns * rows;
	if (meta.cells.length !== total) problems.push(`${id}: cells 数量 ${meta.cells.length} != ${total}`);
	const valid = new Set(meta.cells.filter((c) => c.bbox).map((c) => c.index));

	const actions = meta.actions ?? {};
	for (const key of REQUIRED_ACTIONS) {
		const value = actions[key];
		if (value === undefined) {
			problems.push(`${id}: actions 缺少 ${key}`);
			continue;
		}
		const list = Array.isArray(value) ? value : [value];
		for (const row of list) {
			if (!Number.isInteger(row) || row < 0 || row >= rows) problems.push(`${id}: actions.${key} 行号越界 ${row}`);
			else if (!meta.cells.some((c) => Math.floor(c.index / columns) === row && valid.has(c.index))) {
				problems.push(`${id}: actions.${key} 指向的行 ${row} 没有有效帧`);
			}
		}
	}

	for (const [clip, frames] of Object.entries(meta.clips ?? {})) {
		if (!Array.isArray(frames) || frames.length === 0) problems.push(`${id}: clip ${clip} 为空`);
		for (const frame of frames) {
			if (!Number.isInteger(frame) || frame < 0 || frame >= total) problems.push(`${id}: clip ${clip} 帧越界 ${frame}`);
			else if (!valid.has(frame)) problems.push(`${id}: clip ${clip} 使用了空帧 ${frame}`);
		}
	}

	if (!Array.isArray(meta.voices) || meta.voices.length === 0) problems.push(`${id}: voices 为空`);
	for (const voice of meta.voices ?? []) {
		await mustExist(`assets/characters/${id}/voices/${voice}`);
	}
	notes.push(`${id}: ${meta.name} ${columns}×${rows} · 待机 row${actions.idle} · ${meta.voices.length} 条语音`);
}

if (problems.length) {
	console.error("✗ dsh-k-on-pet 自检失败：");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log("✓ dsh-k-on-pet 自检通过");
for (const note of notes) console.log(`  ${note}`);
