import { defineTool } from "@deepseek-ai/dsh-tools";
import { fileURLToPath } from "node:url";
//#region src/index.ts
const CONFIG = {
	spritePath: fileURLToPath(new URL("../../assets/spritesheet.webp", import.meta.url)),
	voicePath: fileURLToPath(new URL("../../assets/voice.mp3", import.meta.url)),
	playCommand: (path) => {
		if (process.platform === "win32") {
			const script = [
				"Add-Type -AssemblyName PresentationCore",
				"$player = New-Object System.Windows.Media.MediaPlayer",
				`$player.Open([Uri]'${String(path).replace(/'/g, "''")}')`,
				"$player.Play()",
				"Start-Sleep -Milliseconds 4200",
				"$player.Close()"
			].join("; ");
			return `powershell.exe -NoProfile -WindowStyle Hidden -STA -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
		}
		if (process.platform === "darwin") return "afplay '" + String(path).replace(/'/g, "'\\''") + "'";
		return "ffplay -nodisp -autoexit '" + String(path).replace(/'/g, "'\\''") + "'";
	},
	pollMs: 500,
	celebrateMs: 4800,
	failedMs: 2600
};
const name = "dsh-kun-like-pet";
const inject = [
	"timer",
	"tools",
	"fs",
	"webServer",
	"agents",
	"shell"
];
function apply(ctx) {
	const fs = ctx.get("fs");
	const webServer = ctx.get("webServer");
	if (fs === void 0 || webServer === void 0) {
		console.error("[kun-pet] fs or webServer service is unavailable");
		return;
	}
	let spriteBytes = null;
	let voiceBytes = null;
	let disposed = false;
	const routeDisposers = [];
	const registerRoutes = () => {
		if (spriteBytes !== null) routeDisposers.push(webServer.register({
			kind: "exact",
			path: "/kun-pet/spritesheet.webp",
			handler: (req, res) => {
				res.writeHead(200, {
					"Content-Type": "image/webp",
					"Content-Length": String(spriteBytes.length),
					"Cache-Control": "public, max-age=86400"
				});
				res.end(spriteBytes);
			}
		}));
		if (voiceBytes !== null) routeDisposers.push(webServer.register({
			kind: "exact",
			path: "/kun-pet/voice.mp3",
			handler: (req, res) => {
				res.writeHead(200, {
					"Content-Type": "audio/mpeg",
					"Content-Length": String(voiceBytes.length),
					"Cache-Control": "public, max-age=86400"
				});
				res.end(voiceBytes);
			}
		}));
		routeDisposers.push(webServer.register({
			kind: "exact",
			path: "/kun-pet/state",
			handler: (req, res) => {
				Promise.resolve(assetsReady).then(() => {
					res.writeHead(200, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store"
					});
					res.end(JSON.stringify({
						mode,
						seq,
						spriteUrl: spriteBytes !== null ? "/kun-pet/spritesheet.webp" : null,
						voiceUrl: voiceBytes !== null ? "/kun-pet/voice.mp3" : null
					}));
				}).catch((err) => {
					if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: String(err && err.message ? err.message : err) }));
				});
			}
		}));
	};
	const loadAssets = async () => {
		try {
			const target = await fs.resolve(CONFIG.spritePath);
			spriteBytes = await fs.readBytes(target, void 0, 16777216);
			console.log("[kun-pet] spritesheet loaded:", spriteBytes.length, "bytes");
		} catch (err) {
			console.error("[kun-pet] failed to load spritesheet:", err);
		}
		try {
			const target = await fs.resolve(CONFIG.voicePath);
			voiceBytes = await fs.readBytes(target, void 0, 8388608);
			console.log("[kun-pet] voice loaded:", voiceBytes.length, "bytes");
		} catch (err) {
			console.error("[kun-pet] failed to load voice:", err);
		}
		if (!disposed) registerRoutes();
	};
	const assetsReady = loadAssets();
	let mode = "idle";
	let seq = 0;
	let celebrating = false;
	let failing = false;
	let celebrateTimer = null;
	let failTimer = null;
	let celebrateCount = 0;
	let workMarks = 0;
	let errorMarks = 0;
	let transitionsSeen = 0;
	let pollCount = 0;
	let rawExecute = 0;
	let rawApproval = 0;
	let rawRequestError = 0;
	let toolsInFlight = 0;
	let recentTool = false;
	let recentToolTimer = null;
	let waitingCount = 0;
	let lastAgentStatuses = [];
	let lastPlayError = null;
	const turnFlags = /* @__PURE__ */ new WeakMap();
	const lastStatus = /* @__PURE__ */ new WeakMap();
	const observedAgents = /* @__PURE__ */ new Set();
	let flagEntries = 0;
	const flagsOf = (agent) => {
		let f = turnFlags.get(agent);
		if (f === void 0) {
			f = {
				worked: false,
				errored: false
			};
			turnFlags.set(agent, f);
			flagEntries++;
		}
		return f;
	};
	const lastStatusEntries = () => {
		const out = [];
		for (const agent of observedAgents) {
			const s = lastStatus.get(agent);
			if (s !== void 0) out.push([agent, s]);
		}
		return out;
	};
	const currentRunningCount = () => {
		let n = 0;
		for (const entry of lastStatusEntries()) if (entry[1] === "running") n++;
		return n;
	};
	const setMode = (next) => {
		if (next === mode) return;
		if (celebrating && next !== "celebrating") return;
		mode = next;
		seq++;
	};
	const deriveMode = (runningCount) => {
		if (celebrating || failing) return;
		let next;
		if (waitingCount > 0) next = "waiting";
		else if (runningCount > 0) next = toolsInFlight > 0 || recentTool ? "working" : "review";
		else next = "idle";
		setMode(next);
	};
	const playSystemVoice = () => {
		const shell = ctx.get("shell");
		if (shell === void 0) {
			lastPlayError = "shell service unavailable";
			return;
		}
		try {
			const spec = shell.resolve({ command: CONFIG.playCommand(CONFIG.voicePath) });
			shell.run(spec).catch((err) => {
				lastPlayError = String(err && err.message ? err.message : err);
			});
			lastPlayError = null;
		} catch (err) {
			lastPlayError = String(err && err.message ? err.message : err);
			console.error("[kun-pet] failed to start voice playback:", err);
		}
	};
	const celebrate = () => {
		if (celebrating) {
			if (celebrateTimer) celebrateTimer();
			celebrateTimer = ctx.timeout(() => {
				celebrateTimer = null;
				celebrating = false;
				deriveMode(currentRunningCount());
			}, CONFIG.celebrateMs);
			return;
		}
		celebrateCount++;
		celebrating = true;
		setMode("celebrating");
		playSystemVoice();
		celebrateTimer = ctx.timeout(() => {
			celebrateTimer = null;
			celebrating = false;
			deriveMode(currentRunningCount());
		}, CONFIG.celebrateMs);
	};
	const showFailed = () => {
		if (celebrating) return;
		failing = true;
		setMode("failed");
		if (failTimer) failTimer();
		failTimer = ctx.timeout(() => {
			failTimer = null;
			failing = false;
			deriveMode(currentRunningCount());
		}, CONFIG.failedMs);
	};
	const markToolSettled = (wasQuestion) => {
		toolsInFlight = Math.max(0, toolsInFlight - 1);
		if (wasQuestion) waitingCount = Math.max(0, waitingCount - 1);
		if (toolsInFlight === 0) {
			if (recentToolTimer) recentToolTimer();
			recentToolTimer = ctx.timeout(() => {
				recentToolTimer = null;
				recentTool = false;
				deriveMode(currentRunningCount());
			}, 2500);
		}
		deriveMode(currentRunningCount());
	};
	ctx.effect(() => () => {
		disposed = true;
		for (const d of routeDisposers) d();
		if (celebrateTimer) celebrateTimer();
		if (failTimer) failTimer();
		if (recentToolTimer) recentToolTimer();
	});
	const agentsService = ctx.get("agents");
	const clearFlags = (agent) => {
		if (turnFlags.delete(agent)) flagEntries = Math.max(0, flagEntries - 1);
	};
	const observeStatus = (agent, status) => {
		if (!agent) return false;
		const prev = lastStatus.get(agent);
		observedAgents.add(agent);
		lastStatus.set(agent, status);
		return prev === "running" && status === "idle";
	};
	const handleCompletedAgents = (completed, runningCount) => {
		if (completed.length === 0) return;
		let successful = false;
		for (const agent of completed) {
			transitionsSeen++;
			const f = turnFlags.get(agent);
			if (f === void 0 || !f.errored) successful = true;
			clearFlags(agent);
		}
		if (successful && runningCount === 0 && waitingCount === 0) celebrate();
	};
	const readStatus = (agent) => {
		try {
			return agent && agent.status === "running" ? "running" : "idle";
		} catch (err) {
			return "idle";
		}
	};
	const syncAgents = (list) => {
		const live = /* @__PURE__ */ new Set();
		const completed = [];
		const statuses = [];
		for (const agent of list) {
			if (!agent) continue;
			live.add(agent);
			const status = readStatus(agent);
			statuses.push(status);
			if (observeStatus(agent, status)) completed.push(agent);
		}
		for (const agent of observedAgents) {
			if (live.has(agent)) continue;
			const wasRunning = lastStatus.get(agent) === "running";
			observedAgents.delete(agent);
			lastStatus.delete(agent);
			if (wasRunning) completed.push(agent);
			else clearFlags(agent);
		}
		lastAgentStatuses = statuses;
		const runningCount = statuses.filter((status) => status === "running").length;
		handleCompletedAgents(completed, runningCount);
		deriveMode(runningCount);
	};
	const poll = () => {
		pollCount++;
		if (agentsService === void 0) return;
		let list;
		try {
			list = agentsService.list();
		} catch (err) {
			return;
		}
		if (!Array.isArray(list)) return;
		syncAgents(list);
	};
	const stopPolling = ctx.interval(poll, CONFIG.pollMs);
	ctx.effect(() => stopPolling);
	ctx.on("agent/status", (payload) => {
		if (!payload || !payload.agent) return;
		const status = payload.status === "running" ? "running" : "idle";
		const completed = observeStatus(payload.agent, status) ? [payload.agent] : [];
		let runningCount = currentRunningCount();
		try {
			const list = agentsService.list();
			if (Array.isArray(list)) {
				lastAgentStatuses = list.map(readStatus);
				runningCount = lastAgentStatuses.filter((item) => item === "running").length;
			}
		} catch (err) {}
		handleCompletedAgents(completed, runningCount);
		deriveMode(runningCount);
	});
	ctx.on("approval/request", (req, next) => {
		rawApproval++;
		waitingCount++;
		deriveMode(currentRunningCount());
		let p;
		try {
			p = Promise.resolve(next());
		} catch (err) {
			waitingCount = Math.max(0, waitingCount - 1);
			deriveMode(currentRunningCount());
			throw err;
		}
		p.then(() => {
			waitingCount = Math.max(0, waitingCount - 1);
			deriveMode(currentRunningCount());
		}, () => {
			waitingCount = Math.max(0, waitingCount - 1);
			deriveMode(currentRunningCount());
		});
		return p;
	});
	ctx.on("tools/execute", (exec, next) => {
		rawExecute++;
		let isQuestion = false;
		if (exec && exec.agent) {
			flagsOf(exec.agent).worked = true;
			workMarks++;
		}
		if (exec && typeof exec.name === "string" && exec.name === "ask_user_question") {
			isQuestion = true;
			waitingCount++;
		}
		toolsInFlight++;
		recentTool = true;
		if (recentToolTimer) {
			recentToolTimer();
			recentToolTimer = null;
		}
		deriveMode(currentRunningCount());
		let p;
		try {
			p = Promise.resolve(next());
		} catch (err) {
			markToolSettled(isQuestion);
			throw err;
		}
		p.then(() => markToolSettled(isQuestion), () => markToolSettled(isQuestion));
		return p;
	});
	ctx.on("agent/request-error", (payload) => {
		rawRequestError++;
		if (payload && payload.agent) {
			flagsOf(payload.agent).errored = true;
			errorMarks++;
		}
		showFailed();
	});
	ctx.effect(() => ctx.get("tools").register(defineTool({
		name: "kun_pet_debug",
		description: "Read the Kun Like desktop-pet state machine internals and polling counters. Use only to diagnose pet behavior.",
		parameters: {},
		output: {
			schema: { type: "json" },
			render: (_args, value) => [{
				type: "text",
				text: JSON.stringify(value, null, 2)
			}]
		},
		execute() {
			return Promise.resolve({
				mode,
				seq,
				celebrating,
				failing,
				celebrateCount,
				workMarks,
				errorMarks,
				transitionsSeen,
				flagEntries,
				waitingCount,
				toolsInFlight,
				recentTool,
				pollCount,
				agentCount: lastAgentStatuses.length,
				lastAgentStatuses,
				lastPlayError,
				raw: {
					execute: rawExecute,
					approval: rawApproval,
					requestError: rawRequestError
				}
			});
		}
	})));
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map