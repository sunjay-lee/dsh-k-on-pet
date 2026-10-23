/**
 * dsh-k-on-pet — 宿主半侧。
 *
 * 只做一件事：把仓库里的 assets/ 目录挂到 Web 服务器的
 * /dsh-k-on-pet/* 前缀下，供浏览器半侧（lib/client.js）加载立绘和语音。
 * 路由是只读的，不执行任何用户输入。
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const name = "dsh-k-on-pet";
const inject = ["webServer"];
const PREFIX = "/dsh-k-on-pet";
const ASSETS = fileURLToPath(new URL("../assets", import.meta.url));

const MIME = {
	".png": "image/png",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".json": "application/json; charset=utf-8",
};

function text(res, status, body) {
	const payload = Buffer.from(body + "\n", "utf8");
	res.writeHead(status, {
		"content-type": "text/plain; charset=utf-8",
		"content-length": payload.length,
		"cache-control": "no-store",
		"x-content-type-options": "nosniff",
	});
	res.end(payload);
}

function sendFile(req, res, file, contentType, size) {
	const headers = {
		"content-type": contentType,
		"content-length": size,
		"cache-control": contentType.startsWith("application/json")
			? "no-cache"
			: "public, max-age=86400",
		"x-content-type-options": "nosniff",
	};
	if (req.method === "HEAD") {
		res.writeHead(200, headers);
		res.end();
		return;
	}
	const stream = createReadStream(file);
	stream.once("open", () => {
		if (res.destroyed || res.writableEnded) {
			stream.destroy();
			return;
		}
		res.writeHead(200, headers);
		stream.pipe(res);
	});
	stream.on("error", () => {
		if (!res.headersSent) text(res, 404, "dsh-k-on-pet: asset not found");
		else res.destroy();
	});
	res.on("close", () => stream.destroy());
}

async function handler(req, res) {
	if (req.method !== "GET" && req.method !== "HEAD") {
		text(res, 405, "dsh-k-on-pet: method not allowed");
		return;
	}
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
	} catch {
		text(res, 400, "dsh-k-on-pet: bad request");
		return;
	}
	if (!pathname.startsWith(PREFIX + "/")) {
		text(res, 404, "dsh-k-on-pet: asset not found");
		return;
	}
	const relative = pathname.slice(PREFIX.length);
	if (relative.includes("\0")) {
		text(res, 400, "dsh-k-on-pet: bad request");
		return;
	}
	const file = resolve(ASSETS, "." + relative);
	if (file !== ASSETS && !file.startsWith(ASSETS + sep)) {
		text(res, 404, "dsh-k-on-pet: asset not found");
		return;
	}
	let info;
	try {
		info = await stat(file);
	} catch {
		text(res, 404, "dsh-k-on-pet: asset not found");
		return;
	}
	if (!info.isFile()) {
		text(res, 404, "dsh-k-on-pet: asset not found");
		return;
	}
	const contentType = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
	sendFile(req, res, file, contentType, info.size);
}

function apply(ctx) {
	ctx.effect(
		() => ctx.webServer.register({
			kind: "prefix",
			path: PREFIX,
			handler,
		}),
		"dsh-k-on-pet: character assets",
	);
}

export { apply, inject, name };
