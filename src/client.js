/**
 * dsh-k-on-pet — Web 客户端源码。
 *
 * 由 scripts/build-client.mjs 把 src/core.cjs 与这个文件合成 lib/client.js；
 * 发布物仍然是单个浏览器模块，不依赖打包器或第三方运行时。
 */
;(() => {
	window.__ModuleLoader__.load({
		id: "dsh-k-on-pet",
		factory: (require) => {
			const React = require("react");
			const { useCallback, useEffect, useRef, useState } = React;
			const h = React.createElement;
			const Core = globalThis.KonPetCore;
			if (!Core) throw new Error("dsh-k-on-pet: 缺少 KonPetCore，请先运行 node scripts/build-client.mjs");

			const ASSET_BASE = "/dsh-k-on-pet";
			// build-client.mjs 会把占位符替换成资源内容摘要；切图/语音变化后 URL 自动变化，
			// 避免浏览器继续使用旧尺寸的 sheet.png。
			const ASSET_REV = "__KONP_ASSET_REV__";
			const {
				CELL,
				TABLE,
				STORE_KEY,
				LEGACY_KEY,
				SLEEP_AFTER,
				CARE_EVERY,
				TALK_EVERY,
				ROSTER,
				LINES,
				CARE_LINES,
				CLIP_FPS,
			} = Core;
			const normalizeSettings = Core.normalizeSettings;
			const tableDefaultPosition = Core.tableDefaultPosition;
			const clampTablePosition = Core.clampTablePosition;
			const tableSeatAt = Core.tableSeatAt;

			const CSS = `
.konp-root{position:fixed;inset:0;z-index:2147482000;pointer-events:none;font-family:inherit}
.konp-actor{position:absolute;left:0;top:0;pointer-events:auto;cursor:grab;touch-action:none;will-change:transform;user-select:none;-webkit-user-select:none}
.konp-actor.is-drag{cursor:grabbing}
.konp-actor:focus-visible{outline:2px solid #8a6aa8;outline-offset:4px;border-radius:12px}
.konp-canvas{display:block;width:100%;height:100%;image-rendering:pixelated;transform-origin:50% 88%;filter:drop-shadow(0 5px 8px rgba(0,0,0,.13));transition:filter .2s ease}
.konp-actor:hover .konp-canvas{filter:drop-shadow(0 7px 12px rgba(0,0,0,.18))}
.konp-bubble{position:absolute;bottom:calc(100% - 6px);left:50%;transform:translateX(-50%);min-width:96px;max-width:230px;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,.97);color:#3a3340;font-size:12px;line-height:1.55;text-align:center;white-space:pre-wrap;box-shadow:0 6px 22px rgba(40,30,50,.18);border:1px solid rgba(70,55,80,.10);animation:konp-pop .18s cubic-bezier(.2,1.4,.4,1);pointer-events:none}
.konp-bubble:after{content:"";position:absolute;left:50%;top:100%;width:10px;height:10px;margin-left:-5px;margin-top:-5px;background:inherit;border-right:1px solid rgba(70,55,80,.10);border-bottom:1px solid rgba(70,55,80,.10);transform:rotate(45deg)}
.konp-gear{position:absolute;right:2px;top:2px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(255,255,255,.92);color:#6b6273;font-size:12px;line-height:20px;padding:0;cursor:pointer;opacity:0;transition:opacity .15s ease;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.konp-actor:hover .konp-gear,.konp-gear:focus-visible{opacity:1}
.konp-menu{position:fixed;width:236px;padding:12px;border-radius:16px;background:rgba(255,255,255,.98);color:#3a3340;border:1px solid rgba(70,55,80,.12);box-shadow:0 18px 50px rgba(35,25,45,.22);pointer-events:auto;font-size:12px;animation:konp-pop .16s cubic-bezier(.2,1.4,.4,1)}
.konp-menu-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:13px;margin:0 0 8px}
.konp-x{border:0;background:transparent;color:#8b8193;font-size:16px;cursor:pointer;padding:0 2px;line-height:1}
.konp-label{color:#8b8193;margin:8px 0 5px;font-size:11px;letter-spacing:.02em}
.konp-range{width:100%;margin:2px 0 0;accent-color:#8a6aa8}
.konp-row{display:flex;align-items:center;justify-content:space-between;margin:10px 0 0}
.konp-toggle{border:1px solid rgba(70,55,80,.16);background:#f7f4f9;color:#6b6273;border-radius:999px;padding:4px 10px;font-size:11px;cursor:pointer}
.konp-toggle.is-on{background:#efe6f6;border-color:rgba(120,90,150,.3);color:#5c4673}
.konp-reset{width:100%;margin-top:10px;border:1px solid rgba(70,55,80,.16);background:transparent;border-radius:9px;padding:6px;color:#5f5668;font-size:12px;cursor:pointer}
.konp-reset:hover{background:#f6f2f8}
.konp-tip{color:#9a91a2;font-size:10px;line-height:1.5;margin:9px 0 0}
.konp-menu-name{font-weight:600;font-size:13px;margin:2px 0 8px;color:#4a4352}
.konp-hide{width:100%;border:1px solid rgba(70,55,80,.16);background:#f7f4f9;color:#6b6273;border-radius:9px;padding:6px;font-size:12px;cursor:pointer;margin:0 0 4px}
.konp-hide:hover{background:#f2edf7}
.konp-settings{max-width:640px;padding:2px 0 28px;font-size:13px;line-height:1.6;color:inherit}
.konp-settings h2{font-size:18px;font-weight:650;margin:0 0 4px}
.konp-set-sub{font-size:12px;opacity:.6;margin:0 0 18px}
.konp-set-card{border:1px solid rgba(127,127,127,.2);border-radius:14px;padding:6px 16px;margin:0 0 14px;background:rgba(127,127,127,.035)}
.konp-set-head{display:flex;justify-content:space-between;align-items:center;padding:10px 0 6px;font-size:12px}
.konp-set-head strong{font-size:13px;font-weight:600}
.konp-set-head span{opacity:.55}
.konp-set-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid rgba(127,127,127,.12)}
.konp-set-list .konp-set-row:first-child{border-top:0}
.konp-set-thumb{width:40px;height:40px;flex:none;border-radius:8px;background-repeat:no-repeat;background-position:0 0;image-rendering:pixelated;background-color:rgba(127,127,127,.08)}
.konp-set-name{flex:1;min-width:0}
.konp-set-name b{display:block;font-size:13px;font-weight:600}
.konp-set-name small{display:block;font-size:11px;opacity:.55}
.konp-set-actions{display:flex;gap:8px;padding:10px 0 8px;border-top:1px solid rgba(127,127,127,.12)}
.konp-set-btn{border:1px solid rgba(127,127,127,.25);background:transparent;border-radius:8px;padding:5px 10px;font:inherit;font-size:12px;cursor:pointer;color:inherit}
.konp-set-btn:hover{background:rgba(127,127,127,.08)}
.konp-set-row .konp-range{width:160px;margin:0;flex:none}
.konp-set-value{width:40px;text-align:right;font-variant-numeric:tabular-nums;opacity:.6;font-size:12px;flex:none}
.konp-set-note{font-size:11px;line-height:1.7;opacity:.55;margin:10px 0 0}
.konp-switch{position:relative;width:36px;height:20px;flex:none;border:0;border-radius:999px;background:rgba(127,127,127,.3);cursor:pointer;padding:0;transition:background .15s}
.konp-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
.konp-switch.is-on{background:#7c5aa6}
.konp-switch.is-on i{transform:translateX(16px)}
.konp-fallback{position:fixed;right:18px;bottom:18px;padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.96);color:#8a5a5a;font-size:11px;box-shadow:0 4px 16px rgba(0,0,0,.12);pointer-events:auto}
.konp-table{position:fixed;left:0;top:0;pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;will-change:transform}
.konp-table-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;image-rendering:pixelated;pointer-events:none}
.konp-table-back{z-index:0;filter:drop-shadow(0 8px 14px rgba(0,0,0,.14))}
.konp-table-front{z-index:3}
.konp-table-grab{position:absolute;left:0;right:0;z-index:1;cursor:grab;touch-action:none}
.konp-table.is-drag .konp-table-grab{cursor:grabbing}
.konp-table-seat{position:absolute;display:block;image-rendering:pixelated;cursor:grab;touch-action:none;filter:drop-shadow(0 3px 5px rgba(0,0,0,.12))}
.konp-table-seat:focus-visible{outline:2px solid #8a6aa8;outline-offset:3px;border-radius:8px}
.konp-table-ghost{position:fixed;display:block;pointer-events:none;image-rendering:pixelated;filter:drop-shadow(0 8px 12px rgba(0,0,0,.2));z-index:2147482400}
@keyframes konp-pop{from{opacity:0;transform:translateX(-50%) scale(.92)}to{opacity:1;transform:translateX(-50%) scale(1)}}
@media (prefers-reduced-motion: reduce){.konp-canvas{transition:none}.konp-bubble,.konp-menu{animation:none}}
`;

			function notifySettings() {
				for (const listener of settingsListeners) {
					try { listener(); } catch { /* 单个订阅失败不影响其他实例 */ }
				}
			}

			function replaceSettings(raw) {
				currentSettings = normalizeSettings(raw);
				persistSettings(currentSettings);
				notifySettings();
				return currentSettings;
			}

			function readStored(key) {
				try {
					const raw = localStorage.getItem(key);
					const parsed = raw ? JSON.parse(raw) : null;
					return parsed && typeof parsed === "object" ? parsed : null;
				} catch {
					return null;
				}
			}

			function persistSettings(settings) {
				try {
					localStorage.setItem(STORE_KEY, JSON.stringify(settings));
				} catch {
					// 隐私模式下 localStorage 可能不可写，内存状态仍然有效。
				}
			}

			let currentSettings = null;
			const settingsListeners = new Set();

			function getSettings() {
				if (currentSettings === null) {
					const next = readStored(STORE_KEY);
					const legacy = next ? null : readStored(LEGACY_KEY);
					currentSettings = normalizeSettings(next || legacy || {});
					if (!next && legacy) persistSettings(currentSettings);
				}
				return currentSettings;
			}

			function updateSettings(patch) {
				const previous = getSettings();
				const raw = typeof patch === "function" ? patch(previous) : patch;
				const next = normalizeSettings({ ...previous, ...raw });
				currentSettings = next;
				persistSettings(next);
				notifySettings();
				return next;
			}

			function subscribeSettings(listener) {
				settingsListeners.add(listener);
				return () => settingsListeners.delete(listener);
			}

			function useSettings() {
				const [, force] = useState(0);
				useEffect(() => subscribeSettings(() => force((value) => value + 1)), []);
				return getSettings();
			}

			function injectStyle() {
				if (document.getElementById("dsh-k-on-pet-style")) return;
				const style = document.createElement("style");
				style.id = "dsh-k-on-pet-style";
				style.textContent = CSS;
				document.head.appendChild(style);
			}


			// 所有角色共享一个 rAF 循环，避免多角色时各自跑一条时间线。
			const tickers = new Set();
			let tickerRaf = 0;
			let tickerLast = 0;

			function pump(now) {
				if (!tickers.size) {
					tickerRaf = 0;
					return;
				}
				const dt = Math.min(0.05, Math.max(0, (now - tickerLast) / 1000));
				tickerLast = now;
				for (const tick of Array.from(tickers)) {
					try { tick(dt, now); } catch (error) { console.error("[dsh-k-on-pet] tick failed", error); }
				}
				tickerRaf = requestAnimationFrame(pump);
			}

			function addTicker(tick) {
				tickers.add(tick);
				if (!tickerRaf) {
					tickerLast = performance.now();
					tickerRaf = requestAnimationFrame(pump);
				}
				return () => {
					tickers.delete(tick);
					if (!tickers.size && tickerRaf) {
						cancelAnimationFrame(tickerRaf);
						tickerRaf = 0;
					}
				};
			}

			function Switch({ checked, onChange, label }) {
				return h("button", {
					type: "button",
					role: "switch",
					"aria-checked": checked,
					"aria-label": label,
					className: `konp-switch${checked ? " is-on" : ""}`,
					onClick: onChange,
				}, h("i"));
			}

			function KOnPetSettings() {
				const settings = useSettings();
				const count = ROSTER.filter((member) => settings.visible[member.id]).length;
				const fileRef = useRef(null);
				const [notice, setNotice] = useState("");

				const doExport = () => {
					const blob = new Blob([Core.exportSettings(settings)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const link = document.createElement("a");
					link.href = url;
					link.download = "dsh-k-on-pet-settings.json";
					link.click();
					window.setTimeout(() => URL.revokeObjectURL(url), 1000);
					setNotice("已导出当前设置");
				};

				const doImport = async (event) => {
					const file = event.target.files && event.target.files[0];
					event.target.value = "";
					if (!file) return;
					try {
						const text = await file.text();
						replaceSettings(Core.importSettings(text));
						setNotice("已导入设置");
					} catch (error) {
						setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
					}
				};

				const toggleMember = (id) => updateSettings((current) => ({
					...current,
					visible: { ...current.visible, [id]: !current.visible[id] },
					seats: { ...current.seats, [id]: false },
				}));
				const setAll = (visible) => updateSettings((current) => ({
					...current,
					visible: Object.fromEntries(ROSTER.map((member) => [member.id, visible])),
					seats: visible ? current.seats : {},
				}));

				return h("div", { className: "konp-settings" },
					h("h2", null, "K-ON! 桌宠"),
					h("p", { className: "konp-set-sub" }, "把《轻音少女》的角色请到界面上。设置保存在当前浏览器，每个角色有独立位置。"),
					h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" },
							h("strong", null, "显示角色"),
							h("span", null, `${count} / ${ROSTER.length}`),
						),
						h("div", { className: "konp-set-list" },
							ROSTER.map((member) => h("div", { className: "konp-set-row", key: member.id },
								h("span", {
									className: "konp-set-thumb",
									style: {
										backgroundImage: `url(${ASSET_BASE}/characters/${member.id}/sheet.png?v=${ASSET_REV})`,
										backgroundSize: `${member.columns * 40}px ${member.rows * 40}px`,
									},
								}),
								h("div", { className: "konp-set-name" },
									h("b", null, member.name),
									h("small", null, `${member.id} · ${member.voices} 条语音`),
								),
								h(Switch, {
									checked: Boolean(settings.visible[member.id]),
									onChange: () => toggleMember(member.id),
									label: `显示${member.name}`,
								}),
							)),
						),
						h("div", { className: "konp-set-actions" },
							h("button", { className: "konp-set-btn", type: "button", onClick: () => setAll(true) }, "全部显示"),
							h("button", { className: "konp-set-btn", type: "button", onClick: () => setAll(false) }, "全部隐藏"),
						),
					),
					h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" }, h("strong", null, "桌子"), h("span", null, "常驻 · 可拖动")),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "显示桌子"),
								h("small", null, "拖角色到自己的座位附近会自动入座；从座位拖出即可离座。"),
							),
							h(Switch, {
								checked: settings.table,
								onChange: () => updateSettings((current) => ({
									...current,
									table: !current.table,
									seats: current.table ? {} : current.seats,
								})),
								label: "显示桌子",
							}),
						),
						h("p", { className: "konp-set-note" }, "座位从左到右固定为：澪、律、唯、䌷、梓。桌子本身也可以拖动。"),
						h("div", { className: "konp-set-actions" },
							h("button", {
								className: "konp-set-btn",
								type: "button",
								onClick: () => updateSettings((current) => ({ ...current, tablePos: null, seats: {} })),
							}, "重置桌子位置"),
						),
					),
					h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" }, h("strong", null, "外观与行为")),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "大小"),
								h("small", null, "同时作用于所有角色"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 1,
								max: 2.4,
								step: 0.1,
								value: settings.scale,
								"aria-label": "桌宠大小",
								onChange: (event) => updateSettings({ scale: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.scale.toFixed(1)}×`),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "语音"),
								h("small", null, "点击 / 双击时播放原版语音"),
							),
							h(Switch, {
								checked: !settings.muted,
								onChange: () => updateSettings({ muted: !settings.muted }),
								label: "播放语音",
							}),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "随机闲聊"),
								h("small", null, "待机时每 2.5–5 分钟说一句"),
							),
							h(Switch, {
								checked: settings.chatter,
								onChange: () => updateSettings({ chatter: !settings.chatter }),
								label: "随机闲聊",
							}),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "关怀提醒"),
								h("small", null, "每 50 分钟提醒喝水 / 休息"),
							),
							h(Switch, {
								checked: settings.care,
								onChange: () => updateSettings({ care: !settings.care }),
								label: "关怀提醒",
							}),
						),
					),
					h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" }, h("strong", null, "备份与恢复")),
						h("p", { className: "konp-set-note" }, "把角色偏好导出为 JSON，或从备份文件恢复；导入会覆盖当前设置。"),
						h("div", { className: "konp-set-actions" },
							h("button", { className: "konp-set-btn", type: "button", onClick: doExport }, "导出设置"),
							h("button", { className: "konp-set-btn", type: "button", onClick: () => fileRef.current && fileRef.current.click() }, "导入设置"),
							h("input", {
								ref: fileRef,
								type: "file",
								accept: "application/json,.json",
								style: { display: "none" },
								onChange: doImport,
							}),
						),
						notice ? h("p", { className: "konp-set-note", role: "status" }, notice) : null,
					),
					h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" }, h("strong", null, "位置与重置")),
						h("p", { className: "konp-set-note" }, "拖动宠物到任意位置后会自动记住；新增角色会依次排在右下角。"),
						h("div", { className: "konp-set-actions" },
							h("button", {
								className: "konp-set-btn",
								type: "button",
								onClick: () => updateSettings((current) => ({ ...current, positions: {} })),
							}, "重置所有位置"),
							h("button", {
								className: "konp-set-btn",
								type: "button",
								onClick: () => replaceSettings(Core.createDefaultSettings()),
							}, "恢复默认设置"),
						),
					),
					h("p", { className: "konp-set-note" }, "提示：右键宠物可以单独隐藏它；隐藏后仍可在这里重新打开。"),
				);
			}

			function PetActor({ member, settings, index, count, onHide, onDropSeat }) {
				const [asset, setAsset] = useState(null);
				const [assetError, setAssetError] = useState("");
				const [bubble, setBubble] = useState(null);
				const [menu, setMenu] = useState(null);

				const settingsRef = useRef(settings);
				settingsRef.current = settings;

				const assetRef = useRef(null);
				const engineRef = useRef(null);
				const posRef = useRef({ x: 0, y: 0 });
				const rotRef = useRef(0);
				const actorRef = useRef(null);
				const canvasRef = useRef(null);
				const menuRef = useRef(null);
				const pointerRef = useRef(null);
				const bubbleTimer = useRef(0);
				const clickTimer = useRef(0);
				const lastClickAt = useRef(0);
				const lastDoubleAt = useRef(0);
				const audioRef = useRef(null);
				const lastVoice = useRef("");
				const reduceMotion = useRef(false);

				const size = Math.round(CELL * settings.scale);
				const stored = settings.positions[member.id];
				const storedX = stored && Number.isFinite(stored.x) ? stored.x : null;
				const storedY = stored && Number.isFinite(stored.y) ? stored.y : null;

				const syncTransform = useCallback(() => {
					const actor = actorRef.current;
					if (!actor) return;
					const { x, y } = posRef.current;
					actor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
					const canvas = canvasRef.current;
					if (canvas) canvas.style.transform = `rotate(${rotRef.current}deg)`;
				}, []);

				const bounds = useCallback((actorSize = size) => Core.boundsFor(window.innerWidth, window.innerHeight, actorSize), [size]);

				const say = useCallback((text, ms = 4200) => {
					if (!text) return;
					setBubble({ text, key: Date.now() });
					clearTimeout(bubbleTimer.current);
					bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
				}, []);

				const playVoice = useCallback((meta) => {
					if (settingsRef.current.muted || !meta || !Array.isArray(meta.voices) || meta.voices.length === 0) return;
					let file = Core.pick(meta.voices);
					if (meta.voices.length > 1 && file === lastVoice.current) {
						file = Core.pick(meta.voices.filter((voice) => voice !== file));
					}
					lastVoice.current = file;
					const audio = audioRef.current || (audioRef.current = new Audio());
					audio.src = `${ASSET_BASE}/characters/${meta.id}/voices/${file}?v=${ASSET_REV}`;
					audio.volume = 0.65;
					audio.play().catch(() => {
						// 没有用户手势时浏览器会拒绝播放，静默忽略。
					});
				}, []);

				const setClip = useCallback((engine, clip, mode) => {
					const meta = assetRef.current && assetRef.current.meta;
					if (!meta) return;
					const frames = meta.clips[clip] && meta.clips[clip].length ? meta.clips[clip] : meta.clips.idle;
					engine.clip = clip;
					engine.frames = frames;
					engine.frame = 0;
					engine.acc = 0;
					if (mode) engine.mode = mode;
				}, []);

				const wake = useCallback(() => {
					const engine = engineRef.current;
					if (!engine) return;
					engine.lastInteract = performance.now();
					if (engine.mode === "sleep") {
						setClip(engine, "idle", "idle");
						engine.nextClipAt = performance.now() + 8000 + Math.random() * 6000;
					}
				}, [setClip]);

				const reactNow = useCallback((useVoice = true) => {
					const engine = engineRef.current;
					const current = assetRef.current;
					if (!engine || !current) return;
					engine.lastInteract = performance.now();
					setClip(engine, "react", "react");
					engine.reactUntil = performance.now() + (engine.frames.length / CLIP_FPS.react) * 1000 + 350;
					say(Core.pick(LINES[current.meta.id] || LINES.yui));
					if (useVoice) playVoice(current.meta);
				}, [playVoice, say, setClip]);

				const triggerClick = useCallback(() => reactNow(true), [reactNow]);

				const triggerDouble = useCallback(() => {
					const engine = engineRef.current;
					if (!engine) return;
					const now = performance.now();
					if (now - lastDoubleAt.current < 400) return;
					lastDoubleAt.current = now;
					reactNow(false);
					const line = Core.pick(LINES[(assetRef.current && assetRef.current.meta.id) || member.id] || []);
					say(`❤ ${line}`, 4600);
				}, [member.id, reactNow, say]);

				// 初始位置：恢复该角色上次位置，否则按当前可见数量排在右下角。
				useEffect(() => {
					const limit = bounds(size);
					const fallback = Core.defaultPosition(size, index, count, window.innerWidth, window.innerHeight);
					const x = storedX === null || storedY === null ? fallback.x : storedX;
					const y = storedX === null || storedY === null ? fallback.y : storedY;
					posRef.current = {
						x: Core.clamp(x, 2, limit.maxX),
						y: Core.clamp(y, 2, limit.maxY),
					};
					syncTransform();
				}, [storedX, storedY, index, count, size, bounds, syncTransform]);

				useEffect(() => {
					const onResize = () => {
						const limit = bounds(size);
						posRef.current.x = Core.clamp(posRef.current.x, 2, limit.maxX);
						posRef.current.y = Core.clamp(posRef.current.y, 2, limit.maxY);
						syncTransform();
					};
					window.addEventListener("resize", onResize);
					return () => window.removeEventListener("resize", onResize);
				}, [bounds, size, syncTransform]);

				useEffect(() => {
					injectStyle();
					return () => {
						clearTimeout(bubbleTimer.current);
						clearTimeout(clickTimer.current);
						if (audioRef.current) {
							audioRef.current.pause();
							audioRef.current.src = "";
						}
					};
				}, []);

				useEffect(() => {
					const query = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
					if (!query) return;
					const update = () => { reduceMotion.current = query.matches; };
					update();
					if (query.addEventListener) query.addEventListener("change", update);
					else if (query.addListener) query.addListener(update);
					return () => {
						if (query.removeEventListener) query.removeEventListener("change", update);
						else if (query.removeListener) query.removeListener(update);
					};
				}, []);

				useEffect(() => {
					const onVisibility = () => {
						if (document.hidden && audioRef.current) audioRef.current.pause();
					};
					document.addEventListener("visibilitychange", onVisibility);
					return () => document.removeEventListener("visibilitychange", onVisibility);
				}, []);

				// 加载该角色的素材。
				useEffect(() => {
					let alive = true;
					setAsset(null);
					setAssetError("");
					const base = `${ASSET_BASE}/characters/${member.id}`;
					fetch(`${base}/meta.json?v=${ASSET_REV}`, { cache: "no-cache" })
						.then((response) => {
							if (!response.ok) throw new Error(`素材清单加载失败（HTTP ${response.status}）`);
							return response.json();
						})
						.then((meta) => new Promise((resolve, reject) => {
							const image = new Image();
							image.decoding = "async";
							image.onload = () => resolve({ meta, image });
							image.onerror = () => reject(new Error("立绘 sheet.png 加载失败"));
							image.src = `${base}/sheet.png?v=${ASSET_REV}`;
						}))
						.then((next) => {
							if (!alive) return;
							assetRef.current = next;
							setAsset(next);
						})
						.catch((error) => {
							if (!alive) return;
							setAssetError(error instanceof Error ? error.message : String(error));
						});
					return () => {
						alive = false;
					};
				}, [member.id]);

				// 行为开关变化时重置对应计时，避免刚打开就立刻触发。
				useEffect(() => {
					const engine = engineRef.current;
					if (!engine) return;
					const now = performance.now();
					if (settings.chatter) engine.nextTalkAt = now + TALK_EVERY[0] + Math.random() * (TALK_EVERY[1] - TALK_EVERY[0]);
					if (settings.care) engine.nextCareAt = now + CARE_EVERY;
				}, [settings.chatter, settings.care]);

				// 主循环：动画、物理、睡眠、定时提醒。行为开关从 settingsRef 读取，不重启循环。
				useEffect(() => {
					if (!asset) return;
					const canvas = canvasRef.current;
					if (!canvas) return;
					const ctx = canvas.getContext("2d");
					if (!ctx) return;
					const meta = asset.meta;
					const image = asset.image;
					const engine = {
						mode: "idle",
						clip: "idle",
						frames: meta.clips.idle,
						frame: 0,
						acc: 0,
						lastInteract: performance.now(),
						nextClipAt: performance.now() + 7000 + Math.random() * 5000,
						nextTalkAt: performance.now() + TALK_EVERY[0] + Math.random() * (TALK_EVERY[1] - TALK_EVERY[0]),
						nextCareAt: performance.now() + CARE_EVERY,
						reactUntil: 0,
						vx: 0,
						vy: 0,
						sleepAnnounced: false,
					};
					engineRef.current = engine;
					assetRef.current = asset;

					const savePosition = () => {
						const { x, y } = posRef.current;
						updateSettings((current) => ({
							...current,
							positions: {
								...current.positions,
								[member.id]: { x: Math.round(x), y: Math.round(y) },
							},
						}));
					};

					const step = (dt, now) => {
						const current = settingsRef.current;
						const actorSize = Math.round(CELL * current.scale);
						const limit = Core.boundsFor(window.innerWidth, window.innerHeight, actorSize);
						const pointer = pointerRef.current;

						if (engine.mode === "drag" && pointer) {
							const target = reduceMotion.current ? 0 : Core.clamp(engine.vx * 0.01, -10, 10);
							rotRef.current += (target - rotRef.current) * 0.18;
						} else if (engine.mode === "throw") {
							const next = Core.stepThrow({
								x: posRef.current.x,
								y: posRef.current.y,
								vx: engine.vx,
								vy: engine.vy,
							}, dt, limit);
							posRef.current.x = next.x;
							posRef.current.y = next.y;
							engine.vx = next.vx;
							engine.vy = next.vy;
							if (next.landed) {
								setClip(engine, "idle", "idle");
								engine.nextClipAt = now + 6000 + Math.random() * 5000;
								savePosition();
							}
							const target = reduceMotion.current ? 0 : Core.clamp(engine.vx * 0.02, -12, 12);
							rotRef.current += (target - rotRef.current) * 0.15;
						} else {
							rotRef.current += (0 - rotRef.current) * 0.1;
							if (engine.mode === "react" && now >= engine.reactUntil) {
								setClip(engine, "idle", "idle");
								engine.nextClipAt = now + 7000 + Math.random() * 5000;
							} else if (engine.mode === "idle" && now - engine.lastInteract > SLEEP_AFTER) {
								setClip(engine, "sleep", "sleep");
								engine.sleepAnnounced = false;
							}
							if (engine.mode === "sleep" && !engine.sleepAnnounced) {
								engine.sleepAnnounced = true;
								say("Zzz…", 2600);
							}
							if (engine.mode === "idle") {
								if (now > engine.nextClipAt) {
									const pool = ["idle", "idleAlt", "extra"];
									setClip(engine, Core.pick(pool), "idle");
									engine.nextClipAt = now + 8000 + Math.random() * 6000;
								}
								if (current.chatter && now > engine.nextTalkAt) {
									engine.nextTalkAt = now + TALK_EVERY[0] + Math.random() * (TALK_EVERY[1] - TALK_EVERY[0]);
									say(Core.pick(LINES[meta.id] || LINES.yui));
								}
								if (current.care && now > engine.nextCareAt) {
									engine.nextCareAt = now + CARE_EVERY;
									reactNow(false);
									say(Core.pick(CARE_LINES), 6000);
								}
							} else if (engine.mode === "sleep" && now > engine.nextCareAt) {
								engine.nextCareAt = now + CARE_EVERY;
							}
						}

						syncTransform();

						const advanced = Core.advanceFrame(engine, dt, CLIP_FPS[engine.clip] || 5, engine.frames.length);
						engine.frame = advanced.frame;
						engine.acc = advanced.acc;

						const frames = engine.frames || meta.clips.idle;
						const index = frames[engine.frame % frames.length];
						const rect = Core.frameRect(index, meta.sheet.columns);
						ctx.clearRect(0, 0, CELL, CELL);
						ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, CELL, CELL);
					};

					const removeTicker = addTicker(step);
					return () => {
						removeTicker();
						if (engineRef.current === engine) engineRef.current = null;
					};
				}, [asset, member.id, reactNow, say, setClip, syncTransform]);

				const onPointerDown = useCallback((event) => {
					if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
					event.preventDefault();
					event.stopPropagation();
					setMenu(null);
					wake();
					const engine = engineRef.current;
					if (engine) engine.lastInteract = performance.now();
					const target = event.currentTarget;
					if (target && target.setPointerCapture) {
						try { target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
					}
					pointerRef.current = {
						id: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						originX: posRef.current.x,
						originY: posRef.current.y,
						lastX: event.clientX,
						lastY: event.clientY,
						lastT: performance.now(),
						vx: 0,
						vy: 0,
						moved: false,
					};
				}, [wake]);

				const onPointerMove = useCallback((event) => {
					const pointer = pointerRef.current;
					if (!pointer || pointer.id !== event.pointerId) return;
					const dx = event.clientX - pointer.startX;
					const dy = event.clientY - pointer.startY;
					if (!pointer.moved && Math.hypot(dx, dy) > 4) {
						pointer.moved = true;
						const engine = engineRef.current;
						if (engine) setClip(engine, "held", "drag");
						if (actorRef.current) actorRef.current.classList.add("is-drag");
					}
					if (!pointer.moved) return;
					const now = performance.now();
					const elapsed = Math.max(1, now - pointer.lastT);
					pointer.vx = ((event.clientX - pointer.lastX) / elapsed) * 1000;
					pointer.vy = ((event.clientY - pointer.lastY) / elapsed) * 1000;
					pointer.lastX = event.clientX;
					pointer.lastY = event.clientY;
					pointer.lastT = now;
					const limit = bounds();
					posRef.current.x = Core.clamp(pointer.originX + dx, 2, limit.maxX);
					posRef.current.y = Core.clamp(pointer.originY + dy, 2, limit.maxY);
					const engine = engineRef.current;
					if (engine) engine.vx = pointer.vx;
					syncTransform();
				}, [bounds, setClip, syncTransform]);

				const onPointerUp = useCallback((event) => {
					const pointer = pointerRef.current;
					if (!pointer || pointer.id !== event.pointerId) return;
					pointerRef.current = null;
					const engine = engineRef.current;
					if (actorRef.current) actorRef.current.classList.remove("is-drag");
					if (!pointer.moved) {
						const now = performance.now();
						const isDouble = now - lastClickAt.current < 340;
						lastClickAt.current = isDouble ? 0 : now;
						clearTimeout(clickTimer.current);
						if (isDouble) {
							triggerDouble();
							return;
						}
						clickTimer.current = window.setTimeout(() => triggerClick(), 190);
						return;
					}
					const now = performance.now();
					const idleFor = now - pointer.lastT;
					const speed = Math.hypot(pointer.vx || 0, pointer.vy || 0);
					const fling = idleFor < 120 && speed >= 260;
					// Slow drags can finish on the table; seat before persisting the
					// free position so the actor disappears into its table pose.
					if (!fling && onDropSeat && onDropSeat(member.id, posRef.current)) return;
					if (engine) {
						if (fling) {
							engine.mode = "throw";
							engine.vx = Core.clamp(pointer.vx || 0, -2600, 2600);
							engine.vy = Core.clamp(pointer.vy || 0, -2600, 2600);
						} else {
							// A plain drag should stop where the pointer stopped;
							// only a deliberate flick starts the falling animation.
							engine.mode = "idle";
							engine.vx = 0;
							engine.vy = 0;
							engine.lastInteract = now;
							engine.nextClipAt = now + 6000 + Math.random() * 5000;
							rotRef.current = 0;
							syncTransform();
							setClip(engine, "idle", "idle");
						}
					}
					updateSettings((current) => ({
						...current,
						positions: {
							...current.positions,
							[member.id]: { x: Math.round(posRef.current.x), y: Math.round(posRef.current.y) },
						},
					}));
				}, [member.id, setClip, syncTransform, triggerClick, triggerDouble]);

				const onDoubleClick = useCallback((event) => {
					event.preventDefault();
					event.stopPropagation();
					clearTimeout(clickTimer.current);
					triggerDouble();
				}, [triggerDouble]);

				const openMenu = useCallback((event) => {
					if (event) {
						event.preventDefault();
						event.stopPropagation();
					}
					const { x, y } = posRef.current;
					const width = 236;
					const height = 252;
					const left = Core.clamp(x + size - width, 8, Math.max(8, window.innerWidth - width - 8));
					const top = y > height + 28
						? y - height - 8
						: Core.clamp(y + size + 8, 8, Math.max(8, window.innerHeight - height - 8));
					setMenu({ left, top });
				}, [size]);

				const resetPos = useCallback(() => {
					const engine = engineRef.current;
					if (engine) {
						engine.mode = "idle";
						engine.vx = 0;
						engine.vy = 0;
						engine.nextClipAt = performance.now() + 7000 + Math.random() * 5000;
						setClip(engine, "idle", "idle");
					}
					updateSettings((current) => {
						const positions = { ...current.positions };
						delete positions[member.id];
						return { ...current, positions };
					});
					setMenu(null);
					say("回到右下角啦～", 2200);
				}, [member.id, say, setClip]);

				const onWindowDown = useCallback((event) => {
					if (!menu) return;
					const node = menuRef.current;
					if (node && node.contains(event.target)) return;
					setMenu(null);
				}, [menu]);

				useEffect(() => {
					if (!menu) return;
					window.addEventListener("pointerdown", onWindowDown, true);
					return () => window.removeEventListener("pointerdown", onWindowDown, true);
				}, [menu, onWindowDown]);

				useEffect(() => {
					if (!menu) return;
					const node = menuRef.current;
					const first = node && node.querySelector("button");
					if (first) first.focus();
					const onKey = (event) => {
						if (event.key !== "Escape") return;
						setMenu(null);
						if (actorRef.current) actorRef.current.focus();
					};
					window.addEventListener("keydown", onKey);
					return () => window.removeEventListener("keydown", onKey);
				}, [menu]);

				if (assetError) {
					return h("div", {
						className: "konp-fallback",
						title: assetError,
					}, `${member.name}素材加载失败：${assetError}`);
				}

				return h(React.Fragment, null,
					h("div", {
						ref: actorRef,
						className: "konp-actor",
						style: { width: size, height: size },
						role: "button",
						tabIndex: 0,
						"aria-label": `${member.name}桌宠：拖动移动，双击说话，右键打开设置`,
						title: `${member.name} · 拖动我 · 双击说话 · 右键设置`,
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel: onPointerUp,
						onDoubleClick,
						onContextMenu: openMenu,
						onKeyDown: (event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								triggerClick();
							} else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
								event.preventDefault();
								openMenu(event);
							}
						},
						onDragStart: (event) => event.preventDefault(),
					},
						h("canvas", {
							ref: canvasRef,
							className: "konp-canvas",
							width: CELL,
							height: CELL,
							"aria-hidden": "true",
						}),
						bubble ? h("div", {
							key: bubble.key,
							className: "konp-bubble",
							role: "status",
							"aria-live": "polite",
						}, bubble.text) : null,
						h("button", {
							className: "konp-gear",
							type: "button",
							"aria-label": "桌宠设置",
							"aria-expanded": Boolean(menu),
							"aria-haspopup": "dialog",
							title: "桌宠设置",
							onPointerDown: (event) => {
								event.preventDefault();
								event.stopPropagation();
							},
							onClick: (event) => {
								event.stopPropagation();
								openMenu(event);
							},
						}, "⚙"),
					),
					menu ? h("div", {
						ref: menuRef,
						className: "konp-menu",
						style: { left: menu.left, top: menu.top },
						role: "dialog",
						"aria-label": `${member.name}桌宠设置`,
						onPointerDown: (event) => event.stopPropagation(),
					},
						h("div", { className: "konp-menu-head" },
							h("span", null, "K-ON! 桌宠"),
							h("button", {
								className: "konp-x",
								type: "button",
								"aria-label": "关闭",
								onClick: () => setMenu(null),
							}, "×"),
						),
						h("div", { className: "konp-menu-name" }, member.name),
						h("button", {
							className: "konp-hide",
							type: "button",
							onClick: onHide,
						}, `隐藏${member.name}`),
						h("div", { className: "konp-label" }, `大小 · ${settings.scale.toFixed(1)}×`),
						h("input", {
							className: "konp-range",
							type: "range",
							min: 1,
							max: 2.4,
							step: 0.1,
							value: settings.scale,
							"aria-label": "桌宠大小",
							onChange: (event) => updateSettings({ scale: Number(event.target.value) }),
						}),
						h("div", { className: "konp-row" },
							h("span", null, "声音"),
							h("button", {
								type: "button",
								className: `konp-toggle${settings.muted ? "" : " is-on"}`,
								onClick: () => updateSettings({ muted: !settings.muted }),
							}, settings.muted ? "已静音" : "开启"),
						),
						h("button", {
							type: "button",
							className: "konp-reset",
							onClick: resetPos,
						}, "这只回到右下角"),
						h("p", { className: "konp-tip" }, "更多设置：DSH 设置 → K-ON! 桌宠"),
					) : null,
				);
			}

			function TableScene({ settings, tablePos, onTableMove, onTableCommit, onUnseat, onSeatDrop }) {
				const scale = settings.scale;
				const width = TABLE.width * scale;
				const height = TABLE.height * scale;
				const backRef = useRef(null);
				const frontRef = useRef(null);
				const grabRef = useRef(null);
				const tableDrag = useRef(null);
				const seatDrag = useRef(null);
				const cleanupRef = useRef(() => {});
				const [dragging, setDragging] = useState(false);
				const [ghost, setGhost] = useState(null);
				const [failed, setFailed] = useState(false);

				useEffect(() => () => cleanupRef.current(), []);

				useEffect(() => {
					const back = backRef.current && backRef.current.getContext("2d");
					const front = frontRef.current && frontRef.current.getContext("2d");
					if (!back || !front) return undefined;
					const desk00 = new Image();
					const desk01 = new Image();
					let ready00 = false;
					let ready01 = false;
					let acc = 0;
					let frame = 0;
					const drawBack = () => {
						if (!ready00) return;
						const frames = Math.max(1, Math.floor(desk00.naturalWidth / TABLE.width));
						frame %= frames;
						back.clearRect(0, 0, TABLE.width, TABLE.height);
						back.drawImage(desk00, frame * TABLE.width, 0, TABLE.width, TABLE.height, 0, 0, TABLE.width, TABLE.height);
					};
					const drawFront = () => {
						if (!ready01) return;
						front.clearRect(0, 0, TABLE.width, TABLE.height);
						front.drawImage(desk01, 0, 0);
					};
					desk00.onload = () => { ready00 = true; drawBack(); };
					desk01.onload = () => { ready01 = true; drawFront(); };
					desk00.onerror = () => setFailed(true);
					desk01.onerror = () => setFailed(true);
					desk00.src = `${ASSET_BASE}/table/desk00.png?v=${ASSET_REV}`;
					desk01.src = `${ASSET_BASE}/table/desk01.png?v=${ASSET_REV}`;
					const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
					const removeTicker = reduce ? () => {} : addTicker((dt) => {
						if (!ready00 || window.document.hidden) return;
						acc += dt;
						const interval = 1 / Math.max(1, TABLE.fps);
						while (acc >= interval) {
							acc -= interval;
							frame += 1;
						}
						drawBack();
					});
					return () => {
						removeTicker();
						desk00.onload = null;
						desk01.onload = null;
					};
				}, []);

				const onGrabDown = (event) => {
					if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
					event.preventDefault();
					event.stopPropagation();
					const element = event.currentTarget;
					if (element.setPointerCapture) {
						try { element.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
					}
					tableDrag.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						originX: tablePos.x,
						originY: tablePos.y,
					};
					setDragging(true);
				};
				const onGrabMove = (event) => {
					const drag = tableDrag.current;
					if (!drag || drag.pointerId !== event.pointerId) return;
					onTableMove(drag.originX + event.clientX - drag.startX, drag.originY + event.clientY - drag.startY);
				};
				const onGrabUp = (event) => {
					const drag = tableDrag.current;
					if (!drag || drag.pointerId !== event.pointerId) return;
					tableDrag.current = null;
					setDragging(false);
					onTableCommit();
				};

				const onSeatDown = (event, seat) => {
					if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
					event.preventDefault();
					event.stopPropagation();
					if (seatDrag.current) return;
					const drag = {
						id: seat.id,
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						moved: false,
						width: TABLE.charWidth * scale,
						height: TABLE.charHeight * scale,
					};
					seatDrag.current = drag;
					const move = (moveEvent) => {
						if (moveEvent.pointerId !== drag.pointerId) return;
						const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
						if (!drag.moved && distance > 4) {
							drag.moved = true;
							onUnseat(drag.id);
						}
						if (!drag.moved) return;
						setGhost({ id: drag.id, x: moveEvent.clientX - drag.width / 2, y: moveEvent.clientY - drag.height / 2 });
					};
					const cleanup = () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						window.removeEventListener("pointercancel", up);
						seatDrag.current = null;
						setGhost(null);
						cleanupRef.current = () => {};
					};
					const up = (upEvent) => {
						if (upEvent.pointerId !== drag.pointerId) return;
						const moved = drag.moved;
						const x = upEvent.clientX - drag.width / 2;
						const y = upEvent.clientY - drag.height / 2;
						cleanup();
						if (moved) onSeatDrop(drag.id, x, y);
					};
					cleanupRef.current = cleanup;
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
					window.addEventListener("pointercancel", up);
				};

				return h("div", {
					className: `konp-table${dragging ? " is-drag" : ""}`,
					style: {
						width: `${width}px`,
						height: `${height}px`,
						zIndex: 2147482000,
						pointerEvents: "none",
						transform: `translate3d(${tablePos.x}px, ${tablePos.y}px, 0)`,
					},
					"aria-hidden": failed ? "true" : undefined,
				},
					h("canvas", { ref: backRef, width: TABLE.width, height: TABLE.height, className: "konp-table-canvas konp-table-back", style: { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" } }),
					h("div", {
						ref: grabRef,
						className: "konp-table-grab",
						style: { position: "absolute", left: 0, right: 0, zIndex: 1, pointerEvents: "auto", top: `${TABLE.charHeight * scale}px`, height: `${(TABLE.height - TABLE.charHeight) * scale}px` },
						onPointerDown: onGrabDown,
						onPointerMove: onGrabMove,
						onPointerUp: onGrabUp,
						onPointerCancel: onGrabUp,
						role: "presentation",
					}),
					TABLE.seats.map((seat) => {
						if (!settings.visible[seat.id] || !settings.seats[seat.id]) return null;
						return h("img", {
							key: seat.id,
							className: "konp-table-seat",
							src: `${ASSET_BASE}/table/${seat.id}.png?v=${ASSET_REV}`,
							alt: "",
							draggable: false,
							style: {
								position: "absolute",
								zIndex: 2,
								pointerEvents: "auto",
								left: `${seat.x * scale}px`,
								top: `${TABLE.charTop * scale}px`,
								width: `${TABLE.charWidth * scale}px`,
								height: `${TABLE.charHeight * scale}px`,
								transform: seat.mirror ? "scaleX(-1)" : undefined,
							},
							onPointerDown: (event) => onSeatDown(event, seat),
						});
					}),
					h("canvas", { ref: frontRef, width: TABLE.width, height: TABLE.height, className: "konp-table-canvas konp-table-front", style: { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" } }),
					ghost ? h("img", {
						className: "konp-table-ghost",
						src: `${ASSET_BASE}/table/${ghost.id}.png?v=${ASSET_REV}`,
						alt: "",
						draggable: false,
						style: {
							left: `${ghost.x}px`,
							top: `${ghost.y}px`,
							width: `${TABLE.charWidth * scale}px`,
							height: `${TABLE.charHeight * scale}px`,
						},
					}) : null,
					failed ? h("div", { className: "konp-fallback" }, "桌子素材加载失败") : null,
				);
			}

			function KOnPet() {
				const settings = useSettings();
				const [tablePos, setTablePos] = useState(() => (
					settings.tablePos
						? Core.clampTablePosition(settings.tablePos.x, settings.tablePos.y, settings.scale, window.innerWidth, window.innerHeight)
						: Core.tableDefaultPosition(settings.scale, window.innerWidth, window.innerHeight)
				));
				const tableRef = useRef(tablePos);
				tableRef.current = tablePos;

				useEffect(() => {
					const next = settings.tablePos
						? Core.clampTablePosition(settings.tablePos.x, settings.tablePos.y, settings.scale, window.innerWidth, window.innerHeight)
						: Core.tableDefaultPosition(settings.scale, window.innerWidth, window.innerHeight);
					setTablePos(next);
				}, [settings.tablePos, settings.table, settings.scale]);

				useEffect(() => {
					const onResize = () => setTablePos((current) => Core.clampTablePosition(
						current.x, current.y, settings.scale, window.innerWidth, window.innerHeight,
					));
					window.addEventListener("resize", onResize);
					return () => window.removeEventListener("resize", onResize);
				}, [settings.scale]);

				const visible = ROSTER.filter((member) => settings.visible[member.id]);
				const seated = settings.table ? settings.seats : {};
				const standing = visible.filter((member) => !seated[member.id]);

				const onDropSeat = (id, position) => {
					if (!settings.table) return false;
					const size = CELL * settings.scale;
					const seat = Core.tableSeatAt(
						position.x + size / 2,
						position.y + size / 2,
						tableRef.current.x,
						tableRef.current.y,
						settings.scale,
					);
					if (!seat || seat.id !== id) return false;
					updateSettings((current) => ({
						...current,
						seats: { ...current.seats, [id]: true },
					}));
					return true;
				};

				const onUnseat = (id) => {
					const seat = TABLE.seats.find((item) => item.id === id);
					if (!seat) return;
					const scale = settings.scale;
					const x = tableRef.current.x + (seat.x + TABLE.charWidth / 2) * scale - (CELL * scale) / 2;
					const y = tableRef.current.y + (TABLE.height - CELL) * scale;
					updateSettings((current) => ({
						...current,
						seats: { ...current.seats, [id]: false },
						positions: {
							...current.positions,
							[id]: { x: Math.round(x), y: Math.round(y) },
						},
					}));
				};

				const onSeatDrop = (id, x, y) => {
					const size = CELL * settings.scale;
					const seat = Core.tableSeatAt(
						x + size / 2,
						y + size / 2,
						tableRef.current.x,
						tableRef.current.y,
						settings.scale,
					);
					if (seat && seat.id === id) {
						updateSettings((current) => ({
							...current,
							seats: { ...current.seats, [id]: true },
						}));
						return;
					}
					updateSettings((current) => ({
						...current,
						positions: { ...current.positions, [id]: { x: Math.round(x), y: Math.round(y) } },
					}));
				};

				return h("div", { className: "konp-root" },
					settings.table ? h(TableScene, {
						settings,
						tablePos,
						onTableMove: (x, y) => setTablePos(Core.clampTablePosition(x, y, settings.scale, window.innerWidth, window.innerHeight)),
						onTableCommit: () => updateSettings((current) => ({
							...current,
							tablePos: { x: tableRef.current.x, y: tableRef.current.y },
						})),
						onUnseat,
						onSeatDrop,
					}) : null,
					standing.map((member) => h(PetActor, {
						key: member.id,
						member,
						settings,
						index: visible.indexOf(member),
						count: visible.length,
						onHide: () => updateSettings((current) => ({
							...current,
							visible: { ...current.visible, [member.id]: false },
							seats: { ...current.seats, [member.id]: false },
						})),
						onDropSeat,
					})),
				);
			}

			const name = "dsh-k-on-pet";
			const inject = ["slots"];

			function apply(ctx) {
				ctx.slots.inject("shell.overlay", function* () {
					yield ctx.slots.register({
						name: "shell.overlay",
						id: "dsh-k-on-pet",
						order: 900,
					}, KOnPet);
				});
				ctx.slots.inject("settings.section", function* () {
					yield ctx.slots.register({
						name: "settings.section",
						id: "k-on-pet",
						order: 60,
						label: () => "K-ON! 桌宠",
					}, KOnPetSettings);
				});
			}

			return { apply, inject, name };
		},
	});
})();
