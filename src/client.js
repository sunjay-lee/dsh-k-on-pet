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
				WALK_SPEED,
				WALK_EVERY,
				ROSTER,
				LINES,
				CARE_LINES,
				CLIP_FPS,
			} = Core;
			const normalizeSettings = Core.normalizeSettings;
			// 各角色实时位置：供「跟随」行为读取，避免引入全局状态管理。
			const PEERS = new Map();
			// 谁跟着谁：律跟澪、唯跟梓（"喵"=梓）；䌷在大家都待久了时随机跟一队。
			const FOLLOW_TARGET = { ritsu: "mio", yui: "azusa" };
			// 反向追逐：偶尔换成被追的人反过来追（随机出现，不提供设置）
			const REVERSE_TARGET = { mio: "ritsu", azusa: "yui" };
			// 被追的人先“愣住”不动，等追的人跑过来（id -> 解冻时间）
			const FREEZE = new Map();
			// 按设置挑选台词语言：zh 中文 / ja 日文 / both 双语
			const pickLang = (entry, lang) => {
				if (!entry) return "";
				if (lang === "ja") return entry.ja || entry.zh || "";
				if (lang === "both") return [entry.ja, entry.zh].filter(Boolean).join("\n");
				return entry.zh || entry.ja || "";
			};
			const tableDefaultPosition = Core.tableDefaultPosition;
			const clampTablePosition = Core.clampTablePosition;
			const tableSeatAt = Core.tableSeatAt;
			const tableContainsPoint = Core.tableContainsPoint;

			// 素材已按"原版行动作表的行序"重建，每个角色用哪一行写在 meta.json 的 actions 里，
			// 代码不再维护行号表。原版行序：1/2 = 左/右步态；其余按角色各自内容（见改动说明）。
			// 开发者模式写入的动作覆盖：只在内存里生效，不改素材文件
			let ACTION_OVERRIDES = {};
			let CUSTOM_ASSETS = true;
			const actionsOf = (meta) => {
				const base = (meta && meta.actions && typeof meta.actions === "object")
					? meta.actions
					// 兼容没有 actions 的旧素材
					: { idle: 0, walkLeft: 4, walkRight: 5, react: 6, sleep: 1, held: 2 };
				const override = meta && ACTION_OVERRIDES[meta.id];
				return override ? { ...base, ...override } : base;
			};

			const rowFrames = (meta, row) => {
				if (!meta || !Array.isArray(meta.cells) || row === undefined || row === null) return [];
				const ordered = meta.frameOrder && meta.frameOrder[row];
				if (Array.isArray(ordered) && ordered.length) {
					const byIndex = new Map(meta.cells.map((cell) => [cell.index, cell]));
					return ordered.filter((index) => {
						const cell = byIndex.get(index);
						const box = cell && cell.bbox;
						return box && box[2] - box[0] >= 20 && box[3] - box[1] >= 40;
					});
				}
				const cols = meta.sheet.columns;
				return meta.cells
					.filter((cell) => Math.floor(cell.index / cols) === row)
					.filter((cell) => {
						const box = cell.bbox;
						// 和 build-meta.py 的 valid() 保持一致：跳过只留一小条的过渡格。
						return box && box[2] - box[0] >= 20 && box[3] - box[1] >= 40;
					})
					.sort((a, b) => a.index - b.index)
					.map((cell) => cell.index);
			};

			// 待机 = 该角色原地不动的可爱动作循环。
			const idleFrames = (meta) => {
				const rows = rowFrames(meta, actionsOf(meta).idle);
				if (rows.length) return rows;
				const clips = meta.clips || {};
				return clips.react && clips.react.length ? clips.react : (clips.idle || [0]);
			};

			// 走路帧：向左用 walkLeft 行、向右用 walkRight 行（原版就是两个方向各一套）。
			// facingFlipped 把左右两行对调，用来现场纠正方向。
			const walkFrames = (meta, dir = -1, flipped = false) => {
				const actions = actionsOf(meta);
				const wantLeft = dir < 0;
				const useLeft = Boolean(flipped) ? !wantLeft : wantLeft;
				const row = useLeft ? actions.walkLeft : actions.walkRight;
				const frames = rowFrames(meta, row);
				if (frames.length) return frames;
				const clips = meta.clips || {};
				return clips[useLeft ? "walkLeft" : "walkRight"] || clips.idle || [0];
			};

			const CSS = `
.konp-root{position:fixed;inset:0;z-index:2147482000;pointer-events:none;font-family:inherit}
.konp-actor{position:absolute;left:0;top:0;z-index:2147482001;pointer-events:auto;cursor:grab;touch-action:none;will-change:transform;user-select:none;-webkit-user-select:none}
.konp-actor.is-drag{cursor:grabbing}
.konp-actor:focus-visible{outline:2px solid #8a6aa8;outline-offset:4px;border-radius:12px}
.konp-canvas{display:block;width:100%;height:100%;image-rendering:pixelated;transform-origin:50% 88%;filter:drop-shadow(0 5px 8px rgba(0,0,0,.13));transition:filter .2s ease}
.konp-actor:hover .konp-canvas{filter:drop-shadow(0 7px 12px rgba(0,0,0,.18))}
.konp-bubble{position:absolute;bottom:calc(100% - 6px);left:50%;transform:translateX(-50%);min-width:96px;max-width:230px;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,.97);color:#3a3340;font-size:12px;line-height:1.55;text-align:center;white-space:pre-wrap;box-shadow:0 6px 22px rgba(40,30,50,.18);border:1px solid rgba(70,55,80,.10);animation:konp-pop .18s cubic-bezier(.2,1.4,.4,1);pointer-events:none}
.konp-bubble:after{content:"";position:absolute;left:50%;top:100%;width:10px;height:10px;margin-left:-5px;margin-top:-5px;background:inherit;border-right:1px solid rgba(70,55,80,.10);border-bottom:1px solid rgba(70,55,80,.10);transform:rotate(45deg)}
.konp-gear{position:absolute;right:2px;top:2px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(255,255,255,.92);color:#6b6273;font-size:12px;line-height:20px;padding:0;cursor:pointer;opacity:0;transition:opacity .15s ease;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.konp-actor:hover .konp-gear,.konp-gear:focus-visible{opacity:1}
.konp-menu{position:fixed;z-index:2147483600;width:236px;padding:12px;border-radius:16px;background:rgba(255,255,255,.98);color:#3a3340;border:1px solid rgba(70,55,80,.12);box-shadow:0 18px 50px rgba(35,25,45,.22);pointer-events:auto;font-size:12px;animation:konp-pop .16s cubic-bezier(.2,1.4,.4,1)}
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
.konp-dev-card{border:1px solid rgba(127,127,127,.2);border-radius:12px;padding:8px 12px;margin:8px 0}
.konp-dev-toggle{border:0;background:transparent;font-weight:600;font-size:13px;cursor:pointer;padding:2px 0;color:inherit}
.konp-dev-head{padding:2px 0 6px;font-size:13px;font-weight:600}
.konp-dev-body{display:flex;flex-direction:column;gap:10px}
.konp-dev-main{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}
.konp-dev-grid{display:grid;grid-template-columns:repeat(2,minmax(170px,1fr));gap:6px 14px}
.konp-dev-item{display:flex;align-items:center;gap:8px;font-size:12px}
.konp-dev-item span{width:34px;opacity:.7}
.konp-dev-item select{flex:1;min-width:110px;border-radius:6px;padding:2px 4px}
.konp-dev-preview{display:flex;flex-direction:column;align-items:center;gap:4px}
.konp-dev-rows{padding-top:8px;border-top:1px dashed rgba(127,127,127,.2);margin-top:6px;display:flex;flex-direction:column;gap:6px}
.konp-dev-rowgrid{display:flex;flex-wrap:wrap;gap:6px}
.konp-dev-rowbtn{display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;border:1px solid rgba(127,127,127,.25);border-radius:8px;background:transparent;cursor:pointer;font-size:11px}
.konp-dev-rowbtn.active{border-color:rgba(127,127,127,.75);background:rgba(127,127,127,.1)}
.konp-dev-rowbtn canvas{image-rendering:pixelated;background:rgba(127,127,127,.08);border-radius:4px}
.konp-dev-order{padding-top:8px;border-top:1px dashed rgba(127,127,127,.2);margin-top:6px;display:flex;flex-direction:column;gap:6px;flex:1 1 300px;min-width:0}
.konp-dev-orderlist{display:flex;flex-wrap:wrap;gap:6px}
.konp-dev-frame{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 10px;border:1px solid rgba(127,127,127,.35);border-radius:8px;font-size:12px;cursor:grab;background:rgba(127,127,127,.08)}
.konp-dev-frame.active{border-color:rgba(127,127,127,.9);background:rgba(127,127,127,.18)}
.konp-dev-frame.is-empty{border-style:dashed;opacity:.65}
.konp-dev-frame canvas{image-rendering:pixelated;background:rgba(127,127,127,.1);border-radius:4px}
.konp-dev-frame-del{position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:16px;height:16px;font-size:10px;line-height:1;cursor:pointer;background:#e55;color:#fff}
.konp-dev-added{display:flex;gap:12px;align-items:center;padding-top:8px;border-top:1px dashed rgba(127,127,127,.2);margin-top:6px}
.konp-dev-added canvas{image-rendering:pixelated;background:rgba(127,127,127,.08);border-radius:10px}
.konp-dev-sheet{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px dashed rgba(127,127,127,.2);margin-top:6px}
.konp-dev-name{display:flex;align-items:center;gap:8px;font-size:12px}
.konp-dev-name span{width:34px;opacity:.7}
.konp-dev-name input{flex:1;max-width:280px;border-radius:6px;padding:4px 8px}
.konp-dev-name input:disabled{opacity:.5}
.konp-dev-sheet-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.konp-dev-radio{display:flex;align-items:center;gap:5px;font-size:12px;opacity:.85}
.konp-dev-thumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.konp-dev-draft{position:relative;display:inline-flex}
.konp-dev-del{position:absolute;top:-6px;right:-6px;border:0;border-radius:50%;width:16px;height:16px;font-size:10px;line-height:1;cursor:pointer;background:#e55;color:#fff}
.konp-dev-thumbs img{border-radius:6px;background:rgba(127,127,127,.12);image-rendering:pixelated}
.konp-dev-hint{font-size:11px;opacity:.6}
.konp-dev-num{display:flex;align-items:center;gap:4px;font-size:11px;opacity:.8}
.konp-dev-num input{width:56px;border-radius:6px;padding:2px 4px}
.konp-dev-preview canvas{background:rgba(127,127,127,.08);border-radius:10px;image-rendering:pixelated}
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
.konp-table-grab{position:absolute;inset:0;z-index:5;cursor:grab;touch-action:none}
.konp-table.is-drag .konp-table-grab{cursor:grabbing}
.konp-table.is-locked .konp-table-grab{cursor:default}
.konp-table-seat{position:absolute;display:block;image-rendering:pixelated;pointer-events:none;touch-action:none;filter:drop-shadow(0 3px 5px rgba(0,0,0,.12))}
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

			const seatGhostCache = new Map();
			function loadSeatGhost(id) {
				if (seatGhostCache.has(id)) return seatGhostCache.get(id);
				const metaPromise = fetch(`${ASSET_BASE}/characters/${id}/meta.json?v=${ASSET_REV}`)
					.then((response) => {
						if (!response.ok) throw new Error(`meta ${response.status}`);
						return response.json();
					});
				const imagePromise = new Promise((resolve, reject) => {
					const image = new Image();
					image.onload = () => resolve(image);
					image.onerror = () => reject(new Error(`sheet ${id}`));
					image.src = `${ASSET_BASE}/characters/${id}/sheet.png?v=${ASSET_REV}`;
				});
				const promise = Promise.all([metaPromise, imagePromise])
					.then(([meta, image]) => ({ meta, image }))
					.catch((error) => {
						seatGhostCache.delete(id);
						throw error;
					});
				seatGhostCache.set(id, promise);
				return promise;
			}

			// 从座位拖出时恢复角色自己的 held 抓取帧，按 96x96 原始比例显示。
			function SeatGhost({ id, x, y, width, height }) {
				const canvasRef = useRef(null);
				const [asset, setAsset] = useState(null);
				useEffect(() => {
					let active = true;
					loadSeatGhost(id).then((value) => { if (active) setAsset(value); }).catch(() => {});
					return () => { active = false; };
				}, [id]);
				useEffect(() => {
					const canvas = canvasRef.current;
					if (!canvas || !asset) return;
					const { meta, image } = asset;
					const columns = meta.sheet.columns;
					const frames = meta.clips.held;
					const ctx = canvas.getContext("2d");
					let frame = 0;
					let acc = 0;
					const draw = () => {
						const index = frames[frame % frames.length];
						const rect = Core.frameRect(index, columns);
						ctx.clearRect(0, 0, CELL, CELL);
						ctx.drawImage(image, rect.sx, rect.sy, CELL, CELL, 0, 0, CELL, CELL);
					};
					draw();
					return addTicker((dt) => {
						acc += dt;
						const step = 1 / (CLIP_FPS.held || 6);
						while (acc >= step) {
							acc -= step;
							frame += 1;
						}
						draw();
					});
				}, [asset]);
				if (!asset) {
					return h("img", {
						className: "konp-table-ghost",
						src: `${ASSET_BASE}/table/${id}.png?v=${ASSET_REV}`,
						alt: "",
						draggable: false,
						style: { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`, objectFit: "contain" },
					});
				}
				return h("canvas", {
					ref: canvasRef,
					width: CELL,
					height: CELL,
					className: "konp-table-ghost",
					style: {
						position: "fixed",
						left: `${x}px`,
						top: `${y}px`,
						width: `${width}px`,
						height: `${height}px`,
						zIndex: 2147482600,
						pointerEvents: "none",
						imageRendering: "pixelated",
						filter: "drop-shadow(0 8px 12px rgba(0,0,0,.18))",
					},
				});
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

			function styleElement() {
				// 设置分区第一次挂载时，head 里的样式可能还没生效；把同一份 CSS
				// 放进组件树，保证首屏就是最终样式（light DOM / shadow DOM 都适用）。
				return h("style", { "data-konp-style": "inline", dangerouslySetInnerHTML: { __html: CSS } });
			}

			// 导入后的图集：官方行沿用原 cells，追加行按「该动作自己的帧数」标记有效格
			const withCustomSheet = (meta, custom) => {
				const cols = custom.cols;
				const officialRows = custom.officialRows ?? meta.sheet.rows;
				const cells = (meta.cells || []).filter((cell) => Math.floor(cell.index / meta.sheet.columns) < officialRows);
				// 空帧（null）也占一格，编辑器里要能看到空格；播放时由 frameOrder 过滤掉
				const slots = new Map();
				for (const anim of (custom.anims || [])) {
					slots.set(anim.row, Array.isArray(anim.frames) ? anim.frames.length : 0);
				}
				for (let row = officialRows; row < custom.rows; row += 1) {
					const total = slots.get(row) || 0;
					for (let col = 0; col < cols; col += 1) {
						cells.push({ index: row * cols + col, bbox: col < total ? [0, 0, 96, 96] : [0, 0, 0, 0] });
					}
				}
				const frameOrder = {};
				for (const anim of (custom.anims || [])) {
					const base = anim.row * cols;
					const list = Array.isArray(anim.frames) ? anim.frames : [];
					frameOrder[anim.row] = list.filter((offset) => offset !== null && offset !== undefined && offset < cols).map((offset) => base + offset);
				}
				return {
					...meta,
					sheet: { ...(meta.sheet || {}), columns: cols, rows: custom.rows, cell: 96 },
					cells,
					frameOrder,
				};
			};

			// 七个可映射的状态（开发者模式）
			const DEV_STATES = [
				["idle", "待机"], ["walkLeft", "左走"], ["walkRight", "右走"],
				["click", "单击"], ["dance", "双击"], ["sleep", "睡眠"], ["held", "拖拽"],
			];

			// 添加新动作：选图片 → 拼进图集 → 挂到当前状态上（官方行只读）
			function DevSheetImport({ member, settings, updateSettings, setHint, onAdded, onRestore, onDelete }) {
				const [busy, setBusy] = useState(false);
				const current = (settings.sheetOverrides || {})[member.id];
				const anims = (current && Array.isArray(current.anims)) ? current.anims : [];
				const fileRef = useRef(null);

				const loadOfficial = () => Promise.race([new Promise((resolve) => {
					fetch(`${ASSET_BASE}/characters/${member.id}/meta.json?v=${ASSET_REV}`)
						.then((response) => (response.ok ? response.json() : null))
						.then((meta) => {
							const img = new Image();
							img.onload = () => resolve({ meta, img });
							img.onerror = () => resolve(null);
							img.src = `${ASSET_BASE}/characters/${member.id}/sheet.png?v=${ASSET_REV}`;
						})
						.catch(() => resolve(null));
				}), new Promise((resolve) => setTimeout(() => resolve(null), 6000))]);

				const addAction = async (event) => {
					const list = Array.from(event.target.files || []);
					event.target.value = "";
					if (!list.length || busy) return;
					setBusy(true);
					setHint("正在读取图片…");
					try {
						const official = await loadOfficial();
						if (!official) { setHint("读取官方图集失败"); return; }
						const cols = official.meta.sheet.columns;
						const officialRows = official.meta.sheet.rows;
						const images = await Promise.all(list.map((file) => new Promise((resolve) => {
							const reader = new FileReader();
							reader.onload = () => {
								const img = new Image();
								img.onload = () => resolve(img);
								img.onerror = () => resolve(null);
								img.src = String(reader.result);
							};
							reader.readAsDataURL(file);
						})));
						// 一个动作占一行，行内格子按 0..cols-1 编号；多选的图片取前 cols 张
						const frames = images.filter(Boolean).slice(0, cols);
						if (!frames.length) { setHint("没有读到图片"); return; }
						const name = `动作 ${anims.length + 1}`;
						const baseRows = current ? current.rows : officialRows;
						const startRow = baseRows;
						const canvas = document.createElement("canvas");
						canvas.width = cols * 96;
						canvas.height = (startRow + 1) * 96;
						const context = canvas.getContext("2d");
						context.imageSmoothingEnabled = false;
						const base = current
							? await new Promise((resolve) => {
								const img = new Image();
								img.onload = () => resolve(img);
								img.onerror = () => resolve(official.img);
								img.src = current.src;
							})
							: official.img;
						context.drawImage(base, 0, 0);
						frames.forEach((img, index) => {
							context.drawImage(img, 0, 0, img.width, img.height, index * 96, startRow * 96, 96, 96);
						});
						const offsets = frames.map((_, index) => index);
						const src = canvas.toDataURL("image/png");
						updateSettings((now) => {
							const entry = (now.sheetOverrides || {})[member.id] || {};
							return {
								...now,
								sheetOverrides: {
									...(now.sheetOverrides || {}),
									[member.id]: {
										...entry,
										src,
										cols,
										rows: startRow + 1,
										officialRows,
										kind: "自定义",
										name,
										anims: [...(Array.isArray(entry.anims) ? entry.anims : []), { name, row: startRow, rows: 1, frames: offsets }],
									},
								},
							};
						});
						onAdded(startRow);
						setHint(`已添加「${name}」（${offsets.length} 帧）`);
					} catch (error) {
						setHint("出错了：" + (error && error.message ? error.message : String(error)));
					} finally {
						setBusy(false);
					}
				};

				return h("div", { className: "konp-dev-sheet" },
					h("div", { className: "konp-dev-sheet-row" },
						h("button", {
							className: "konp-set-btn",
							type: "button",
							disabled: busy,
							onClick: () => fileRef.current && fileRef.current.click(),
						}, busy ? "处理中…" : "添加新动作"),
						current ? h("button", {
							className: "konp-set-btn",
							type: "button",
							onClick: onRestore,
						}, "一键恢复原图集") : null,
						current ? h("button", {
							className: "konp-set-btn",
							type: "button",
							onClick: onDelete,
						}, "删除导入图集") : null,
						h("input", {
							ref: fileRef,
							type: "file",
							accept: "image/*",
							multiple: true,
							style: { display: "none" },
							onChange: addAction,
						}),
					),
				);
			}

			// 开发者模式里任何渲染异常都不该连累整个设置页
			class DevBoundary extends React.Component {
				constructor(props) {
					super(props);
					this.state = { error: null };
				}
				static getDerivedStateFromError(error) {
					return { error };
				}
				render() {
					if (this.state.error) {
						return React.createElement("div", { className: "konp-set-note", style: { color: "#d33" } },
							"开发者模式出错：" + (this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)));
					}
					return this.props.children;
				}
			}

			function DevActionEditor({ member, settings, updateSettings, open, onToggle }) {
				const [meta, setMeta] = useState(null);
				const [focus, setFocus] = useState("idle");
				const [draft, setDraft] = useState(null); // 拖动后还没写回的帧顺序 { row, frames }
				const [previewFrame, setPreviewFrame] = useState(null);
				const [hint, setHint] = useState("");
				const [confirmKind, setConfirmKind] = useState(null);
				const canvasRef = useRef(null);
				const frameRefs = useRef(new Map());

				useEffect(() => {
					let alive = true;
					fetch(`${ASSET_BASE}/characters/${member.id}/meta.json?v=${ASSET_REV}`)
						.then((response) => (response.ok ? response.json() : null))
						.then((data) => {
							if (!alive || !data) return;
							const custom = (settings.sheetOverrides || {})[member.id];
							setMeta(custom ? withCustomSheet(data, custom) : data);
						})
						.catch(() => {});
					return () => { alive = false; };
				}, [member.id, settings.sheetOverrides]);

				const override = (settings.actionOverrides || {})[member.id] || {};
				const current = meta ? { ...(meta.actions || {}), ...override } : {};
				const sheetInfo = (settings.sheetOverrides || {})[member.id];
				const officialRows = sheetInfo ? (sheetInfo.officialRows ?? 0) : 0;
				const cols = meta ? meta.sheet.columns : 6;
				const rowIndex = Number(current[focus]) || 0;
				const isImportedRow = Boolean(sheetInfo) && rowIndex >= officialRows;
				const anims = sheetInfo && Array.isArray(sheetInfo.anims) ? sheetInfo.anims : [];
				const anim = anims.find((item) => item.row === rowIndex);
				const savedFrames = anim && Array.isArray(anim.frames) ? anim.frames : [];
				// 帧序列的唯一来源是 anims[].frames（null = 空帧）；拖动先写草稿，点「保存」才落库
				const frames = draft && draft.row === rowIndex && draft.frames.length === savedFrames.length ? draft.frames : savedFrames;
				const framesKey = frames.join(",");

				// 预览画布：播放当前行；点某一格就停在那张
				useEffect(() => {
					if (!meta) return;
					const canvas = canvasRef.current;
					if (!canvas) return;
					const context = canvas.getContext("2d");
					const sheet = new Image();
					sheet.src = sheetInfo ? sheetInfo.src : `${ASSET_BASE}/characters/${member.id}/sheet.png?v=${ASSET_REV}`;
					const draw = (cellIndex) => {
						if (!sheet.complete || !Number.isFinite(cellIndex)) return;
						context.clearRect(0, 0, canvas.width, canvas.height);
						context.drawImage(sheet, (cellIndex % cols) * 96, Math.floor(cellIndex / cols) * 96, 96, 96, 0, 0, canvas.width, canvas.height);
					};
					const picked = previewFrame === null ? null : frames[previewFrame];
					if (picked !== null && picked !== undefined) {
						const cell = rowIndex * cols + picked;
						sheet.onload = () => draw(cell);
						draw(cell);
						return;
					}
					let index = 0;
					const sequence = rowFrames(meta, rowIndex);
					const paint = () => {
						if (sequence.length) draw(sequence[index % sequence.length]);
					};
					sheet.onload = paint;
					paint();
					const timer = window.setInterval(() => { index += 1; paint(); }, 260);
					return () => window.clearInterval(timer);
				}, [meta, rowIndex, focus, previewFrame, framesKey, sheetInfo, member.id, cols]);

				// 帧方块缩略图：只画非空帧，空帧留白
				useEffect(() => {
					if (!meta || !sheetInfo) return;
					const sheet = new Image();
					sheet.src = sheetInfo.src;
					const paint = () => {
						frameRefs.current.forEach((canvas, position) => {
							if (!canvas) return;
							const context = canvas.getContext("2d");
							context.clearRect(0, 0, canvas.width, canvas.height);
							const offset = frames[position];
							if (offset === null || offset === undefined) return;
							const cellIndex = rowIndex * cols + offset;
							context.drawImage(sheet, (cellIndex % cols) * 96, Math.floor(cellIndex / cols) * 96, 96, 96, 0, 0, canvas.width, canvas.height);
						});
					};
					sheet.onload = paint;
					if (sheet.complete) paint();
				}, [meta, sheetInfo, rowIndex, cols, framesKey]);

				if (!meta) return h("div", { className: "konp-set-row" }, h("small", null, `${member.name}：加载中…`));

				const validFrames = (row) => (meta.cells || []).filter((cell) => Math.floor(cell.index / cols) === Number(row)
					&& cell.bbox && cell.bbox[2] - cell.bbox[0] >= 20 && cell.bbox[3] - cell.bbox[1] >= 40).length;
				const emptyFrames = frames.filter((offset) => offset === null || offset === undefined).length;
				const options = Array.from({ length: meta.sheet.rows }, (_, index) => index)
					.filter((index) => validFrames(index) > 0)
					.map((index) => {
						const item = anims.find((value) => value.row === index);
						return h("option", { key: index, value: index },
							item ? `我的：${item.name}（${(item.frames || []).length} 帧）` : `row ${index}（${validFrames(index)} 帧）`);
					});

				const setState = (state, value) => {
					updateSettings((now) => ({
						...now,
						actionOverrides: {
							...now.actionOverrides,
							[member.id]: { ...(now.actionOverrides || {})[member.id], [state]: Number(value) },
						},
					}));
				};

				// 所有帧序列写操作都只改 anims[row].frames
				const writeFrames = (row, list) => updateSettings((now) => {
					const table = { ...(now.sheetOverrides || {}) };
					const entry = table[member.id];
					if (!entry) return now;
					table[member.id] = {
						...entry,
						anims: (entry.anims || []).map((item) => (item.row === row ? { ...item, frames: list } : item)),
					};
					return { ...now, sheetOverrides: table };
				});

				// 删动作：同时把它从各状态的下拉框里摘掉，避免指向空行
				const removeAnim = (row) => {
					updateSettings((now) => {
						const table = { ...(now.sheetOverrides || {}) };
						const entry = table[member.id];
						if (!entry) return now;
						table[member.id] = { ...entry, anims: (entry.anims || []).filter((item) => item.row !== row) };
						const acts = { ...(now.actionOverrides || {}) };
						const own = acts[member.id];
						if (own) {
							const kept = {};
							for (const [state, value] of Object.entries(own)) {
								if (Number(value) !== row) kept[state] = value;
							}
							acts[member.id] = kept;
						}
						return { ...now, sheetOverrides: table, actionOverrides: acts };
					});
					setDraft(null);
					setPreviewFrame(null);
					setHint("已删除该动作");
				};

				const moveFrame = (from, to) => {
					if (from === to || from < 0 || to < 0 || to >= frames.length) return;
					const next = [...frames];
					const [item] = next.splice(from, 1);
					next.splice(to, 0, item);
					setDraft({ row: rowIndex, frames: next });
					setHint("顺序已调换，点「保存」写回");
				};

				const saveFrames = () => {
					if (!anim) return;
					writeFrames(rowIndex, frames);
					setDraft(null);
					setHint("已保存帧顺序");
				};

				const removeFrame = (position) => {
					const rest = frames.filter((_, index) => index !== position);
					setPreviewFrame(null);
					setDraft(null);
					if (!rest.length) { removeAnim(rowIndex); return; }
					writeFrames(rowIndex, rest);
					setHint(`已移除 1 帧，剩 ${rest.length} 帧`);
				};

				// 帧数 = 帧数组长度：多了补 null 空帧，少了截断（不动图集）
				const setSlots = (count) => {
					if (!anim || !(count >= 1)) return;
					const next = frames.slice(0, count);
					while (next.length < count) next.push(null);
					writeFrames(rowIndex, next);
					setDraft(null);
					setPreviewFrame(null);
					setHint(`帧数改为 ${count}（空帧不播放）`);
				};

				const renameAnim = (name) => {
					if (!anim) return;
					updateSettings((now) => {
						const table = { ...(now.sheetOverrides || {}) };
						const entry = table[member.id];
						if (!entry) return now;
						table[member.id] = {
							...entry,
							anims: (entry.anims || []).map((item) => (item.row === rowIndex ? { ...item, name } : item)),
						};
						return { ...now, sheetOverrides: table };
					});
				};

				const confirmSheet = () => {
					updateSettings((now) => {
						const sheets = { ...(now.sheetOverrides || {}) };
						const acts = { ...(now.actionOverrides || {}) };
						delete sheets[member.id];
						delete acts[member.id];
						return { ...now, sheetOverrides: sheets, actionOverrides: acts };
					});
					setDraft(null);
					setPreviewFrame(null);
					setHint(confirmKind === "delete" ? "已删除该角色的导入图集" : "已恢复官方图集");
					setConfirmKind(null);
				};

				return h("div", { className: "konp-dev-card" },
					h("div", { className: "konp-dev-head" },
						h("button", {
							className: "konp-dev-toggle",
							type: "button",
							onClick: () => onToggle(),
							"aria-expanded": open,
						}, `${open ? "▾" : "▸"} ${member.name}`),
						h("button", {
							className: "konp-set-btn",
							type: "button",
							onClick: () => {
								updateSettings((now) => {
									const next = { ...(now.actionOverrides || {}) };
									delete next[member.id];
									return { ...now, actionOverrides: next };
								});
								setDraft(null);
								setPreviewFrame(null);
							},
						}, "复位"),
					),
					open ? h("div", { className: "konp-dev-body" },
						h("div", { className: "konp-dev-grid" },
							...DEV_STATES.map(([state, label]) => h("label", { key: state, className: "konp-dev-item" },
								h("span", null, label),
								h("select", {
									value: Number(current[state] ?? 0),
									onFocus: () => setFocus(state),
									onChange: (event) => {
										setFocus(state);
										setState(state, event.target.value);
										setDraft(null);
										setPreviewFrame(null);
									},
								}, options),
							)),
						),
						h("div", { className: "konp-dev-name" },
							h("span", null, "名称"),
							h("input", {
								type: "text",
								value: anim ? anim.name : "",
								maxLength: 40,
								disabled: !anim,
								placeholder: anim ? "给这个动作起个名字" : (isImportedRow ? "这一行没有动作" : "官方动作（只读）"),
								onChange: (event) => renameAnim(event.target.value),
							}),
						),
						h("div", { className: "konp-dev-main" },
							h("div", { className: "konp-dev-preview" },
								h("canvas", { ref: canvasRef, width: 144, height: 144 }),
								h("small", null, anim ? `${focus} · ${anim.name}（${frames.length} 帧${emptyFrames ? ` · ${emptyFrames} 空` : ""}）` : `${focus} · row ${rowIndex}`),
							),
							anim ? h("div", { className: "konp-dev-order" },
								h("small", null, "帧顺序（拖动方块调换，✕ 删帧）"),
								h("div", { className: "konp-dev-orderlist" },
									...frames.map((offset, position) => h("div", {
										key: position,
										className: `konp-dev-frame${previewFrame === position ? " active" : ""}${offset === null ? " is-empty" : ""}`,
										draggable: true,
										onDragStart: (event) => event.dataTransfer.setData("text/plain", String(position)),
										onDragOver: (event) => event.preventDefault(),
										onDrop: (event) => {
											event.preventDefault();
											moveFrame(Number(event.dataTransfer.getData("text/plain")), position);
										},
										onClick: () => setPreviewFrame((value) => (value === position ? null : position)),
									},
									h("canvas", {
										width: 48,
										height: 48,
										ref: (el) => {
											if (el) frameRefs.current.set(position, el);
											else frameRefs.current.delete(position);
										},
									}),
									h("span", null, offset === null ? "空" : `帧 ${position + 1}`),
									h("button", {
										className: "konp-dev-frame-del",
										type: "button",
										onClick: (event) => {
											event.stopPropagation();
											removeFrame(position);
										},
									}, "✕"))),
								),
								h("div", { className: "konp-set-actions" },
									h("select", {
										value: frames.length,
										"aria-label": "帧数",
										onChange: (event) => setSlots(Number(event.target.value)),
										style: { borderRadius: "8px", padding: "4px 6px" },
									}, ...Array.from({ length: cols }, (_, index) => index + 1)
										.map((count) => h("option", { key: count, value: count }, `帧数：${count}`))),
									h("button", { className: "konp-set-btn", type: "button", onClick: saveFrames }, "保存"),
									h("button", { className: "konp-set-btn", type: "button", onClick: () => removeAnim(rowIndex) }, "删除动作"),
									draft && draft.row === rowIndex ? h("small", { className: "konp-dev-hint" }, "有未保存的调整") : null,
								),
							) : null,
						),
						h(DevSheetImport, {
							member,
							settings,
							updateSettings,
							setHint,
							onAdded: (row) => {
								setState(focus, row);
								setDraft(null);
								setPreviewFrame(null);
							},
							onRestore: () => setConfirmKind("restore"),
							onDelete: () => setConfirmKind("delete"),
						}),
						confirmKind ? h("div", { className: "konp-dev-sheet-row" },
							h("small", null, confirmKind === "delete" ? "确认删除整个导入图集？" : "确认恢复官方图集？"),
							h("button", { className: "konp-set-btn", type: "button", onClick: confirmSheet }, "确认"),
							h("button", { className: "konp-set-btn", type: "button", onClick: () => setConfirmKind(null) }, "取消"),
						) : null,
						hint ? h("small", { className: "konp-dev-hint" }, hint) : null,
						h("small", { className: "konp-dev-hint" }, `支持 PNG / JPG / WebP · 一个动作最多 ${cols} 帧`),
					) : null,
				);
			}

			function KOnPetSettings() {
				const [devText, setDevText] = useState("{}");
				const [devError, setDevError] = useState("");
				const [devOpen, setDevOpen] = useState(false);
				const [openChar, setOpenChar] = useState(null);
				const applyDev = () => {
					try {
						const clean = Core.sanitizeOverrides(JSON.parse(devText || "{}"));
						updateSettings({ actionOverrides: clean });
						setDevText(JSON.stringify(clean, null, 1));
						setDevError("");
					} catch (error) {
						setDevError("JSON 解析失败：" + (error && error.message ? error.message : "格式错误"));
					}
				};
				const settings = useSettings();
				const count = ROSTER.filter((member) => settings.visible[member.id]).length;
				const fileRef = useRef(null);
				const [notice, setNotice] = useState("");
				const [, setPaint] = useState(0);

				// DSH 首次挂载设置分区时，槽位容器尺寸/主题变量可能还没稳定；
				// 等一帧再画一次，避免第一次进入时开关或行高看起来错位。
				useEffect(() => {
					const raf = requestAnimationFrame(() => setPaint((value) => value + 1));
					return () => cancelAnimationFrame(raf);
				}, []);

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
					styleElement(),
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
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "自动回位"),
								h("small", null, "在外溜达超过这个时间就自己回到座位（0 = 不自动回位）"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 0,
								max: 30,
								step: 1,
								value: settings.returnAfter,
								"aria-label": "自动回位时间（分钟）",
								onChange: (event) => updateSettings({ returnAfter: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" },
								settings.returnAfter > 0 ? `${settings.returnAfter} 分` : "关"),
						),
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
								h("b", null, "行走速度"),
								h("small", null, "每秒移动的像素（1× 缩放）"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 40,
								max: 240,
								step: 4,
								value: settings.speed,
								"aria-label": "行走速度",
								onChange: (event) => updateSettings({ speed: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.speed} px/s`),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "待机时间"),
								h("small", null, "两次走动之间停多久"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 1,
								max: 120,
								step: 1,
								value: settings.idleSeconds,
								"aria-label": "待机时间（秒）",
								onChange: (event) => updateSettings({ idleSeconds: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.idleSeconds} 秒`),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "单次行走"),
								h("small", null, "一次走多久"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 1,
								max: 60,
								step: 1,
								value: settings.walkSeconds,
								"aria-label": "单次行走时长（秒）",
								onChange: (event) => updateSettings({ walkSeconds: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.walkSeconds} 秒`),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "可甩出"),
								h("small", null, "快速甩动可以把角色扔出去；关掉就只能拖动"),
							),
							h(Switch, {
								checked: settings.throwEnabled !== false,
								onChange: () => updateSettings({ throwEnabled: settings.throwEnabled === false }),
								label: "可甩出",
							}),
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
								h("b", null, "溜达"),
								h("small", null, "待机时每 20–45 秒自己走一小段（睡着后不会走）"),
							),
							h(Switch, {
								checked: settings.wander,
								onChange: () => updateSettings({ wander: !settings.wander }),
								label: "溜达",
							}),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "朝向反转"),
								h("small", null, "走路时脸和前进方向相反就打开：换用另一套左右步态素材"),
							),
							h(Switch, {
								checked: settings.facingFlipped,
								onChange: () => updateSettings({ facingFlipped: !settings.facingFlipped }),
								label: "朝向反转",
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
						h("div", { className: "konp-set-head" }, h("strong", null, "彩蛋")),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "启用彩蛋"),
								h("small", null, "随机小剧场总开关：跟随 + 茶会"),
							),
							h(Switch, {
								checked: settings.follow,
								onChange: () => updateSettings({ follow: !settings.follow }),
								label: "跟随",
							}),
						),
						...(settings.follow ? [h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "跟随彩蛋概率"),
								h("small", null, "每次待机结束时决定要不要追过去"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 0,
								max: 100,
								step: 5,
								value: settings.followChance,
								"aria-label": "跟随概率（百分比）",
								onChange: (event) => updateSettings({ followChance: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.followChance}%`),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "台词语言"),
								h("small", null, "跟随台词与语音字幕的显示语言"),
							),
							h("div", { className: "konp-set-actions" },
								...[["zh", "中文"], ["ja", "日文"], ["both", "双语"]].map(([value, label]) => h("button", {
									key: value,
									className: "konp-set-btn",
									type: "button",
									"aria-pressed": settings.lang === value,
									style: settings.lang === value ? { borderColor: "rgba(127,127,127,.55)" } : null,
									onClick: () => updateSettings({ lang: value }),
								}, label)),
							),
						),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "茶会彩蛋概率"),
								h("small", null, "䌷说到「带了蛋糕」或连点她 15 次时开茶会"),
							),
							h("input", {
								className: "konp-range",
								type: "range",
								min: 0,
								max: 100,
								step: 5,
								value: settings.teaPartyChance,
								"aria-label": "茶会彩蛋概率（百分比）",
								onChange: (event) => updateSettings({ teaPartyChance: Number(event.target.value) }),
							}),
							h("span", { className: "konp-set-value" }, `${settings.teaPartyChance}%`),
						)] : []),
					),
					h(DevBoundary, null, h("section", { className: "konp-set-card" },
						h("div", { className: "konp-set-head" }, h("strong", null, "开发者模式")),
						h("div", { className: "konp-set-row" },
							h("div", { className: "konp-set-name" },
								h("b", null, "启用开发者模式"),
								h("small", null, "用 JSON 覆盖每个角色的动作行；只存本地，不改素材文件"),
							),
							h(Switch, {
								checked: settings.devMode,
								onChange: () => updateSettings({ devMode: !settings.devMode }),
								label: "开发者模式",
							}),
						),
						settings.devMode ? h("div", { style: { padding: "10px 0", borderTop: "1px solid rgba(127,127,127,.15)" } },
							h("small", null, "可视化编辑：给每个状态选一行，右侧预览所选行的动画；修改立即生效"),
							...Core.ROSTER.map((member) => h(DevActionEditor, {
								key: member.id,
								member,
								settings,
								updateSettings,
								open: openChar === member.id,
								onToggle: () => setOpenChar((value) => (value === member.id ? null : member.id)),
							})),
							h("div", { className: "konp-set-actions" },
								h("button", {
									className: "konp-set-btn",
									type: "button",
									onClick: () => setDevOpen((open) => !open),
								}, devOpen ? "收起 JSON" : "高级：JSON 编辑"),
								h("button", {
									className: "konp-set-btn",
									type: "button",
									onClick: () => {
										updateSettings({ actionOverrides: {} });
										setDevText("{}");
										setDevError("");
									},
								}, "一键恢复默认"),
							),
							devOpen ? h("div", { style: { paddingTop: "8px" } },
								h("textarea", {
									style: { width: "100%", minHeight: "96px", fontFamily: "monospace", fontSize: "12px", padding: "8px", borderRadius: "8px" },
									value: devText,
									spellCheck: false,
									onChange: (event) => setDevText(event.target.value),
								}),
								h("div", { className: "konp-set-actions" },
									h("button", { className: "konp-set-btn", type: "button", onClick: applyDev }, "应用 JSON"),
									h("button", { className: "konp-set-btn", type: "button", onClick: () => {
										setDevText(JSON.stringify(settings.actionOverrides || {}, null, 1));
										setDevError("");
									} }, "载入当前"),
								),
								devError ? h("small", { style: { color: "#d33" } }, devError) : null,
							) : null,
						) : null,
					)),
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
								// 初始化：位置、座位、桌子位置、朝向全部回到默认，并让运行中的角色重新开始。
								onClick: () => updateSettings((current) => ({
									...current,
									positions: {},
									seats: {},
									tablePos: null,
									tableLocked: false,
									facingFlipped: false,
									resetAt: Date.now(),
								})),
							}, "初始化"),
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
						h("p", { className: "konp-set-note" }, "「初始化」会清空位置、座位和桌子位置，把朝向恢复为默认，并让走动的角色立刻停下重新排队。"),
					),
					h("p", { className: "konp-set-note" }, "提示：右键宠物可以单独隐藏它；隐藏后仍可在这里重新打开。"),
				);
			}

			function PetActor({ member, settings, index, count, onHide, onDropSeat, onAutoSeat, getSeatTarget, onTeaParty }) {
				const [asset, setAsset] = useState(null);
				const [assetError, setAssetError] = useState("");
				const [bubble, setBubble] = useState(null);
				const [menu, setMenu] = useState(null);

				const settingsRef = useRef(settings);
				settingsRef.current = settings;
				// 素材只跟"这个角色自己的图集覆盖"有关：位置之类的设置变化不该重载素材，
				// 否则主循环每次都被重建，自动回位的计时永远攒不满。
				const customSheet = (settings.sheetOverrides || {})[member.id] || null;
				const sheetKey = customSheet
					? `${customSheet.src.length}:${customSheet.src.slice(-24)}:${customSheet.cols}:${customSheet.rows}:${(customSheet.anims || []).map((anim) => `${anim.row}=${(anim.frames || []).join(",")}`).join(";")}`
					: "";
				// 自动回位的回调放在 ref 里，避免它变化导致主循环重建。
				const autoSeatRef = useRef(null);
				autoSeatRef.current = onAutoSeat || null;
				// 座位中心点（视口坐标），回位时用来导航。
				const seatTargetRef = useRef(null);
				seatTargetRef.current = getSeatTarget || null;

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
				// 每个角色有自己的节奏（待机/行走时长按这个系数缩放），避免同步行动
				const tempo = Core.TEMPO[member.id] || 1;
				const clickStreak = useRef(0);
				const clickStreakAt = useRef(0);
				const lastMoveAt = useRef(performance.now());
				const onTeaPartyRef = useRef(null);
				onTeaPartyRef.current = onTeaParty || null;

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
					if (settingsRef.current.muted || !meta || !Array.isArray(meta.voices) || meta.voices.length === 0) return "";
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
					return file;
				}, []);

				const setClip = useCallback((engine, clip, mode) => {
					const meta = assetRef.current && assetRef.current.meta;
					if (!meta) return;
					// stand = 原地可爱动作循环；react = 该角色的"被点反应"行；其余走 meta.clips。
					// 行号全部来自 meta.json 的 actions，代码里不再维护映射表。
					const actions = actionsOf(meta);
					const clips = meta.clips || {};
					const rowOf = { stand: actions.idle, react: actions.react, sleep: actions.sleep, held: actions.held };
					let frames;
					const row = rowOf[clip];
					if (row !== undefined && row !== null) {
						const rows = rowFrames(meta, row);
						frames = rows.length ? rows : clips[clip] && clips[clip].length ? clips[clip] : idleFrames(meta);
					} else {
						frames = clips[clip] && clips[clip].length ? clips[clip] : idleFrames(meta);
					}
					engine.clip = clip;
					engine.frames = frames;
					engine.row = row;
					engine.frame = 0;
					engine.acc = 0;
					if (mode) engine.mode = mode;
				}, []);

				// 直接播某一行（点击反应 / 跳舞这类"一次性动作"用）。
				const setClipRow = useCallback((engine, row, mode) => {
					const meta = assetRef.current && assetRef.current.meta;
					if (!meta) return 0;
					const frames = rowFrames(meta, row);
					engine.clip = "custom";
					engine.frames = frames.length ? frames : idleFrames(meta);
					engine.row = row;
					engine.frame = 0;
					engine.acc = 0;
					if (mode) engine.mode = mode;
					return engine.frames.length;
				}, []);

				const wake = useCallback(() => {
					const engine = engineRef.current;
					if (!engine) return;
					engine.lastInteract = performance.now();
					if (engine.mode === "sleep") {
						setClip(engine, "stand", "idle");
						engine.nextClipAt = performance.now() + 8000 + Math.random() * 6000;
					}
				}, [setClip]);

				// 单击：在 actions.click 里随机挑一行（原版点一下会背对镜头 / 扶额闭眼），
				// 播 3 秒，然后回到待机或继续走动。
				const reactNow = useCallback((useVoice = true) => {
					const engine = engineRef.current;
					const current = assetRef.current;
					if (!engine || !current) return;
					const actions = actionsOf(current.meta);
					const rows = Array.isArray(actions.click) ? actions.click.filter((row) => row !== undefined && row !== null) : [];
					if (!rows.length) return;
					const row = rows[Math.floor(Math.random() * rows.length)];
					engine.lastInteract = performance.now();
					setClipRow(engine, row, "react");
					engine.reactUntil = performance.now() + 3000;
					// 连点彩蛋的计数在 onPointerUp 里做（双击判定之前），这里不再重复计
					// 气泡跟随实际播放的那条语音（meta.lines 里是逐条的日文/中文），没有就用音符。
					const file = useVoice ? playVoice(current.meta) : "";
					const line = file && current.meta.lines ? current.meta.lines[file] : null;
					say((line && pickLang(line, current.lang)) || "♪", 2600);
				}, [playVoice, say, setClipRow]);

				const triggerClick = useCallback(() => reactNow(true), [reactNow]);

				// 双击：跳舞（actions.dance 行循环几轮），跳完回待机，过几秒自动开始走动。
				const triggerDouble = useCallback(() => {
					const engine = engineRef.current;
					const current = assetRef.current;
					if (!engine || !current) return;
					const now = performance.now();
					if (now - lastDoubleAt.current < 400) return;
					lastDoubleAt.current = now;
					const actions = actionsOf(current.meta);
					const frames = rowFrames(current.meta, actions.dance);
					if (!frames.length) return;
					engine.lastInteract = now;
					setClipRow(engine, actions.dance, "dance");
					engine.danceUntil = now + Math.max(2400, (frames.length / 5) * 1000 * 3);
					say("❤", 2600);
				}, [say, setClipRow]);

				// 下一段走向：优先跟随（律→澪、唯→梓、䌷→某一队），否则随机方向。
				const planNextMove = useCallback((engine, now) => {
					const current = settingsRef.current;
					const speed = Math.max(30, current.speed) * current.scale;
					const base = current.walkSeconds * 1000 * tempo * (0.8 + Math.random() * 0.5);
					const tryFollow = (leaderId, maxDist, chance) => {
						const peer = PEERS.get(leaderId);
						if (!peer) return null;
						const to = Core.planWalkTo(posRef.current.x, posRef.current.y, peer.x, peer.y);
						if (!to || to.distance < 120 || to.distance > maxDist) return null;
						if (Math.random() > chance) return null;
						return {
							dx: to.dx,
							dy: to.dy,
							duration: Math.min(base, Math.max(600, (to.distance / speed) * 1000)),
						};
					};
					if (current.follow) {
						const chance = current.followChance / 100;
						// 反向追逐：被追的人偶尔反过来追，随机出现
						const leaderId = FOLLOW_TARGET[member.id]
							|| (REVERSE_TARGET[member.id] && Math.random() < 0.35 ? REVERSE_TARGET[member.id] : null);
						if (leaderId) {
							const followed = tryFollow(leaderId, 900, chance);
							if (followed) {
								followed.follow = leaderId;
								FREEZE.set(leaderId, performance.now() + 8000);
								const shout = Core.pick(Core.FOLLOW_LINES[member.id] || []);
								if (shout) say(pickLang(shout, current.lang), 2600);
								return followed;
							}
						} else if (member.id === "tsumugi") {
							// 两对都待久了、且自己在附近 → 随机跟其中一队
							const idleLong = ["mio", "azusa"].filter((id) => {
								const peer = PEERS.get(id);
								return peer && now - peer.movedAt > 5000;
							});
							if (idleLong.length) {
								const leader = Core.pick(idleLong);
								const followed = tryFollow(leader, 600, chance * 0.75);
								if (followed) {
									followed.follow = leader;
									const shout = Core.pick(Core.FOLLOW_LINES.tsumugi || []);
									if (shout) say(pickLang(shout, current.lang), 2600);
									return followed;
								}
							}
						}
					}
					const random = Core.planWalk(posRef.current.x, posRef.current.y, null, current.scale);
					return { dx: random.dx, dy: random.dy, duration: base };
				}, [member.id, say]);

				// 初始位置：恢复该角色上次位置，否则按当前可见数量排在右下角。
				useEffect(() => {
					const limit = bounds(size);
					const fallback = Core.defaultPosition(size, index, count, window.innerWidth, window.innerHeight);
					const x = storedX === null || storedY === null ? fallback.x : storedX;
					const y = storedX === null || storedY === null ? fallback.y : storedY;
					// 用回绕而不是硬夹：走到边上被 wrap 过的坐标要保住，否则会瞬移
					posRef.current = Core.wrapPosition(x, y, size, window.innerWidth, window.innerHeight);
					syncTransform();
				}, [storedX, storedY, index, count, size, bounds, syncTransform]);

				// 设置页点了「初始化」：把这只从走动/拖拽里拽回待机，并重置所有计时器。
				useEffect(() => {
					if (!settings.resetAt) return;
					const engine = engineRef.current;
					if (!engine) return;
					const now = performance.now();
					engine.mode = "idle";
					engine.vx = 0;
					engine.vy = 0;
					engine.dir = 1;
					engine.reactUntil = 0;
					engine.lastInteract = now;
					engine.nextWalkAt = now + settingsRef.current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8);
					engine.nextTalkAt = now + TALK_EVERY[0] + Math.random() * (TALK_EVERY[1] - TALK_EVERY[0]);
					engine.nextCareAt = now + CARE_EVERY;
					rotRef.current = 0;
					setClip(engine, "stand", "idle");
				}, [settings.resetAt, setClip]);

				useEffect(() => {
					const onResize = () => {
						const limit = bounds(size);
						posRef.current.x = Core.clamp(posRef.current.x, 2, limit.maxX);
						posRef.current.y = Core.clamp(posRef.current.y, 2, limit.maxY);
						// 角色之间不重叠：同一横向带（上下有重叠）要多留一些，避免并排贴在一起
						if (engine.mode === "idle" || engine.mode === "walk") {
							for (const [peerId, peer] of PEERS) {
								if (peerId === member.id) continue;
								const dx = posRef.current.x - peer.x;
								const dy = posRef.current.y - peer.y;
								const dist = Math.hypot(dx, dy);
								const sameBand = Math.abs(dy) < actorSize * 0.9;
								const minGap = actorSize * (sameBand ? 1.45 : 1.15);
								if (dist < 0.01) {
									posRef.current.x += actorSize * 0.35;
								} else if (dist < minGap) {
									const push = (minGap - dist) * 0.6;
									posRef.current.x += (dx / dist) * push;
									posRef.current.y += (dy / dist) * push;
								}
							}
						}

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
						.then((rawMeta) => new Promise((resolve, reject) => {
							const custom = customSheet;
							const meta = custom ? withCustomSheet(rawMeta, custom) : rawMeta;
							const image = new Image();
							image.decoding = "async";
							image.onload = () => resolve({ meta, image });
							image.onerror = () => reject(new Error("立绘 sheet.png 加载失败"));
							image.src = custom ? custom.src : `${base}/sheet.png?v=${ASSET_REV}`;
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
				}, [member.id, sheetKey]);

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
						clip: "stand",
						frames: idleFrames(meta),
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
						// 溜达状态：任意方向的计划、已走时长、朝向、下一次溜达时间。
						walkPlan: null,
						walkElapsed: 0,
						danceUntil: 0,
						dir: 1,
						// 自动回位：从挂载（自由状态）开始计时
						freeSince: performance.now(),
						autoSeat: false,
						nextWalkAt: performance.now() + settingsRef.current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8),
						followTarget: null,
						followDeadline: 0,
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

						// 登记位置，供「跟随」行为读取（movedAt 用来判断谁待久了）
						if (engine.mode === "walk" || engine.mode === "return") lastMoveAt.current = now;
						const frozen = (FREEZE.get(member.id) || 0) > now;
						if (frozen && engine.mode === "walk") {
							setClip(engine, "stand", "idle");
							engine.nextWalkAt = now + 600;
						}
						PEERS.set(member.id, { x: posRef.current.x, y: posRef.current.y, movedAt: lastMoveAt.current });

						// 茶桌开着时：在外自由活动超过设定时长，就自己朝座位走过去。
						if (!engine.autoSeat && current.table && current.returnAfter > 0 && autoSeatRef.current &&
							engine.mode !== "drag" && engine.mode !== "throw" && engine.mode !== "return" &&
							now - engine.freeSince >= current.returnAfter * 60000) {
							engine.mode = "return";
							engine.returnDeadline = now + 12000;
							engine.clip = "walk";
							engine.frames = walkFrames(meta, engine.dir, current.facingFlipped);
							engine.frame = 0;
							engine.acc = 0;
						}

						if (engine.mode === "return") {
							// 朝自己的座位走；到达就入座，超时也入座（避免卡住）。
							const target = seatTargetRef.current ? seatTargetRef.current(member.id) : null;
							if (!target) {
								engine.autoSeat = true;
								autoSeatRef.current(member.id);
								return;
							}
							const cx = posRef.current.x + actorSize / 2;
							const cy = posRef.current.y + actorSize / 2;
							const dx = target.x - cx;
							const dy = target.y - cy;
							const dist = Math.hypot(dx, dy);
							if (dist <= 14 || now > engine.returnDeadline) {
								engine.autoSeat = true;
								autoSeatRef.current(member.id);
								return;
							}
							const stepLen = current.speed * current.scale * 1.5 * dt;
							posRef.current.x += (dx / dist) * stepLen;
							posRef.current.y += (dy / dist) * stepLen;
							const dir = dx < 0 ? -1 : 1;
							if (dir !== engine.dir) {
								engine.dir = dir;
								engine.clip = "walk";
								engine.frames = walkFrames(meta, dir, current.facingFlipped);
								engine.frame = 0;
								engine.acc = 0;
							}
						} else if (engine.mode === "drag" && pointer) {
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
								setClip(engine, "stand", "idle");
								engine.nextClipAt = now + 6000 + Math.random() * 5000;
								savePosition();
							}
							const target = reduceMotion.current ? 0 : Core.clamp(engine.vx * 0.02, -12, 12);
							rotRef.current += (target - rotRef.current) * 0.15;
							// 抛出去这一帧必须立刻把新坐标写到元素上，否则会"停在原地"
							syncTransform();
						} else if (engine.mode === "walk") {
							rotRef.current += (0 - rotRef.current) * 0.1;
							let plan = engine.walkPlan || { dx: 0, dy: 0, duration: 0 };
							let arrived = false;
							// 跟随模式：一路追到目标附近才停；停在同一条线上并留出一个身位的间距
							if (engine.followTarget) {
								const peer = PEERS.get(engine.followTarget);
								const gap = actorSize * 1.15;
								if (!peer || now > engine.followDeadline) {
									if (engine.followTarget) FREEZE.delete(engine.followTarget);
									engine.followTarget = null;
									arrived = true;
								} else {
									const dy = peer.y - posRef.current.y;
									const dx = peer.x - posRef.current.x;
									if (Math.abs(dy) > 8) {
										// 第一步：先走到和他同一条横线上
										plan = { dx: 0, dy: dy > 0 ? 1 : -1, duration: Number.POSITIVE_INFINITY };
									} else if (Math.abs(dx) > gap) {
										// 第二步：横向靠过去，停在 gap 之外
										plan = { dx: dx > 0 ? 1 : -1, dy: 0, duration: Number.POSITIVE_INFINITY };
									} else if (Math.abs(dx) < gap * 0.6) {
										// 太近了往后退一点，别贴脸
										plan = { dx: dx > 0 ? -1 : 1, dy: 0, duration: Number.POSITIVE_INFINITY };
									} else {
										FREEZE.delete(engine.followTarget);
										engine.followTarget = null;
										arrived = true;
									}
									if (!arrived) engine.walkPlan = plan;
								}
							}
							if (arrived) {
								setClip(engine, "stand", "idle");
								engine.nextClipAt = now + 5000 + Math.random() * 6000;
								engine.nextWalkAt = now + current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8);
								savePosition();
							} else {
								const moved = Core.stepWalk(posRef.current, plan, current.speed * current.scale, dt);
								// 出界回绕：往下走没了就从上面下来，左右同理。
								const wrapped = Core.wrapPosition(moved.x, moved.y, actorSize, window.innerWidth, window.innerHeight);
								posRef.current.x = wrapped.x;
								posRef.current.y = wrapped.y;
								if (Math.abs(plan.dx) > 0.15) engine.dir = plan.dx < 0 ? -1 : 1;
								engine.walkElapsed += dt * 1000;
								if (engine.walkElapsed >= plan.duration) {
									setClip(engine, "stand", "idle");
									engine.nextClipAt = now + 5000 + Math.random() * 6000;
									engine.nextWalkAt = now + current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8);
									savePosition();
								}
							}
						} else {
							rotRef.current += (0 - rotRef.current) * 0.1;
							if (engine.mode === "dance" && now >= engine.danceUntil) {
								setClip(engine, "stand", "idle");
								engine.nextClipAt = now + 4000 + Math.random() * 4000;
								// 跳完舞歇一下就走起来。
								engine.nextWalkAt = now + 1500 + Math.random() * 2000;
								savePosition();
							} else if (engine.mode === "react" && now >= engine.reactUntil) {
								setClip(engine, "stand", "idle");
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
								if (current.wander && !frozen && !reduceMotion.current && now > engine.nextWalkAt) {
									// 先看要不要跟随（律跟澪、唯跟梓、䌷跟某一队），否则随机方向。
									const plan = planNextMove(engine, now);
									engine.nextWalkAt = now + current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8);
									engine.walkPlan = plan;
									engine.followTarget = plan.follow || null;
									engine.followDeadline = now + 12000;
									engine.walkElapsed = 0;
									if (plan.dx < 0) engine.dir = -1;
									else if (plan.dx > 0) engine.dir = 1;
									engine.clip = "walk";
									engine.frames = walkFrames(meta, engine.dir, current.facingFlipped);
									engine.frame = 0;
									engine.acc = 0;
									engine.mode = "walk";
								}
								if (current.chatter && now > engine.nextTalkAt) {
									engine.nextTalkAt = now + TALK_EVERY[0] + Math.random() * (TALK_EVERY[1] - TALK_EVERY[0]);
									const line = Core.pick(LINES[meta.id] || LINES.yui);
									say(line);
									// 彩蛋：䌷发呆时说到"带了蛋糕"，就把茶会支起来
									if (member.id === "tsumugi" && line.includes("蛋糕") && onTeaPartyRef.current) {
										onTeaPartyRef.current();
									}
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

						// 走路时按位移速度推帧，避免步频和移动速度对不上（看起来像滑步）。
						const walkFps = Math.max(2, Math.min(8, (current.speed * current.scale) / 22));
						let fps = engine.mode === "walk" ? walkFps : engine.clip === "stand" ? 4 : (CLIP_FPS[engine.clip] || 5);
				// 导入的自定义动作：按"整段约 1.6 秒"折算帧率，避免 2-3 帧的图集闪成幻灯片
				if (meta.frameOrder && meta.frameOrder[engine.row] && engine.frames.length) {
					fps = Math.max(1, Math.min(6, engine.frames.length / 1.6));
				}
						const advanced = Core.advanceFrame(engine, dt, fps, engine.frames.length);
						engine.frame = advanced.frame;
						engine.acc = advanced.acc;

						const frames = engine.frames || meta.clips.idle;
						const index = frames[engine.frame % frames.length];
						const rect = Core.frameRect(index, meta.sheet.columns);
						ctx.clearRect(0, 0, CELL, CELL);
						// 不再做运行时镜像：左右方向各有一套原画帧，走路时按 dir 换行。
						ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, CELL, CELL);
					};

					const removeTicker = addTicker(step);
					return () => {
						removeTicker();
						PEERS.delete(member.id);
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
					if (engine) {
						engine.lastInteract = performance.now();
						// 正在溜达时被抓住：先停下再拖，否则拖拽原点和实时位置对不上。
						if (engine.mode === "walk") setClip(engine, "stand", "idle");
						engine.nextWalkAt = engine.lastInteract + settingsRef.current.idleSeconds * 1000 * tempo * (0.6 + Math.random() * 0.8);
					}
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
				}, [setClip, wake]);

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
					const instant = Math.hypot(pointer.vx, pointer.vy);
					if (instant > 120) {
						pointer.kickVx = pointer.vx;
						pointer.kickVy = pointer.vy;
					}
					pointer.peak = Math.max(pointer.peak || 0, instant);
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
						// 连点彩蛋要在双击判定之前记数：不然快速连点全被当成双击吞掉，
						// 2.5 秒内点 15 下永远凑不满。
						if (member.id === "tsumugi") {
							if (now - clickStreakAt.current > 2500) clickStreak.current = 0;
							clickStreakAt.current = now;
							clickStreak.current += 1;
							if (clickStreak.current >= 15) {
								clickStreak.current = 0;
								clickStreakAt.current = 0;
								if (onTeaPartyRef.current) onTeaPartyRef.current();
							}
						}
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
					const speed = Math.max(Math.hypot(pointer.vx || 0, pointer.vy || 0), pointer.peak || 0);
					// 停顿约 0.24 秒说明用户是在"放"，只有真正的快甩才继续甩出去
					const fling = settingsRef.current.throwEnabled !== false && speed >= 260 && idleFor < 240;
					// 茶桌是明确的放下目标：落在桌面上就入座，慢放和快甩都一样
					if (onDropSeat && onDropSeat(member.id, posRef.current)) return;
					if (engine) {
						if (fling) {
							engine.mode = "throw";
							const kx = pointer.kickVx || pointer.vx || 0;
							const ky = pointer.kickVy || pointer.vy || 0;
							const mag = Math.hypot(kx, ky) || 1;
							const boosted = Math.max(mag, 900);
							engine.vx = Core.clamp((kx / mag) * boosted, -2600, 2600);
							engine.vy = Core.clamp((ky / mag) * boosted, -2600, 2600);
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
							setClip(engine, "stand", "idle");
						}
					}
					// 抛出时先不写设置：写设置会触发一次全局重渲染，可能把飞行中的状态冲掉；
					// 落地时会由 savePosition() 再写一次。
					if (!fling) {
						updateSettings((current) => ({
							...current,
							positions: {
								...current.positions,
								[member.id]: { x: Math.round(posRef.current.x), y: Math.round(posRef.current.y) },
							},
						}));
					}
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
						setClip(engine, "stand", "idle");
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
						style: { width: size, height: size, zIndex: menu ? 2147483000 : undefined },
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

			const TABLE_ANIM = {
				yui: [0, 4, 5, 6, 7],
				ritsu: [0, 4, 5],
				tsumugi: [0, 4, 5, 6, 7],
			};

			const tableFramesCache = new Map();
			function loadTableFrames(id) {
				if (tableFramesCache.has(id)) return tableFramesCache.get(id);
				const image = new Image();
				image.src = `${ASSET_BASE}/table/${id}-frames.png?v=${ASSET_REV}`;
				const promise = image.decode().then(() => image).catch((error) => {
					tableFramesCache.delete(id);
					throw error;
				});
				tableFramesCache.set(id, promise);
				return promise;
			}

			// 入座立绘：中间三人按 4x2 帧表循环播放，两侧两人保持静态。
			function TableSeatSprite({ id, animated, style, onPointerDown }) {
				const canvasRef = useRef(null);
				const [image, setImage] = useState(null);
				useEffect(() => {
					if (!animated) return undefined;
					let active = true;
					loadTableFrames(id).then((value) => { if (active) setImage(value); }).catch(() => {});
					return () => { active = false; };
				}, [id, animated]);
				useEffect(() => {
					const canvas = canvasRef.current;
					if (!canvas || !image) return undefined;
					const ctx = canvas.getContext("2d");
					const frames = TABLE_ANIM[id] || [0];
					let frame = 0;
					let acc = 0;
					const draw = () => {
						const index = frames[frame % frames.length];
						const w = TABLE.widths[id] || TABLE.charWidth;
						const sx = (index % 4) * w;
						const sy = Math.floor(index / 4) * TABLE.charHeight;
						ctx.clearRect(0, 0, w, TABLE.charHeight);
						ctx.drawImage(image, sx, sy, w, TABLE.charHeight, 0, 0, w, TABLE.charHeight);
					};
					draw();
					const stop = addTicker((dt) => {
						if (window.document.hidden) return;
						acc += dt;
						const interval = 1 / Math.max(1, TABLE.fps);
						if (acc < interval) return;
						acc %= interval;
						frame += 1;
						draw();
					});
					return stop;
				}, [image, id]);
				if (animated && image) {
					const w = TABLE.widths[id] || TABLE.charWidth;
					return h("canvas", {
						ref: canvasRef,
						width: w,
						height: TABLE.charHeight,
						className: "konp-table-seat",
						"data-char": id,
						style,
						onPointerDown,
					});
				}
				return h("img", {
					className: "konp-table-seat",
					"data-char": id,
					src: `${ASSET_BASE}/table/${id}.png?v=${ASSET_REV}`,
					alt: "",
					draggable: false,
					style,
					onPointerDown,
				});
			}

			function TableScene({ settings, tablePos, onTableMove, onTableCommit, onSeatDrop, updateSettings }) {
				const scale = settings.scale;
				const width = TABLE.width * scale;
				const height = TABLE.height * scale;
				const backRef = useRef(null);
				const frontRef = useRef(null);
				const grabRef = useRef(null);
				const tableDrag = useRef(null);
				const seatDrag = useRef(null);
				const cleanupRef = useRef(() => {});
				const menuRef = useRef(null);
				const [dragging, setDragging] = useState(false);
				const [draggingSeat, setDraggingSeat] = useState(null);
				const [ghost, setGhost] = useState(null);
				const [menu, setMenu] = useState(null);
				const [failed, setFailed] = useState(false);

				useEffect(() => () => cleanupRef.current(), []);

				useEffect(() => {
					if (!menu) return undefined;
					const onDown = (event) => {
						if (menuRef.current && menuRef.current.contains(event.target)) return;
						setMenu(null);
					};
					const onKey = (event) => { if (event.key === "Escape") setMenu(null); };
					window.addEventListener("pointerdown", onDown, true);
					window.addEventListener("keydown", onKey);
					return () => {
						window.removeEventListener("pointerdown", onDown, true);
						window.removeEventListener("keydown", onKey);
					};
				}, [menu]);

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

				const openMenu = (event) => {
					event.preventDefault();
					event.stopPropagation();
					const left = Math.max(8, Math.min(event.clientX, window.innerWidth - 260));
					const top = Math.max(8, Math.min(event.clientY, window.innerHeight - 286));
					setMenu({ left, top });
				};
				const toggleLock = () => {
					updateSettings((current) => ({ ...current, tableLocked: !current.tableLocked }));
					setMenu(null);
				};
				const seatAll = () => {
					const seats = {};
					for (const member of ROSTER) seats[member.id] = true;
					updateSettings((current) => ({ ...current, seats }));
					setMenu(null);
				};
				const unseatAll = () => {
					updateSettings((current) => ({ ...current, seats: {} }));
					setMenu(null);
				};
				const resetTablePosition = () => {
					updateSettings((current) => ({ ...current, tablePos: null }));
					setMenu(null);
				};

				const onGrabDown = (event) => {
					if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
					// 固定后就不再响应拖动；要移动它请右键「取消固定位置」
					if (settings.tableLocked) return;
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
					const box = event.currentTarget.getBoundingClientRect();
					const drag = {
						id: seat.id,
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						offsetX: event.clientX - box.left,
						offsetY: event.clientY - box.top,
						moved: false,
						width: (TABLE.widths[seat.id] || TABLE.charWidth) * scale,
						height: TABLE.charHeight * scale,
					};
					seatDrag.current = drag;
					const move = (moveEvent) => {
						if (moveEvent.pointerId !== drag.pointerId) return;
						const distance = Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY);
						if (!drag.moved && distance > 4) {
							drag.moved = true;
							setDraggingSeat(drag.id);
						}
						if (!drag.moved) return;
						setGhost({
							id: drag.id,
							x: moveEvent.clientX - drag.offsetX,
							y: moveEvent.clientY - drag.offsetY,
						});
					};
					const cleanup = () => {
						window.removeEventListener("pointermove", move);
						window.removeEventListener("pointerup", up);
						window.removeEventListener("pointercancel", up);
						seatDrag.current = null;
						setDraggingSeat(null);
						setGhost(null);
						cleanupRef.current = () => {};
					};
					const up = (upEvent) => {
						if (upEvent.pointerId !== drag.pointerId) return;
						const moved = drag.moved;
						const x = upEvent.clientX - drag.offsetX;
						const y = upEvent.clientY - drag.offsetY;
						cleanup();
						if (moved) onSeatDrop(drag.id, x, y);
					};
					cleanupRef.current = cleanup;
					window.addEventListener("pointermove", move);
					window.addEventListener("pointerup", up);
					window.addEventListener("pointercancel", up);
				};

				return h(React.Fragment, null,
				h("div", {
					className: `konp-table${dragging ? " is-drag" : ""}${settings.tableLocked ? " is-locked" : ""}`,
					style: {
						width: `${width}px`,
						height: `${height}px`,
						zIndex: menu ? 2147483000 : 2147482000,
						pointerEvents: "none",
						transform: `translate3d(${tablePos.x}px, ${tablePos.y}px, 0)`,
					},
					"aria-hidden": failed ? "true" : undefined,
					role: "region",
					tabIndex: 0,
					"aria-label": "K-ON! 茶桌：右键打开茶桌菜单",
					onContextMenu: openMenu,
					onKeyDown: (event) => {
						if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
							event.preventDefault();
							const box = event.currentTarget.getBoundingClientRect();
							openMenu({ clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, preventDefault() {}, stopPropagation() {} });
						}
					},
				},
					h("canvas", { ref: backRef, width: TABLE.width, height: TABLE.height, className: "konp-table-canvas konp-table-back", style: { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" } }),
					h("div", {
						ref: grabRef,
						className: "konp-table-grab",
						style: { position: "absolute", inset: 0, zIndex: 1, pointerEvents: "auto", cursor: settings.tableLocked ? "default" : "grab" },
						onPointerDown: onGrabDown,
						onPointerMove: onGrabMove,
						onPointerUp: onGrabUp,
						onPointerCancel: onGrabUp,
						role: "presentation",
					}),
					TABLE.seats.map((seat) => {
						if (!settings.visible[seat.id] || !settings.seats[seat.id] || draggingSeat === seat.id) return null;
						return h(TableSeatSprite, {
							key: seat.id,
							id: seat.id,
							animated: Boolean(TABLE_ANIM[seat.id]),
							style: {
								position: "absolute",
								zIndex: seat.id === "yui" ? 1 : 2,
								pointerEvents: "auto",
								left: `${seat.x * scale}px`,
								top: `${TABLE.charTop * scale}px`,
								width: `${(TABLE.widths[seat.id] || TABLE.charWidth) * scale}px`,
								height: `${TABLE.charHeight * scale}px`,
								transform: seat.mirror ? "scaleX(-1)" : undefined,
							},
							onPointerDown: (event) => onSeatDown(event, seat),
						});
					}),
					h("canvas", { ref: frontRef, width: TABLE.width, height: TABLE.height, className: "konp-table-canvas konp-table-front", style: { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 3, pointerEvents: "none" } }),
					failed ? h("div", { className: "konp-fallback" }, "桌子素材加载失败") : null,
				),
				ghost ? h(SeatGhost, {
					id: ghost.id,
					x: ghost.x,
					y: ghost.y,
					width: CELL * scale,
					height: CELL * scale,
				}) : null,
				menu ? h("div", {
					ref: menuRef,
					className: "konp-menu konp-table-menu",
					style: { left: menu.left, top: menu.top },
					role: "dialog",
					"aria-label": "茶桌设置",
					onPointerDown: (event) => event.stopPropagation(),
					onContextMenu: (event) => event.preventDefault(),
				},
					h("div", { className: "konp-menu-head" },
						h("span", null, "茶桌"),
						h("button", { className: "konp-x", type: "button", "aria-label": "关闭", onClick: () => setMenu(null) }, "×"),
					),
					h("div", { className: "konp-menu-name" }, "轻音部茶桌"),
					h("button", { className: "konp-hide", type: "button", onClick: toggleLock }, settings.tableLocked ? "取消固定位置" : "固定桌子位置"),
					h("button", { className: "konp-hide", type: "button", onClick: seatAll }, "全部角色入座"),
					h("button", { className: "konp-hide", type: "button", onClick: unseatAll }, "全部角色离座"),
					h("button", { className: "konp-hide", type: "button", onClick: resetTablePosition }, "恢复默认位置"),
					h("p", { className: "konp-tip" }, "角色拖到桌子区域即入座；从座位拖出离座；没固定时拖桌沿空白处可以移动桌子。"),
				) : null,
				);
			}

			function KOnPet() {
				const settings = useSettings();
				ACTION_OVERRIDES = settings.actionOverrides || {};
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
					if (!settings.table) return;
					Object.keys(settings.seats).filter((id) => settings.seats[id]).forEach((id) => {
						loadSeatGhost(id).catch(() => {});
					});
				}, [settings.table, settings.seats]);

				// 彩蛋：䌷说"我带了蛋糕"时，把茶桌摆到右下角，她先入座，其余人依次坐下。
				const teaTimers = useRef([]);
				const teaRunning = useRef(false);
				const startTeaParty = useCallback(() => {
					if (teaRunning.current) return;
					if (!settings.follow) return; // 「启用彩蛋」总开关
					const chance = settings.teaPartyChance ?? 100;
					if (Math.random() * 100 > chance) return;
					teaRunning.current = true;
					const scale = settings.scale;
					const pos = {
						x: Math.max(8, Math.round(window.innerWidth - TABLE.width * scale - 24)),
						y: Math.max(8, Math.round(window.innerHeight - TABLE.height * scale - 140)),
					};
					updateSettings((current) => ({
						...current,
						table: true,
						// 茶会摆好后把桌子固定住：这时候整桌都是座位，拖到的都是角色，
						// 桌子乱跑会把一桌人拆散。右键菜单里显示「取消固定位置」可以解开。
						tableLocked: true,
						tablePos: pos,
						seats: {},
					}));
					const order = ["tsumugi", "mio", "ritsu", "yui", "azusa"];
					teaTimers.current.forEach((timer) => clearTimeout(timer));
					teaTimers.current = order.map((id, index) => window.setTimeout(() => {
						updateSettings((current) => ({ ...current, seats: { ...current.seats, [id]: true } }));
					}, 700 + index * 900));
					teaTimers.current.push(window.setTimeout(() => { teaRunning.current = false; }, 700 + order.length * 900 + 600));
				}, [settings.scale, settings.teaPartyChance, updateSettings]);

				useEffect(() => () => {
					teaTimers.current.forEach((timer) => clearTimeout(timer));
					teaTimers.current = [];
				}, []);

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
					const tx = tableRef.current.x;
					const ty = tableRef.current.y;
					const tw = TABLE.width * settings.scale;
					const th = TABLE.height * settings.scale;
					// 角色和茶桌有任意重叠就入座，不再要求精确落到某把椅子上。
					const onTable = position.x < tx + tw && position.x + size > tx &&
						position.y < ty + th && position.y + size > ty;
					if (!onTable) return false;
					updateSettings((current) => ({
						...current,
						seats: { ...current.seats, [id]: true },
					}));
					return true;
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
						seats: { ...current.seats, [id]: false },
						positions: { ...current.positions, [id]: { x: Math.round(x), y: Math.round(y) } },
					}));
				};

				// 回位导航：给出该角色座位中心（视口坐标）。
				const getSeatTarget = (id) => {
					if (!settings.table) return null;
					const seat = TABLE.seats.find((entry) => entry.id === id);
					if (!seat) return null;
					const rect = Core.tableSeatRect(seat, tableRef.current.x, tableRef.current.y, settings.scale);
					return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
				};

				return h("div", { className: "konp-root" },
					styleElement(),
					settings.table ? h(TableScene, {
						settings,
						tablePos,
						onTableMove: (x, y) => setTablePos(Core.clampTablePosition(x, y, settings.scale, window.innerWidth, window.innerHeight)),
						onTableCommit: () => updateSettings((current) => ({
							...current,
							tablePos: { x: tableRef.current.x, y: tableRef.current.y },
						})),
						onSeatDrop,
						updateSettings,
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
						onTeaParty: startTeaParty,
						// 自动回位：茶桌开着时，先把座位状态置为已入座
						onAutoSeat: (id) => updateSettings((current) => (
							current.table ? { ...current, seats: { ...current.seats, [id]: true } } : current
						)),
						getSeatTarget,
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
