import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const Core = require("../src/core.cjs");

test("defaults show only Yui and use v2", () => {
	const settings = Core.createDefaultSettings();
	assert.equal(settings.version, 2);
	assert.equal(settings.scale, 1.5);
	assert.deepEqual(settings.visible, { yui: true, mio: false, ritsu: false, tsumugi: false, azusa: false });
	assert.deepEqual(settings.positions, {});
	assert.equal(settings.table, true);
	assert.equal(settings.tablePos, null);
	assert.deepEqual(settings.seats, {});
});

test("migrates v1 character + x/y to v2 visible and positions", () => {
	const settings = Core.normalizeSettings({ character: "mio", x: 100, y: 200, scale: 2 });
	assert.equal(settings.version, 2);
	assert.equal(settings.visible.mio, true);
	assert.equal(settings.visible.yui, false);
	assert.deepEqual(settings.positions.mio, { x: 100, y: 200 });
	assert.equal(settings.scale, 2);
});

test("keeps explicit visibility, including all hidden", () => {
	const settings = Core.normalizeSettings({ visible: { mio: true } });
	assert.equal(settings.visible.mio, true);
	assert.equal(settings.visible.yui, false);
	assert.equal(settings.visible.azusa, false);
	const hidden = Core.normalizeSettings({ visible: {} });
	assert.equal(Object.values(hidden.visible).some(Boolean), false);
});

test("drops malformed positions and clamps scale", () => {
	const settings = Core.normalizeSettings({
		visible: { yui: true },
		positions: { yui: { x: "10", y: 20 }, mio: { x: 3, y: Infinity } },
		scale: 9,
	});
	assert.deepEqual(settings.positions, {});
	assert.equal(settings.scale, 2.4);
	assert.equal(Core.normalizeSettings({ scale: 0.2 }).scale, 1);
	assert.equal(Core.normalizeSettings({ scale: "abc" }).scale, 1.5);
});

test("keeps behavior switches and their defaults", () => {
	const off = Core.normalizeSettings({ chatter: false, care: false, muted: true });
	assert.equal(off.chatter, false);
	assert.equal(off.care, false);
	assert.equal(off.muted, true);
	const defaults = Core.normalizeSettings({});
	assert.equal(defaults.chatter, true);
	assert.equal(defaults.care, true);
	assert.equal(defaults.muted, false);
	assert.equal(defaults.animSpeed, 1);
	assert.equal(Core.normalizeSettings({ animSpeed: 0.1 }).animSpeed, 0.5);
	assert.equal(Core.normalizeSettings({ animSpeed: 9 }).animSpeed, 2);
});

test("keeps table position and seats, dropping malformed values", () => {
	const settings = Core.normalizeSettings({
		table: false,
		tablePos: { x: 12, y: 34 },
		seats: { ritsu: true, yui: "yes" },
	});
	assert.equal(settings.table, false);
	assert.deepEqual(settings.tablePos, { x: 12, y: 34 });
	assert.equal(settings.seats.ritsu, true);
	assert.equal(settings.seats.yui, undefined);
	assert.deepEqual(Core.normalizeSettings({ tablePos: { x: "1", y: 2 } }).tablePos, null);
});

test("table helpers place and hit the five fixed seats", () => {
	const pos = Core.tableDefaultPosition(1, 1000, 800);
	assert.deepEqual(pos, { x: 356, y: 544 });
	assert.deepEqual(Core.clampTablePosition(-5, 9999, 1, 1000, 800), { x: 0, y: 640 });
	const yui = Core.TABLE.seats.find((seat) => seat.id === "yui");
	const rect = Core.tableSeatRect(yui, pos.x, pos.y, 1);
	assert.equal(Core.tableSeatAt(rect.x + rect.w / 2, rect.y + rect.h / 2, pos.x, pos.y, 1).id, "yui");
	assert.notEqual(Core.tableSeatAt(pos.x + 1, pos.y + 1, pos.x, pos.y, 1), null);
	assert.notEqual(Core.tableSeatAt(pos.x + Core.TABLE.width - 2, pos.y + Core.TABLE.height - 2, pos.x, pos.y, 1), null);
	assert.equal(Core.tableSeatAt(pos.x - 1, pos.y + 1, pos.x, pos.y, 1), null);
	assert.equal(Core.tableSeatAt(pos.x + 1, pos.y + Core.TABLE.height + 1, pos.x, pos.y, 1), null);
	assert.deepEqual(Core.TABLE.seats.map((seat) => seat.id), ["mio", "ritsu", "yui", "tsumugi", "azusa"]);
});

test("export/import round-trips normalized settings", () => {
	const original = Core.normalizeSettings({ visible: { ritsu: true }, scale: 1.8, positions: { ritsu: { x: 12, y: 34 } } });
	const restored = Core.importSettings(Core.exportSettings(original));
	assert.deepEqual(restored, original);
});

test("import rejects empty, non-JSON and non-object payloads", () => {
	assert.throws(() => Core.importSettings(""), /空的/);
	assert.throws(() => Core.importSettings("{"), /JSON/);
	assert.throws(() => Core.importSettings("[]"), /对象/);
	assert.throws(() => Core.importSettings("null"), /对象/);
});

test("bounds keep a minimum of 2px and default position hugs bottom-right", () => {
	assert.deepEqual(Core.boundsFor(100, 80, 96), { maxX: 2, maxY: 2 });
	const single = Core.defaultPosition(96, 0, 1, 1000, 800);
	assert.deepEqual(single, { x: 900, y: 700 });
	const group = [0, 1, 2].map((index) => Core.defaultPosition(96, index, 3, 1000, 800));
	assert.ok(group[0].x < group[1].x && group[1].x < group[2].x);
	for (const point of group) {
		assert.ok(point.x >= 2 && point.x <= 900);
		assert.equal(point.y, 700);
	}
});

test("stepThrow applies gravity and settles on the floor", () => {
	let body = { x: 10, y: 0, vx: 0, vy: 0 };
	let landed = false;
	for (let index = 0; index < 600 && !landed; index += 1) {
		const next = Core.stepThrow(body, 1 / 60, { maxX: 900, maxY: 200 });
		body = next;
		landed = next.landed;
	}
	assert.equal(landed, true);
	assert.equal(body.y, 200);
	assert.equal(body.vx, 0);
	assert.equal(body.vy, 0);
});

test("stepThrow bounces off side walls and ceiling", () => {
	const right = Core.stepThrow({ x: 900, y: 100, vx: 1000, vy: 0 }, 1 / 60, { maxX: 900, maxY: 200 });
	assert.equal(right.x, 900);
	assert.ok(right.vx < 0);
	const top = Core.stepThrow({ x: 10, y: 2, vx: 0, vy: -800 }, 1 / 60, { maxX: 900, maxY: 200 });
	assert.equal(top.y, 2);
	assert.ok(top.vy > 0);
});

test("advanceFrame advances at fps and wraps", () => {
	const advanced = Core.advanceFrame({ frame: 0, acc: 0 }, 0.26, 4, 2);
	assert.equal(advanced.frame, 1);
	assert.ok(Math.abs(advanced.acc - 0.01) < 1e-9);
	assert.deepEqual(Core.advanceFrame({ frame: 1, acc: 0 }, 0.25, 4, 2), { frame: 0, acc: 0 });
	assert.deepEqual(Core.advanceFrame({ frame: 0, acc: 0 }, 1, 0, 6), { frame: 0, acc: 0 });
});

test("frameRect maps frame indexes to sheet cells", () => {
	assert.deepEqual(Core.frameRect(0, 6), { sx: 0, sy: 0, size: 96 });
	assert.deepEqual(Core.frameRect(7, 6), { sx: 96, sy: 96, size: 96 });
	assert.deepEqual(Core.frameRect(41, 7), { sx: 576, sy: 480, size: 96 });
});

test("table hit area covers the whole table and nothing far outside", () => {
	assert.equal(Core.tableContainsPoint(150, 450, 100, 400, 1), true);
	assert.equal(Core.tableContainsPoint(100, 400, 100, 400, 1), true);
	assert.equal(Core.tableContainsPoint(99, 450, 100, 400, 1), false);
	assert.equal(Core.tableContainsPoint(150, 561, 100, 400, 1), false);
	assert.equal(Core.tableContainsPoint(99, 450, 100, 400, 1, 2), true);
});

test("table lock persists through normalize/default", () => {
	assert.equal(Core.createDefaultSettings().tableLocked, false);
	assert.equal(Core.normalizeSettings({ tableLocked: true }).tableLocked, true);
});

test("wander defaults on and can be turned off", () => {
	assert.equal(Core.createDefaultSettings().wander, true);
	assert.equal(Core.normalizeSettings({}).wander, true);
	assert.equal(Core.normalizeSettings({ wander: false }).wander, false);
});

test("returnAfter defaults to 5 minutes and clamps to 0-60", () => {
	assert.equal(Core.createDefaultSettings().returnAfter, 5);
	assert.equal(Core.normalizeSettings({}).returnAfter, 5);
	assert.equal(Core.normalizeSettings({ returnAfter: 0 }).returnAfter, 0);
	assert.equal(Core.normalizeSettings({ returnAfter: 12 }).returnAfter, 12);
	assert.equal(Core.normalizeSettings({ returnAfter: 90 }).returnAfter, 60);
});

test("speed / idle / walk / follow 有默认值且被钳制", () => {
	const d = Core.createDefaultSettings();
	assert.equal(d.speed, 96);
	assert.equal(d.idleSeconds, 4);
	assert.equal(d.walkSeconds, 3);
	assert.equal(d.follow, true);
	assert.equal(d.followChance, 80);
	assert.equal(Core.normalizeSettings({ speed: 999 }).speed, 300);
	assert.equal(Core.normalizeSettings({ speed: 10 }).speed, 30);
	assert.equal(Core.normalizeSettings({ idleSeconds: 0 }).idleSeconds, 1);
	assert.equal(Core.normalizeSettings({ walkSeconds: 99 }).walkSeconds, 60);
	assert.equal(Core.normalizeSettings({ follow: false }).follow, false);
	assert.equal(Core.normalizeSettings({ followChance: 150 }).followChance, 100);
	assert.equal(Core.normalizeSettings({ followChance: -5 }).followChance, 0);
	assert.equal(Core.normalizeSettings({ teaPartyChance: 150 }).teaPartyChance, 100);
	assert.equal(Core.normalizeSettings({}).lang, "zh");
	assert.equal(Core.normalizeSettings({ lang: "ja" }).lang, "ja");
	assert.equal(Core.normalizeSettings({ lang: "both" }).lang, "both");
	assert.equal(Core.normalizeSettings({ lang: "en" }).lang, "zh");
});

test("planWalk returns a unit direction and a positive duration", () => {
	for (let i = 0; i < 50; i += 1) {
		const plan = Core.planWalk(400, 600, { maxX: 900, maxY: 700 }, 1.5);
		assert.ok(Math.abs(Math.hypot(plan.dx, plan.dy) - 1) < 1e-9, "方向必须是单位向量");
		assert.ok(plan.distance > 0 && plan.duration > 0);
	}
});

test("stepWalk moves along the plan in any direction", () => {
	const right = { dx: 1, dy: 0, distance: 100, duration: 1000 };
	const a = Core.stepWalk({ x: 0, y: 0 }, right, 42, 1);
	assert.ok(Math.abs(a.x - 42) < 1e-9);
	assert.equal(a.y, 0);
	const down = { dx: 0, dy: 1, distance: 100, duration: 1000 };
	const b = Core.stepWalk({ x: 10, y: 10 }, down, 42, 0.5);
	assert.equal(b.x, 10);
	assert.ok(Math.abs(b.y - 31) < 1e-9);
});

test("sheetOverrides 保留 anims 的帧序列（null 空帧不丢，越界偏移当空帧）", () => {
	const sheet = {
		src: "data:image/png;base64,AAAA",
		cols: 6,
		rows: 8,
		officialRows: 7,
		anims: [
			{ name: "挥手", row: 7, rows: 1, frames: [0, 2, 3, null, null, 6] },
			{ name: "越界", row: 8, rows: 1, frames: [0, 9, -1, 2] },
		],
	};
	const clean = Core.normalizeSettings({ sheetOverrides: { yui: sheet } }).sheetOverrides.yui;
	assert.equal(clean.anims.length, 2);
	assert.equal(clean.anims[0].name, "挥手");
	assert.deepEqual(clean.anims[0].frames, [0, 2, 3, null, null, null], "空帧留 null，越界偏移当空帧");
	assert.deepEqual(clean.anims[1].frames, [0, null, null, 2]);
	assert.deepEqual(Core.normalizeSettings({ sheetOverrides: { yui: { ...sheet, src: "http://x/a.png" } } }).sheetOverrides, {});
});

test("wrapPosition 从对侧内侧出现（不会在屏幕外滑行）", () => {
	const vw = 800, vh = 600, size = 96;
	const bottom = Core.wrapPosition(10, vh + 10, size, vw, vh);
	assert.equal(bottom.y, 2, "从下面走出去应该立刻出现在上面内侧");
	const top = Core.wrapPosition(10, -size - 10, size, vw, vh);
	assert.ok(top.y > vh * 0.5, "从上面走出去应该出现在下面内侧");
	const right = Core.wrapPosition(vw + 10, 10, size, vw, vh);
	assert.equal(right.x, 2, "从右边走出去应该立刻出现在左边内侧");
	const left = Core.wrapPosition(-size - 10, 10, size, vw, vh);
	assert.equal(left.x, vw - size - 2, "从左边走出去应该出现在右边内侧");
	const inside = Core.wrapPosition(200, 200, size, vw, vh);
	assert.deepEqual(inside, { x: 200, y: 200 });
});

test("琴吹䌷的拖拽动作使用 row 1（背面被拎起），不是睡眠的 row 2", () => {
	const meta = JSON.parse(readFileSync(new URL("../assets/characters/tsumugi/meta.json", import.meta.url), "utf8"));
	assert.equal(meta.actions.held, 1);
	assert.equal(meta.actions.sleep, 2);
	assert.ok(meta.clips.held.length > 0);
	assert.notDeepEqual(meta.clips.held, meta.clips.sleep);
});
