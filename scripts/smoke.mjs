#!/usr/bin/env node
/**
 * 本地冒烟测试：用系统 Chrome 打开 test/harness.html，真实加载 lib/client.js，
 * 检查渲染、点击、双击、右键菜单、设置页、拖拽/记忆位置与多角色开关，
 * 并生成 docs/preview.png。
 *
 * 运行：node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.CHROME_BIN || "/usr/bin/google-chrome";
const failures = [];
const consoleErrors = [];
const networkErrors = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".mp3": "audio/mpeg",
	".css": "text/css; charset=utf-8",
};

function resolveRequest(urlPath) {
	const clean = decodeURIComponent(urlPath.split("?")[0]);
	if (clean === "/" || clean === "/test/harness.html") return join(root, "test/harness.html");
	if (clean === "/plugins/client.js") return join(root, "lib/client.js");
	if (clean === "/test/vendor/react.production.min.js") return join(root, "test/vendor/react.production.min.js");
	if (clean === "/test/vendor/react-dom.production.min.js") return join(root, "test/vendor/react-dom.production.min.js");
	if (clean.startsWith("/dsh-k-on-pet/")) return join(root, "assets", clean.slice("/dsh-k-on-pet/".length));
	return null;
}

const server = createServer(async (req, res) => {
	const file = resolveRequest(req.url || "/");
	if (!file) {
		res.writeHead(404).end("not found");
		return;
	}
	try {
		const info = await stat(file);
		if (!info.isFile()) throw new Error("not a file");
		res.writeHead(200, {
			"content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
			"content-length": info.size,
			"cache-control": "no-store",
		});
		createReadStream(file).pipe(res);
	} catch {
		res.writeHead(404).end("not found");
	}
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}/test/harness.html`;
console.log(`harness: ${pageUrl}`);

const profile = join(tmpdir(), `dsh-k-on-pet-smoke-${process.pid}`);
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const child = spawn(chrome, [
	"--headless=new",
	"--disable-gpu",
	"--no-sandbox",
	"--no-first-run",
	"--no-default-browser-check",
	"--mute-audio",
	"--force-device-scale-factor=1",
	"--window-size=1280,800",
	"--remote-debugging-port=0",
	`--user-data-dir=${profile}`,
	pageUrl,
], { stdio: ["ignore", "pipe", "pipe"] });
let chromeLog = "";
child.stderr.on("data", (chunk) => { chromeLog += chunk; });
child.stdout.on("data", (chunk) => { chromeLog += chunk; });

async function waitForPort() {
	const file = join(profile, "DevToolsActivePort");
	for (let i = 0; i < 150; i += 1) {
		try {
			const raw = await readFile(file, "utf8");
			const [devtoolsPort] = raw.trim().split("\n");
			if (devtoolsPort) return Number(devtoolsPort);
		} catch { /* not ready */ }
		await sleep(100);
	}
	throw new Error("Chrome DevToolsActivePort 超时\n" + chromeLog.slice(-2000));
}

function connect(wsUrl) {
	const socket = new WebSocket(wsUrl);
	let nextId = 0;
	const pending = new Map();
	const events = [];
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			const { resolve: done, reject } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
			else done(message.result);
			return;
		}
		for (const handler of events) handler(message);
	});
	const ready = new Promise((done, fail) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", fail, { once: true });
	});
	const send = (method, params = {}) => new Promise((done, fail) => {
		const id = ++nextId;
		pending.set(id, { resolve: done, reject: fail });
		socket.send(JSON.stringify({ id, method, params }));
	});
	return { send, ready, on: (handler) => events.push(handler), close: () => socket.close() };
}

let cdp;
try {
	const devtoolsPort = await waitForPort();
	const targets = await (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
	const page = targets.find((target) => target.type === "page" && target.url.startsWith("http://127.0.0.1"));
	if (!page) throw new Error("找不到 harness 页面目标：\n" + JSON.stringify(targets, null, 2));
	cdp = connect(page.webSocketDebuggerUrl);
	await cdp.ready;
} catch (error) {
	console.error("✗ 启动 Chrome 失败：", error.message);
	server.close();
	child.kill("SIGKILL");
	process.exit(1);
}

cdp.on((message) => {
	if (message.method === "Runtime.exceptionThrown") {
		const details = message.params.exceptionDetails;
		const description = details?.exception?.description || details?.text || "exception";
		if (!/NotAllowedError|play\(\) failed/.test(description)) consoleErrors.push(description);
	}
	if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
		const text = message.params.args.map((arg) => arg.value ?? arg.description).join(" ");
		if (!/NotAllowedError|play\(\) failed/.test(text)) consoleErrors.push(text);
	}
	if (message.method === "Network.responseReceived") {
		const { response } = message.params;
		if (response.status >= 400 && (response.url.includes("/dsh-k-on-pet/") || response.url.includes("/plugins/"))) {
			networkErrors.push(`${response.status} ${response.url}`);
		}
	}
	if (message.method === "Network.loadingFailed") {
		networkErrors.push(`failed ${message.params.errorText}`);
	}
});

async function evaluate(expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
	}
	return result.result.value;
}

async function waitUntil(expression, timeout = 8000, label = expression) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (await evaluate(expression)) return true;
		await sleep(100);
	}
	throw new Error(`等待超时：${label}`);
}

async function mouse(type, x, y, button = "left", clickCount = 1) {
	await cdp.send("Input.dispatchMouseEvent", {
		type,
		x,
		y,
		button,
		buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : 0,
		clickCount,
	});
}

async function actorBox(index = 0) {
	return evaluate(`(() => { const el = document.querySelectorAll('.konp-actor')[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
}

async function setSwitch(label, on) {
	return evaluate(`(() => {
		const el = [...document.querySelectorAll('.konp-settings [role="switch"]')]
			.find((node) => node.getAttribute('aria-label') === ${JSON.stringify(label)});
		if (!el) throw new Error('找不到开关：' + ${JSON.stringify(label)});
		const checked = el.getAttribute('aria-checked') === 'true';
		if (checked !== ${on}) el.click();
		return true;
	})()`);
}

async function clickButton(text) {
	return evaluate(`(() => {
		const el = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(text)});
		if (!el) throw new Error('找不到按钮：' + ${JSON.stringify(text)});
		el.click();
		return true;
	})()`);
}

async function setScale(value) {
	return evaluate(`(() => {
		const input = document.querySelector('.konp-settings input[type="range"]');
		if (!input) throw new Error('找不到大小滑块');
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
		setter.call(input, String(${value}));
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	})()`);
}

function check(condition, message) {
	if (!condition) failures.push(message);
	else console.log(`  ✓ ${message}`);
}

try {
	await cdp.send("Page.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
	await cdp.send("Runtime.enable");
	await cdp.send("Network.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
	await waitUntil("window.__ready === true", 10000, "harness ready");
	await waitUntil("!!document.querySelector('.konp-canvas')", 4000, "canvas mounted");
	await sleep(1200);

	check(await evaluate("window.__pluginName === 'dsh-k-on-pet'"), "插件名与包名一致");
	check(await evaluate("window.__registered.length === 2"), "注册了两个 slot（overlay + settings）");
	check(await evaluate("window.__overlay.options.name === 'shell.overlay'"), "注册到 shell.overlay");
	check(await evaluate("window.__settings.options.name === 'settings.section' && typeof window.__settings.options.label === 'function'"), "注册到 settings.section 且带导航 label");
	check(await evaluate("window.__settings.options.label() === 'K-ON! 桌宠'"), "设置分区名称为 K-ON! 桌宠");
	check(await evaluate("!document.querySelector('.konp-fallback')"), "素材加载成功（无 fallback）");
	check(await evaluate("!!document.querySelector('.konp-table')"), "桌子默认显示");
	const tablePainted = await evaluate(`(() => {
		const canvas = document.querySelector('.konp-table-back');
		const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		let opaque = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque += 1;
		return opaque;
	})()`);
	check(tablePainted > 1000, `桌子已绘制（不透明像素 ${tablePainted}）`);

	// ---- 拖到桌子座位 / 拖出离座 ----
	const seatPoint = await evaluate(`(() => { const t = document.querySelector('.konp-table').getBoundingClientRect(); return { x: t.x + t.width / 2, y: t.y + t.height * 0.82 }; })()`);
	const seatActorBox = await actorBox(0);
	await mouse("mousePressed", seatActorBox.x + seatActorBox.width / 2, seatActorBox.y + seatActorBox.height / 2);
	await sleep(120);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: seatPoint.x, y: seatPoint.y, button: "left", buttons: 1, clickCount: 1 });
	await sleep(120);
	await mouse("mouseReleased", seatPoint.x, seatPoint.y);
	await waitUntil("!!document.querySelector('.konp-table-seat') && document.querySelectorAll('.konp-canvas').length === 0", 3000, "入座");
	check(await evaluate("document.querySelector('.konp-table-seat').getAttribute('data-char') === 'yui'"), "平泽唯拖到座位后切换为坐姿");
	const seatedBox = await evaluate("(() => { const r = document.querySelector('.konp-table-seat').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()");
	await mouse("mousePressed", seatedBox.x + seatedBox.width / 2, seatedBox.y + seatedBox.height / 2);
	await sleep(120);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: seatedBox.x - 180, y: seatedBox.y - 140, button: "left", buttons: 1, clickCount: 1 });
	await sleep(160);
	await waitUntil("!!document.querySelector('.konp-table-ghost')", 1000, "座位拖出时显示抓取动画");
	check(true, "从座位拖出时切换为抓取动画");
	await mouse("mouseReleased", seatedBox.x - 180, seatedBox.y - 140);
	await waitUntil("!document.querySelector('.konp-table-seat') && !!document.querySelector('.konp-canvas')", 3000, "离座");
	check(true, "从座位拖出后恢复站立");

	await setSwitch("显示桌子", false);
	await waitUntil("!document.querySelector('.konp-table')", 2000, "关闭桌子");
	await setSwitch("显示桌子", true);
	await waitUntil("!!document.querySelector('.konp-table')", 2000, "重新打开桌子");

	// ---- 茶桌右键菜单：锁定 / 全部入座 / 全部离座 ----
	const tableGrabPoint = await evaluate(`(() => { const t = document.querySelector('.konp-table').getBoundingClientRect(); return { x: t.x + t.width / 2, y: t.y + t.height - 28 }; })()`);
	await mouse("mousePressed", tableGrabPoint.x, tableGrabPoint.y, "right");
	await mouse("mouseReleased", tableGrabPoint.x, tableGrabPoint.y, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "茶桌右键菜单");
	check(await evaluate("document.querySelector('.konp-menu').textContent.includes('固定桌子位置')"), "茶桌菜单提供固定位置");
	await clickButton("固定桌子位置");
	check(await evaluate("JSON.parse(localStorage.getItem('dsh-k-on-pet:v2')).tableLocked === true"), "锁定茶桌写入设置");
	const lockedBefore = await evaluate("document.querySelector('.konp-table').getBoundingClientRect().x");
	await mouse("mousePressed", tableGrabPoint.x, tableGrabPoint.y);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: tableGrabPoint.x + 60, y: tableGrabPoint.y, button: "left", buttons: 1, clickCount: 1 });
	await mouse("mouseReleased", tableGrabPoint.x + 60, tableGrabPoint.y);
	await sleep(250);
	const lockedAfter = await evaluate("document.querySelector('.konp-table').getBoundingClientRect().x");
	check(Math.abs(lockedAfter - lockedBefore) < 2, "锁定后拖动茶桌不移动");
	await mouse("mousePressed", tableGrabPoint.x, tableGrabPoint.y, "right");
	await mouse("mouseReleased", tableGrabPoint.x, tableGrabPoint.y, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "再次打开茶桌菜单");
	await clickButton("取消固定位置");
	await mouse("mousePressed", tableGrabPoint.x, tableGrabPoint.y, "right");
	await mouse("mouseReleased", tableGrabPoint.x, tableGrabPoint.y, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "打开茶桌菜单入座");
	await clickButton("全部角色入座");
	await waitUntil("document.querySelectorAll('.konp-table-seat').length === 1 && document.querySelectorAll('.konp-canvas').length === 0", 3000, "全部入座");
	await mouse("mousePressed", tableGrabPoint.x, tableGrabPoint.y, "right");
	await mouse("mouseReleased", tableGrabPoint.x, tableGrabPoint.y, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "打开茶桌菜单离座");
	await clickButton("全部角色离座");
	await waitUntil("document.querySelectorAll('.konp-table-seat').length === 0 && document.querySelectorAll('.konp-canvas').length === 1", 3000, "全部离座");
	await sleep(900);

	const painted = await evaluate(`(() => {
		const canvas = document.querySelector('.konp-canvas');
		const ctx = canvas.getContext('2d');
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let opaque = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque += 1;
		return opaque;
	})()`);
	check(painted > 800, `立绘已绘制（不透明像素 ${painted}）`);
	const sheetUrls = await evaluate(`performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/sheet.png'))`);
	check(sheetUrls.length > 0 && sheetUrls.every((url) => /[?&]v=[a-f0-9]{12}(?:&|$)/.test(url)), `图集请求带资源版本号（${sheetUrls.join(', ')}）`);

	// ---- 设置页基础 ----
	const charSwitches = await evaluate(`[...document.querySelectorAll('.konp-settings [role="switch"]')].filter((el) => (el.getAttribute('aria-label') || '').startsWith('显示') && el.getAttribute('aria-label') !== '显示桌子').length`);
	check(charSwitches === 5, `设置页列出 5 个角色开关（实际 ${charSwitches}）`);
	check(await evaluate("document.querySelectorAll('.konp-settings .konp-set-row').length >= 8"), "设置页包含角色、大小、语音、闲聊、关怀等条目");
	check(await evaluate("document.querySelector('.konp-settings .konp-set-thumb') && getComputedStyle(document.querySelector('.konp-settings .konp-set-thumb')).backgroundImage.includes('sheet.png')"), "设置页角色缩略图使用原版 sheet");
	check(await evaluate("[...document.querySelectorAll('.konp-set-btn')].filter((b) => ['导出设置', '导入设置'].includes(b.textContent.trim())).length === 2"), "设置页提供导入 / 导出按钮");

	// ---- 单击 / 双击 ----
	let box = await actorBox();
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2);
	await waitUntil("!!document.querySelector('.konp-bubble')", 3000, "点击气泡");
	const bubble = await evaluate("document.querySelector('.konp-bubble').textContent");
	check(typeof bubble === "string" && bubble.length > 2, `点击后气泡出现：「${bubble}」`);
	await sleep(200);

	box = await actorBox();
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2);
	await sleep(60);
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2);
	await sleep(300);
	const doubleBubble = await evaluate("var el=document.querySelector('.konp-bubble'); el && el.textContent");
	check(typeof doubleBubble === "string" && doubleBubble.includes("❤"), `双击出现爱心气泡：「${doubleBubble}」`);

	// ---- 右键菜单隐藏单只角色 ----
	box = await actorBox();
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2, "right");
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "右键菜单");
	check(await evaluate("document.querySelector('.konp-hide') && document.querySelector('.konp-hide').textContent.includes('隐藏')"), "右键菜单提供「隐藏这只」");
	await evaluate("(() => { const b = [...document.querySelectorAll('.konp-hide')][0]; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); })()");
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 0", 3000, "隐藏后无角色");
	check(await evaluate("document.querySelector('.konp-settings [aria-label=\"显示平泽唯\"]').getAttribute('aria-checked') === 'false'"), "隐藏后设置项同步关闭");

	// ---- 从设置页显示秋山澪 ----
	await setSwitch("显示秋山澪", true);
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 1", 3000, "秋山澪出现");
	await sleep(900);
	check(await evaluate("!document.querySelector('.konp-fallback')"), "新角色素材正常");
	const mioPainted = await evaluate(`(() => {
		const canvas = document.querySelector('.konp-canvas');
		const ctx = canvas.getContext('2d');
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let opaque = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque += 1;
		return opaque;
	})()`);
	check(mioPainted > 800, `秋山澪立绘已绘制（不透明像素 ${mioPainted}）`);

	// ---- 多角色：再显示平泽唯 ----
	await setSwitch("显示平泽唯", true);
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 2", 3000, "两个角色同时存在");
	await sleep(900);
	check(await evaluate("document.querySelectorAll('.konp-actor').length === 2"), "多角色同时渲染");
	const distinct = await evaluate(`(() => {
		const [a, b] = [...document.querySelectorAll('.konp-actor')].map((el) => el.getBoundingClientRect().x);
		return Math.abs(a - b) > 20;
	})()`);
	check(distinct, "多角色默认位置错开，不重叠");

	// ---- 大小滑块 ----
	await setScale(2);
	await waitUntil("document.querySelector('.konp-actor').style.width === '192px'", 2000, "放大到 2.0×");
	const scaledWidth = await evaluate("document.querySelector('.konp-actor').getBoundingClientRect().width");
	check(scaledWidth === 192, `大小设置生效（${scaledWidth}px）`);
	await setScale(1.5);
	await waitUntil("document.querySelector('.konp-actor').style.width === '144px'", 2000, "恢复到 1.5×");

	// ---- 拖拽并记忆位置 ----
	box = await actorBox(0);
	const before = { x: box.x, y: box.y };
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	await sleep(60);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width / 2 - 90, y: box.y + box.height / 2 - 70, button: "left", buttons: 1, clickCount: 1 });
	await sleep(60);
	await mouse("mouseReleased", box.x + box.width / 2 - 90, box.y + box.height / 2 - 70);
	await sleep(900);
	box = await actorBox(0);
	check(Math.abs(box.x - before.x) > 40 || Math.abs(box.y - before.y) > 30, `拖拽生效（${before.x.toFixed(0)},${before.y.toFixed(0)} → ${box.x.toFixed(0)},${box.y.toFixed(0)}）`);
	const rotate = await evaluate("document.querySelector('.konp-actor').style.rotate || '0deg'");
	check(Math.abs(parseFloat(rotate) || 0) < 0.01, `落地后旋转归零（${rotate}）`);
	const stored = await evaluate(`(() => { try { const raw = localStorage.getItem('dsh-k-on-pet:v2'); if (!raw) return null; const data = JSON.parse(raw); return data && data.positions ? Object.keys(data.positions) : null; } catch { return null; } })()`);
	check(Array.isArray(stored) && stored.length > 0, `拖动后位置写入 localStorage（${JSON.stringify(stored)}）`);

	// ---- 慢速拖拽不触发下落 ----
	// Isolate this assertion from the table and from earlier multi-actor state:
	// one Yui at the default bottom-right, table closed.
	await setSwitch("显示桌子", false);
	await waitUntil("!document.querySelector('.konp-table')", 2000, "下降前关闭桌子");
	await clickButton("全部隐藏");
	await setSwitch("显示平泽唯", true);
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 1", 3000, "下降前只显示平泽唯");
	await sleep(300);
	const isolated = await actorBox(0);
	await mouse("mousePressed", isolated.x + isolated.width / 2, isolated.y + isolated.height / 2, "right");
	await mouse("mouseReleased", isolated.x + isolated.width / 2, isolated.y + isolated.height / 2, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "打开下降前菜单");
	await clickButton("这只回到右下角");
	await sleep(500);
	// A fast drag may still be finishing its throw; wait until the actor stops
	// moving so this test measures the slow-drag path only.
	let lastBox = null;
	for (let i = 0; i < 20; i += 1) {
		const current = await actorBox(0);
		if (lastBox && Math.abs(current.x - lastBox.x) < 1 && Math.abs(current.y - lastBox.y) < 1) break;
		lastBox = current;
		await sleep(150);
	}
	box = await actorBox(0);
	const startY = box.y;
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	for (let i = 1; i <= 4; i += 1) {
		await sleep(120);
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: box.x + box.width / 2,
			y: box.y + box.height / 2 - i * 40,
			button: "left",
			buttons: 1,
			clickCount: 1,
		});
	}
	await sleep(350);
	const releasedY = box.y - 160;
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2 - 160);
	await sleep(900);
	const slow = await actorBox(0);
	check(Math.abs(slow.y - releasedY) < 36 && slow.y < startY - 80, `慢速拖拽停在松手位置（${slow.y.toFixed(0)} vs ${releasedY.toFixed(0)}）`);

	// ---- 单个角色回到右下角 ----
	box = await actorBox(0);
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2, "right");
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "再次打开菜单");
	await clickButton("这只回到右下角");
	await sleep(700);
	const afterReset = await evaluate(`(() => { try { const raw = localStorage.getItem('dsh-k-on-pet:v2'); if (!raw) return null; const data = JSON.parse(raw); return data && data.positions ? Object.keys(data.positions).length : 0; } catch { return null; } })()`);
	check(afterReset === 0, "重置后该角色位置记录被清除");
	check(await evaluate("!document.querySelector('.konp-menu')"), "重置后菜单关闭");

	// ---- 全部隐藏 / 全部显示 ----
	await setSwitch("显示桌子", true);
	await waitUntil("!!document.querySelector('.konp-table')", 2000, "恢复桌子");
	await clickButton("全部隐藏");
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 0", 3000, "全部隐藏");
	check(await evaluate("document.querySelectorAll('.konp-settings [aria-label^=\"显示\"][aria-checked=\"true\"]').length === 1 && document.querySelector('.konp-settings [aria-label=\"显示桌子\"]').getAttribute('aria-checked') === 'true'"), "全部隐藏后角色开关关闭、桌子开关保持");
	await setSwitch("显示平泽唯", true);
	await waitUntil("document.querySelectorAll('.konp-canvas').length === 1", 3000, "只显示平泽唯");
	check(await evaluate("document.querySelector('.konp-settings .konp-set-head span').textContent.trim() === '1 / 5'"), "设置页计数正确（1 / 5）");

	// ---- 准备 README 预览图 ----
	await clickButton("重置所有位置");
	await sleep(700);
	box = await actorBox(0);
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2 - 10);
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2 - 10);
	await sleep(500);
	box = await actorBox(0);
	const clip = {
		x: Math.max(0, box.x + 5),
		y: Math.max(0, box.y - 53),
		width: Math.min(230, 1280 - Math.max(0, box.x + 5)),
		height: Math.min(290, 800 - Math.max(0, box.y - 53)),
		scale: 1,
	};
	await mkdir(join(root, "docs"), { recursive: true });
	const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, clip });
	await writeFile(join(root, "docs/preview.png"), Buffer.from(shot.data, "base64"));
	console.log("  ✓ 已生成 docs/preview.png");

	// 设置页截图（不做任何交互，保持当前 1/5 状态）。截图时临时隐藏悬浮层，
	// 避免桌子和角色挡住设置内容；截完立即恢复。
	await evaluate(`(() => { const root = document.querySelector('.konp-root'); if (root) root.style.visibility = 'hidden'; })()`);
	const panel = await evaluate(`(() => { const el = document.getElementById('settings-root'); const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:Math.min(560, r.height) }; })()`);
	const panelShot = await cdp.send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		clip: { x: panel.x, y: panel.y, width: panel.width, height: panel.height, scale: 1 },
	});
	await writeFile(join(root, "docs/settings.png"), Buffer.from(panelShot.data, "base64"));
	await evaluate(`(() => { const root = document.querySelector('.konp-root'); if (root) root.style.visibility = ''; })()`);
	console.log("  ✓ 已生成 docs/settings.png");

} catch (error) {
	failures.push(error.message);
} finally {
	if (consoleErrors.length) failures.push("控制台错误：" + consoleErrors.join(" | "));
	if (networkErrors.length) failures.push("网络错误：" + networkErrors.join(" | "));
	cdp?.close();
	child.kill("SIGKILL");
	server.close();
	await rm(profile, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
	console.error("✗ 冒烟测试失败：");
	for (const failure of failures) console.error(`  - ${failure}`);
	if (chromeLog) console.error("Chrome 日志尾部：\n" + chromeLog.slice(-2000));
	process.exit(1);
}
console.log("✓ 冒烟测试通过");
