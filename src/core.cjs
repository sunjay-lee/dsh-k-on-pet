/**
 * dsh-k-on-pet — 纯逻辑核心。
 *
 * 这个文件不依赖 DOM、React 或 localStorage，既会被 scripts/build-client.mjs
 * 内联进浏览器端 lib/client.js，也可以被 Node 测试直接 require。
 */
(function (root, factory) {
	const api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	if (root) root.KonPetCore = api;
})(typeof globalThis !== "undefined" ? globalThis : null, function () {
	"use strict";

	const CELL = 96;
	const STORE_KEY = "dsh-k-on-pet:v2";
	const LEGACY_KEY = "dsh-k-on-pet:v1";
	const SETTINGS_VERSION = 2;
	const SLEEP_AFTER = 4 * 60 * 1000;
	const CARE_EVERY = 50 * 60 * 1000;
	const TALK_EVERY = [2.5 * 60 * 1000, 5 * 60 * 1000];
	const GRAVITY = 1900;

	const ROSTER = [
		{ id: "yui", name: "平泽唯", accent: "#f39ab0", columns: 6, rows: 7, voices: 28 },
		{ id: "mio", name: "秋山澪", accent: "#6d8fb5", columns: 6, rows: 6, voices: 27 },
		{ id: "ritsu", name: "田井中律", accent: "#e0a63f", columns: 6, rows: 6, voices: 30 },
		{ id: "tsumugi", name: "琴吹䌷", accent: "#b58ccb", columns: 7, rows: 6, voices: 27 },
		{ id: "azusa", name: "中野梓", accent: "#dd7b5d", columns: 7, rows: 6, voices: 25 },
	];

	const LINES = {
		yui: [
			"诶嘿嘿～今天也一起练习吧！",
			"肚子饿了……有吃的吗？",
			"吉他，最喜欢了！",
			"要不要来开茶会？",
			"唯，参上！",
			"再弹一首就休息～",
			"啊，忘记写作业了！",
		],
		mio: [
			"请、请不要一直盯着我看……",
			"歌词还差一点点就写完了。",
			"要好好练习才行呢。",
			"吉他……我会认真弹的。",
			"今天的茶点是什么？",
			"别、别突然碰我啦！",
			"大家都在的话，就没问题。",
		],
		ritsu: [
			"部长大人驾到！",
			"来开茶会吧～",
			"唯，练习时间到了哦！",
			"嘿嘿，今天也活力满满！",
			"要不要一起玩？",
			"律，随时待命！",
			"啊哈哈，又忘记带乐谱了。",
		],
		tsumugi: [
			"我带了蛋糕来哦～",
			"大家要好好相处呀。",
			"练习累了就休息一下吧。",
			"呵呵，好开心。",
			"红茶已经泡好啦。",
			"要再来一块吗？",
			"像做梦一样呢。",
		],
		azusa: [
			"前辈们，请认真练习！",
			"不要总是开茶会啦……",
			"我也要努力追上大家。",
			"吉他，再练一遍吧。",
			"真是拿前辈们没办法。",
			"轻音部，最好了！",
			"这次一定要合奏成功！",
		],
	};

	const CARE_LINES = [
		"已经坐了很久啦，起来活动一下吧～",
		"喝口水，看看远处，休息一下眼睛。",
		"要不要休息五分钟？",
		"肩膀放松一下，深呼吸～",
	];

	const CLIP_FPS = {
		idle: 5,
		idleAlt: 5,
		extra: 5,
		sleep: 2,
		react: 8,
		held: 10,
	};

	const rand = (n) => Math.floor(Math.random() * n);
	const pick = (list) => list[rand(list.length)];
	const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

	function createDefaultSettings() {
		return {
			version: SETTINGS_VERSION,
			visible: { yui: true, mio: false, ritsu: false, tsumugi: false, azusa: false },
			scale: 1.5,
			muted: false,
			chatter: true,
			care: true,
			positions: {},
		};
	}

	function normalizeSettings(raw) {
		const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
		const visible = {};
		const hasVisible = source.visible && typeof source.visible === "object" && !Array.isArray(source.visible);
		for (const member of ROSTER) {
			if (hasVisible) visible[member.id] = Boolean(source.visible[member.id]);
			else visible[member.id] = source.character === member.id;
		}
		if (!hasVisible && !ROSTER.some((member) => member.id === source.character)) visible.yui = true;

		const positions = {};
		if (source.positions && typeof source.positions === "object" && !Array.isArray(source.positions)) {
			for (const member of ROSTER) {
				const position = source.positions[member.id];
				if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
					positions[member.id] = { x: Number(position.x), y: Number(position.y) };
				}
			}
		} else if (Number.isFinite(source.x) && Number.isFinite(source.y)) {
			const id = ROSTER.some((member) => member.id === source.character) ? source.character : "yui";
			positions[id] = { x: Number(source.x), y: Number(source.y) };
		}

		return {
			version: SETTINGS_VERSION,
			visible,
			scale: clamp(Number(source.scale) || 1.5, 1, 2.4),
			muted: Boolean(source.muted),
			chatter: source.chatter !== false,
			care: source.care !== false,
			positions,
		};
	}

	function boundsFor(viewportWidth, viewportHeight, size) {
		return {
			maxX: Math.max(2, viewportWidth - size - 4),
			maxY: Math.max(2, viewportHeight - size - 4),
		};
	}

	function defaultPosition(size, index, count, viewportWidth, viewportHeight) {
		const limit = boundsFor(viewportWidth, viewportHeight, size);
		if (count <= 1) return { x: limit.maxX, y: limit.maxY };
		const gap = 8;
		const span = Math.max(1, Math.min(size + gap, (viewportWidth - 16 - size) / Math.max(1, count - 1)));
		const total = size + span * (count - 1);
		const start = Math.max(4, viewportWidth - 12 - total);
		return {
			x: clamp(start + span * index, 2, limit.maxX),
			y: limit.maxY,
		};
	}

	/**
	 * 推进抛物线一步。返回新状态；landed 只在这一次落地判定中为 true，
	 * 调用方据此切换回 idle 并保存位置。
	 */
	function stepThrow(body, dt, limit) {
		let { x, y, vx, vy } = body;
		vy += GRAVITY * dt;
		x += vx * dt;
		y += vy * dt;
		if (x < 2) {
			x = 2;
			vx = Math.abs(vx) * 0.55;
		}
		if (x > limit.maxX) {
			x = limit.maxX;
			vx = -Math.abs(vx) * 0.55;
		}
		if (y < 2) {
			y = 2;
			vy = Math.abs(vy) * 0.4;
		}
		let landed = false;
		if (y > limit.maxY) {
			y = limit.maxY;
			vy = -vy * 0.42;
			vx *= 0.8;
			if (Math.abs(vy) < 130) {
				vy = 0;
				vx *= 0.72;
				if (Math.abs(vx) < 26) {
					vx = 0;
					landed = true;
				}
			}
		}
		return { x, y, vx, vy, landed };
	}

	function advanceFrame(state, dt, fps, frameCount) {
		if (!Number.isFinite(fps) || fps <= 0 || frameCount <= 0) {
			return { frame: state.frame || 0, acc: state.acc || 0 };
		}
		let frame = state.frame || 0;
		let acc = (state.acc || 0) + dt;
		const frameTime = 1 / fps;
		while (acc >= frameTime) {
			acc -= frameTime;
			frame += 1;
			if (frame >= frameCount) frame = 0;
		}
		return { frame, acc };
	}

	function frameRect(index, columns) {
		return {
			sx: (index % columns) * CELL,
			sy: Math.floor(index / columns) * CELL,
			size: CELL,
		};
	}

	function exportSettings(settings) {
		return JSON.stringify(normalizeSettings(settings), null, 2) + "\n";
	}

	function importSettings(text) {
		if (typeof text !== "string" || text.trim() === "") {
			throw new Error("设置文件是空的");
		}
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new Error("不是有效的 JSON");
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("设置文件必须是 JSON 对象");
		}
		return normalizeSettings(parsed);
	}

	return {
		CELL,
		STORE_KEY,
		LEGACY_KEY,
		SETTINGS_VERSION,
		SLEEP_AFTER,
		CARE_EVERY,
		TALK_EVERY,
		GRAVITY,
		ROSTER,
		LINES,
		CARE_LINES,
		CLIP_FPS,
		rand,
		pick,
		clamp,
		createDefaultSettings,
		normalizeSettings,
		boundsFor,
		defaultPosition,
		stepThrow,
		advanceFrame,
		frameRect,
		exportSettings,
		importSettings,
	};
});
