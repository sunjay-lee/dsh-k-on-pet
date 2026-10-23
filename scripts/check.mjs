#!/usr/bin/env node
/**
 * 轻量自检：不启动 DSH，只检查插件清单、素材与两侧常量是否自洽。
 * 运行：node scripts/check.mjs
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

for (const rel of [
	"lib/index.js",
	"lib/client.js",
	"cordis.patch.yml",
	...Object.values(pkg.exports).map((entry) => entry.default).filter(Boolean).map((p) => p.replace(/^\.\//, "")),
]) {
	await mustExist(rel);
}

const hostPrefix = host.match(/const PREFIX = "([^"]+)"/)?.[1];
const clientBase = client.match(/const ASSET_BASE = "([^"]+)"/)?.[1];
if (!hostPrefix || !clientBase || hostPrefix !== clientBase) {
	problems.push(`素材路径不一致：host=${hostPrefix} client=${clientBase}`);
}

const charDir = join(root, "assets/characters");
const roster = ["yui", "mio", "ritsu", "tsumugi", "azusa"];
for (const id of roster) {
	const metaPath = join(charDir, id, "meta.json");
	const sheetPath = join(charDir, id, "sheet.png");
	const sheetInfo = await mustExist(`assets/characters/${id}/sheet.png`);
	if (!sheetInfo) continue;
	let meta;
	try {
		meta = JSON.parse(await readFile(metaPath, "utf8"));
	} catch (error) {
		problems.push(`${id}: meta.json 读取失败：${error.message}`);
		continue;
	}
	const { columns, rows, cell } = meta.sheet;
	if (cell !== 96) problems.push(`${id}: cell 应为 96`);
	const cells = new Set(meta.cells.filter((c) => c.bbox).map((c) => c.index));
	if (meta.cells.length !== columns * rows) problems.push(`${id}: cells 数量 ${meta.cells.length} != ${columns * rows}`);
	for (const [clip, frames] of Object.entries(meta.clips ?? {})) {
		if (!Array.isArray(frames) || frames.length === 0) problems.push(`${id}: clip ${clip} 为空`);
		for (const frame of frames) {
			if (!Number.isInteger(frame) || frame < 0 || frame >= columns * rows) problems.push(`${id}: clip ${clip} 帧越界 ${frame}`);
			else if (!cells.has(frame)) problems.push(`${id}: clip ${clip} 使用了空帧 ${frame}`);
		}
	}
	for (const required of ["idle", "react", "sleep", "held"]) {
		if (!meta.clips?.[required]?.length) problems.push(`${id}: 缺少 clip ${required}`);
	}
	if (!Array.isArray(meta.voices) || meta.voices.length === 0) problems.push(`${id}: voices 为空`);
	for (const voice of meta.voices ?? []) {
		await mustExist(`assets/characters/${id}/voices/${voice}`);
	}
	notes.push(`${id}: ${meta.name} ${columns}x${rows} · idle ${meta.clips.idle.length} 帧 · ${meta.voices.length} 条语音`);
}

if (problems.length) {
	console.error("✗ dsh-k-on-pet 自检失败：");
	for (const problem of problems) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log("✓ dsh-k-on-pet 自检通过");
for (const note of notes) console.log(`  ${note}`);
