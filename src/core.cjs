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
	// 溜达：待机很短，大部分时间在走。
	const WALK_SPEED = 96; // 每秒位移（1× 缩放下的像素）
	const WALK_EVERY = [2500, 6500]; // 两次溜达之间的间隔（毫秒）
	const WALK_DISTANCE = [160, 560]; // 单次溜达的距离（1× 缩放下的像素）

	// 桌面摆件：desk00(中间三把椅子) + desk01(两侧椅子) 叠成五个固定座位。
	// 坐标来自 MascotTable_d/main.sd 的对象表（x 为 288×160 场景内的左坐标）。
	const TABLE = {
		width: 288,
		height: 160,
		charWidth: 64,
		charHeight: 128,
		charTop: 16,
		widths: { yui: 64, mio: 64, ritsu: 80, tsumugi: 64, azusa: 64 },
		frames: 4,
		fps: 4,
		seats: [
			{ id: "mio", x: 0, mirror: false },
			{ id: "ritsu", x: 64, mirror: false },
			{ id: "yui", x: 112, mirror: false },
			{ id: "tsumugi", x: 176, mirror: false },
			{ id: "azusa", x: 224, mirror: false },
		],
	};

	const ROSTER = [
		{ id: "yui", name: "平泽唯", accent: "#f39ab0", columns: 6, rows: 7, voices: 28 },
		{ id: "mio", name: "秋山澪", accent: "#6d8fb5", columns: 6, rows: 6, voices: 27 },
		{ id: "ritsu", name: "田井中律", accent: "#e0a63f", columns: 6, rows: 6, voices: 30 },
		{ id: "tsumugi", name: "琴吹䌷", accent: "#b58ccb", columns: 6, rows: 6, voices: 27 },
		{ id: "azusa", name: "中野梓", accent: "#dd7b5d", columns: 6, rows: 6, voices: 25 },
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
		mio: [
			{ ja: "リツ、待って！", zh: "律，等等！" },
			{ ja: "リツ、どこ行くの！", zh: "律，你要去哪！" },
			{ ja: "もう、待ちなさいよ！", zh: "真是的，给我站住！" },
		],
		azusa: [
			{ ja: "唯先輩、待ってください！", zh: "唯前辈，请等一下！" },
			{ ja: "唯先輩、置いていかないで！", zh: "唯前辈，别丢下我！" },
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

	// 每个角色的"节奏"：待机/行走时长会乘以这个系数，避免五个人同步行动。
	// 唯有点慢、律很急、䌷最悠闲。
	// 跟随触发时追逐者的台词（日文/中文双语，按设置切换）
	const FOLLOW_LINES = {
		ritsu: [
			{ ja: "澪ー！待ってよー！", zh: "澪——！等等我呀——！" },
			{ ja: "澪、置いてかないでよ！", zh: "澪，别丢下我呀！" },
			{ ja: "捕まえた、澪！", zh: "抓到你了，澪！" },
		],
		yui: [
			{ ja: "あずにゃーん！", zh: "梓喵——！" },
			{ ja: "あずにゃん、待ってー！", zh: "梓喵，等等我——！" },
			{ ja: "あずにゃんと遊びたいなー", zh: "好想和梓喵玩呀～" },
		],
		tsumugi: [
			{ ja: "私も行きますわ～", zh: "我也要去～" },
			{ ja: "みなさん、待ってくださいな～", zh: "大家，请等等我呀～" },
		],
	};

	const TEMPO = { yui: 1.25, mio: 0.9, ritsu: 0.7, tsumugi: 1.45, azusa: 1.05 };

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
			wander: true,
			facingFlipped: false,
			resetAt: 0,
			positions: {},
			table: true,
			tableLocked: false,
			tablePos: null,
			seats: {},
			// 茶桌开着时，角色在外溜达多久之后自动回到座位（分钟；0 = 不回位）
			returnAfter: 5,
			// 移动速度（1× 缩放下的 px/s）与节奏
			speed: 96,
			idleSeconds: 4, // 两次走动之间的待机时长（秒）
			walkSeconds: 3, // 单次走动的时长（秒）
			// 随机跟随：律跟澪、唯跟梓；䌷在大家都待久了时跟其中一队
			follow: true,
			followChance: 80, // 跟随概率（百分比）
			teaPartyChance: 100, // 听到"带了蛋糕"时开茶会的概率（百分比）
			// 台词语言：zh 中文 / ja 日文 / both 双语
			lang: "zh",
			// 开发者模式：动作行号覆盖（按角色覆盖 meta.actions，不写回文件）
			devMode: false,
			actionOverrides: {},
			// 开发者模式导入的图集（dataURL + 行列数），仅本地生效
			sheetOverrides: {},
			// 是否启用开发者模式里的自定义图集/动作（关掉就只用官方素材）
			throwEnabled: true, // 是否允许把角色甩出去
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

		const table = source.table !== false;
		const tableLocked = source.tableLocked === true;
		const tablePos = source.tablePos && Number.isFinite(source.tablePos.x) && Number.isFinite(source.tablePos.y)
			? { x: Number(source.tablePos.x), y: Number(source.tablePos.y) }
			: null;
		const seats = {};
		if (source.seats && typeof source.seats === "object" && !Array.isArray(source.seats)) {
			for (const member of ROSTER) {
				if (source.seats[member.id] === true) seats[member.id] = true;
			}
		}

		return {
			version: SETTINGS_VERSION,
			visible,
			scale: clamp(Number(source.scale) || 1.5, 1, 2.4),
			muted: Boolean(source.muted),
			chatter: source.chatter !== false,
			care: source.care !== false,
			wander: source.wander !== false,
			facingFlipped: source.facingFlipped === true,
			resetAt: Number.isFinite(source.resetAt) ? Number(source.resetAt) : 0,
			positions,
			table,
			tableLocked,
			tablePos,
			seats,
			returnAfter: Number.isFinite(Number(source.returnAfter)) ? clamp(Number(source.returnAfter), 0, 60) : 5,
			speed: Number.isFinite(Number(source.speed)) ? clamp(Number(source.speed), 30, 300) : 96,
			idleSeconds: Number.isFinite(Number(source.idleSeconds)) ? clamp(Number(source.idleSeconds), 1, 120) : 4,
			walkSeconds: Number.isFinite(Number(source.walkSeconds)) ? clamp(Number(source.walkSeconds), 1, 60) : 3,
			follow: source.follow !== false,
			followChance: Number.isFinite(Number(source.followChance)) ? clamp(Number(source.followChance), 0, 100) : 80,
			teaPartyChance: Number.isFinite(Number(source.teaPartyChance)) ? clamp(Number(source.teaPartyChance), 0, 100) : 100,
			lang: ["zh", "ja", "both"].includes(source.lang) ? source.lang : "zh",
			devMode: source.devMode === true,
			actionOverrides: sanitizeOverrides(source.actionOverrides),
			sheetOverrides: sanitizeSheets(source.sheetOverrides),
			throwEnabled: source.throwEnabled !== false,
		};
	}

	function tableDefaultPosition(scale, viewportWidth, viewportHeight) {
		const width = TABLE.width * scale;
		const height = TABLE.height * scale;
		return {
			x: Math.max(0, Math.round((viewportWidth - width) / 2)),
			// Keep the table clear of the chat composer at the bottom of the DSH shell.
			y: Math.max(0, Math.round(viewportHeight - height - 96)),
		};
	}

	function clampTablePosition(x, y, scale, viewportWidth, viewportHeight) {
		const width = TABLE.width * scale;
		const height = TABLE.height * scale;
		return {
			x: Math.round(clamp(Number(x) || 0, 0, Math.max(0, viewportWidth - width))),
			y: Math.round(clamp(Number(y) || 0, 0, Math.max(0, viewportHeight - height))),
		};
	}

	function tableContainsPoint(px, py, tableX, tableY, scale, margin = 0) {
		const pad = Math.max(0, Number(margin) || 0);
		return px >= tableX - pad && px <= tableX + TABLE.width * scale + pad &&
			py >= tableY - pad && py <= tableY + TABLE.height * scale + pad;
	}

	function tableSeatRect(seat, tableX, tableY, scale) {
		return {
			x: tableX + seat.x * scale,
			y: tableY + TABLE.charTop * scale,
			w: (TABLE.widths[seat.id] || TABLE.charWidth) * scale,
			h: TABLE.charHeight * scale,
		};
	}

	// 整张茶桌都是投喂区：落点只要在桌子里，就交给离落点最近的空位。
	function tableSeatAt(x, y, tableX, tableY, scale) {
		const width = TABLE.width * scale;
		const height = TABLE.height * scale;
		if (x < tableX || x > tableX + width || y < tableY || y > tableY + height) return null;
		let best = null;
		let bestDistance = Infinity;
		for (const seat of TABLE.seats) {
			const rect = tableSeatRect(seat, tableX, tableY, scale);
			const distance = Math.hypot(x - (rect.x + rect.w / 2), y - (rect.y + rect.h / 2));
			if (distance < bestDistance) {
				best = seat;
				bestDistance = distance;
			}
		}
		return best;
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

	/**
	 * 规划一次溜达：任意方位走一段随机距离（原版可以朝任意方向走）。
	 * 返回单位方向、距离与时长；调用方按方向选左右步态。
	 */
	function planWalk(x, y, limit, scale = 1) {
		const factor = Math.max(0.5, Number(scale) || 1);
		const min = WALK_DISTANCE[0] * factor;
		const max = WALK_DISTANCE[1] * factor;
		const angle = Math.random() * Math.PI * 2;
		const dx = Math.cos(angle);
		const dy = Math.sin(angle);
		const distance = min + Math.random() * (max - min);
		return {
			dx,
			dy,
			distance,
			duration: (distance / (WALK_SPEED * factor)) * 1000,
		};
	}

	/**
	 * 规划一次"朝目标走"：给起止坐标，返回单位方向与距离。
	 * 用于随机跟随（律跟澪、唯跟梓、䌷跟某一队）。
	 */
	function planWalkTo(fromX, fromY, toX, toY) {
		const dx = (Number(toX) || 0) - (Number(fromX) || 0);
		const dy = (Number(toY) || 0) - (Number(fromY) || 0);
		const distance = Math.hypot(dx, dy);
		if (distance < 1) return null;
		return { dx: dx / distance, dy: dy / distance, distance };
	}

	/**
	 * 推进溜达一步：沿计划方向匀速前进（不夹边界，出界交给 wrapPosition 处理）。
	 */
	function stepWalk(pos, plan, speed, dt) {
		const step = Math.max(0, (Number(speed) || 0) * Math.max(0, Number(dt) || 0));
		return {
			x: (Number(pos.x) || 0) + plan.dx * step,
			y: (Number(pos.y) || 0) + plan.dy * step,
		};
	}

	/**
	 * 出界回绕：往下走没了就从上面下来，左右同理（原版的行为）。
	 * size 是角色边长，viewport 是可视区尺寸。
	 */
	/** 图集覆盖：只接受 data:image/... 的字符串与 1-12 的行列数。 */
	function sanitizeSheets(raw) {
		const out = {};
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
		for (const [charId, value] of Object.entries(raw)) {
			if (!value || typeof value !== "object") continue;
			if (typeof value.src !== "string" || !/^data:image\//.test(value.src)) continue;
			const cols = Math.round(Number(value.cols));
			const rows = Math.round(Number(value.rows));
			if (!(cols >= 1 && cols <= 60 && rows >= 1 && rows <= 60)) continue;
			const name = typeof value.name === "string" ? value.name.slice(0, 40) : "";
			out[charId] = {
				src: value.src,
				cols,
				rows,
				officialRows: Number.isFinite(Number(value.officialRows)) ? Math.max(0, Math.min(rows, Math.round(Number(value.officialRows)))) : rows,
				frames: Number.isFinite(Number(value.frames)) ? Math.max(0, Math.min(3600, Math.round(Number(value.frames)))) : 0,
				kind: typeof value.kind === "string" ? value.kind.slice(0, 20) : "",
				name: typeof value.name === "string" ? value.name.slice(0, 40) : "",
				anims: Array.isArray(value.anims)
					? value.anims.slice(0, 60).map((anim) => ({
						name: typeof anim.name === "string" ? anim.name.slice(0, 40) : "动作",
						row: Number.isInteger(anim.row) ? anim.row : 0,
						rows: Number.isInteger(anim.rows) ? anim.rows : 1,
						frames: Array.isArray(anim.frames) ? anim.frames.filter((n) => Number.isInteger(n)).slice(0, 60) : [],
					}))
					: [],
				order: Array.isArray(value.order)
					? value.order.slice(0, 12).map((row) => (Array.isArray(row) ? row.filter((n) => Number.isInteger(n) && n >= 0 && n < 3600).slice(0, 60) : []))
					: [],
			};
		}
		return out;
	}

	/** 只保留形如 { charId: { state: 行号 | 行号数组 } } 的合法覆盖值。 */
	function sanitizeOverrides(raw) {
		const out = {};
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
		for (const [charId, table] of Object.entries(raw)) {
			if (!table || typeof table !== "object" || Array.isArray(table)) continue;
			const clean = {};
			for (const [state, value] of Object.entries(table)) {
				const ok = (n) => Number.isInteger(n) && n >= 0 && n < 64;
				if (Array.isArray(value) && value.length && value.every(ok)) clean[state] = value.slice();
				else if (ok(value)) clean[state] = value;
			}
			if (Object.keys(clean).length) out[charId] = clean;
		}
		return out;
	}

	function wrapPosition(x, y, size, viewportWidth, viewportHeight) {
		const spanX = Math.max(1, viewportWidth) + size;
		const spanY = Math.max(1, viewportHeight) + size;
		const wrap = (value, span) => ((((value + size) % span) + span) % span) - size;
		// 被边界"吞掉"的瞬间就从对侧内侧出现：否则会在屏幕外滑一段才露面
		const crossX = (value, limit) => {
			if (value >= limit) return 2;
			if (value <= -size) return Math.max(2, limit - size - 2);
			return wrap(value, spanX);
		};
		const crossY = (value, limit) => {
			if (value >= limit) return 2;
			if (value <= -size) return Math.max(2, limit - size - 2);
			return wrap(value, spanY);
		};
		return {
			x: crossX(Number(x) || 0, Math.max(1, viewportWidth)),
			y: crossY(Number(y) || 0, Math.max(1, viewportHeight)),
		};
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
		WALK_SPEED,
		WALK_EVERY,
		WALK_DISTANCE,
		TABLE,
		ROSTER,
		LINES,
		CARE_LINES,
		TEMPO,
		FOLLOW_LINES,
		CLIP_FPS,
		rand,
		pick,
		clamp,
		createDefaultSettings,
		normalizeSettings,
		tableDefaultPosition,
		clampTablePosition,
		tableSeatRect,
		tableSeatAt,
		tableContainsPoint,
		boundsFor,
		defaultPosition,
		stepThrow,
		planWalk,
		planWalkTo,
		sanitizeOverrides,
		sanitizeSheets,
		stepWalk,
		wrapPosition,
		advanceFrame,
		frameRect,
		exportSettings,
		importSettings,
	};
});
