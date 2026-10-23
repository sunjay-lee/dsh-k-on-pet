#!/usr/bin/env node
/**
 * 本地冒烟测试：用系统 Chrome 打开 test/harness.html，真实加载 lib/client.js，
 * 检查渲染、点击、双击、右键菜单、拖拽与切角色，并生成 docs/preview.png。
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
		consoleErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || "exception");
	}
	if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
		consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(" "));
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

async function actorBox() {
	return evaluate(`(() => { const r = document.querySelector('.konp-actor').getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; })()`);
}

function check(condition, message) {
	if (!condition) failures.push(message);
	else console.log(`  ✓ ${message}`);
}

try {
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Network.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
	await waitUntil("window.__ready === true", 10000, "harness ready");
	await waitUntil("!!document.querySelector('.konp-canvas')", 4000, "canvas mounted");
	await sleep(1200);

	check(await evaluate("window.__pluginName === 'dsh-k-on-pet'"), "插件名与包名一致");
	check(await evaluate("window.__registered && window.__registered.options.name === 'shell.overlay'"), "注册到 shell.overlay");
	check(await evaluate("!document.querySelector('.konp-fallback')"), "素材加载成功（无 fallback）");

	const painted = await evaluate(`(() => {
		const canvas = document.querySelector('.konp-canvas');
		const ctx = canvas.getContext('2d');
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
		let opaque = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 16) opaque += 1;
		return opaque;
	})()`);
	check(painted > 800, `立绘已绘制（不透明像素 ${painted}）`);

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

	box = await actorBox();
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2, "right");
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2, "right");
	await waitUntil("!!document.querySelector('.konp-menu')", 3000, "右键菜单");
	check(await evaluate("document.querySelectorAll('.konp-char').length === 5"), "菜单列出 5 位角色");

	await evaluate(`(() => { const b = [...document.querySelectorAll('.konp-char')].find((el) => el.textContent.includes('秋山澪')); b.click(); return true; })()`);
	await sleep(1400);
	check(await evaluate("!document.querySelector('.konp-menu')"), "选择角色后菜单关闭");
	check(await evaluate("!document.querySelector('.konp-fallback')"), "切换角色后素材正常");

	box = await actorBox();
	const before = { x: box.x, y: box.y };
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2);
	await sleep(60);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + box.width / 2 - 90, y: box.y + box.height / 2 - 60, button: "left", buttons: 1, clickCount: 1 });
	await sleep(60);
	await mouse("mouseReleased", box.x + box.width / 2 - 90, box.y + box.height / 2 - 60);
	await sleep(800);
	box = await actorBox();
	check(Math.abs(box.x - before.x) > 40 || Math.abs(box.y - before.y) > 30, `拖拽生效（${before.x.toFixed(0)},${before.y.toFixed(0)} → ${box.x.toFixed(0)},${box.y.toFixed(0)}）`);

	// 回到右下角、摆好姿势，截一张 README 预览图。
	await evaluate(`(() => {
		const buttons = [...document.querySelectorAll('button')];
		const gear = document.querySelector('.konp-gear');
		gear.click();
		return true;
	})()`);
	await sleep(200);
	await evaluate(`(() => { const b = [...document.querySelectorAll('.konp-char')].find((el) => el.textContent.includes('平泽唯')); if (b) b.click(); return true; })()`);
	await sleep(1200);
	await evaluate(`document.querySelector('.konp-gear').click()`);
	await sleep(250);
	await evaluate(`(() => { const reset = [...document.querySelectorAll('.konp-reset')].pop(); if (reset) reset.click(); return true; })()`);
	await sleep(600);
	box = await actorBox();
	await mouse("mousePressed", box.x + box.width / 2, box.y + box.height / 2 - 10);
	await mouse("mouseReleased", box.x + box.width / 2, box.y + box.height / 2 - 10);
	await sleep(500);
	box = await actorBox();
	const clip = {
		x: Math.max(0, box.x - 130),
		y: Math.max(0, box.y - 190),
		width: Math.min(380, 1280 - Math.max(0, box.x - 130)),
		height: Math.min(380, 800 - Math.max(0, box.y - 190)),
		scale: 1,
	};
	await mkdir(join(root, "docs"), { recursive: true });
	const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, clip });
	await writeFile(join(root, "docs/preview.png"), Buffer.from(shot.data, "base64"));
	console.log("  ✓ 已生成 docs/preview.png");

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
