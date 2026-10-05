import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
//#region src/index.ts
const CONFIG = {
	spritePath: fileURLToPath(new URL("../../assets/spritesheet.webp", import.meta.url)),
	voicePath: fileURLToPath(new URL("../../assets/voice.mp3", import.meta.url)),
	voiceWavPath: fileURLToPath(new URL("../../assets/voice.wav", import.meta.url)),
	spriteMaxBytes: 16777216,
	voiceMaxBytes: 8388608,
	pollMs: 500,
	celebrateMs: 4800,
	failedMs: 2600
};
const PS_ARGS = (script) => [
	"-NoProfile",
	"-NonInteractive",
	"-WindowStyle",
	"Hidden",
	"-STA",
	"-EncodedCommand",
	Buffer.from(script, "utf16le").toString("base64")
];
const voiceLaunch = (mp3Path, wavPath) => {
	if (process.platform === "win32") {
		if (typeof wavPath === "string" && wavPath !== "") {
			const p = String(wavPath).replace(/'/g, "''");
			return {
				command: "powershell.exe",
				args: PS_ARGS(`$player = New-Object System.Media.SoundPlayer '${p}'; $player.PlaySync()`)
			};
		}
		const script = [
			"Add-Type -AssemblyName PresentationCore",
			"$player = New-Object System.Windows.Media.MediaPlayer",
			`$player.Open([Uri]'${String(mp3Path).replace(/'/g, "''")}')`,
			"$player.Volume = 1.0",
			"$player.Play()",
			"Start-Sleep -Milliseconds 4200",
			"$player.Close()"
		].join("; ");
		return {
			command: "powershell.exe",
			args: PS_ARGS(script)
		};
	}
	if (process.platform === "darwin") return {
		command: "afplay",
		args: [String(mp3Path)]
	};
	return {
		command: "ffplay",
		args: [
			"-nodisp",
			"-autoexit",
			"-loglevel",
			"quiet",
			String(mp3Path)
		]
	};
};
const name = "dsh-kun-like-pet";
const inject = [
	"timer",
	"tools",
	"webServer",
	"agents"
];
function apply(ctx) {
	const webServer = ctx.get("webServer");
	if (webServer === void 0) {
		console.error("[kun-pet] webServer service is unavailable");
		return;
	}
	let disposed = false;
	const routeDisposers = [];
	const loadAsset = (label, path, maxBytes) => {
		try {
			const bytes = readFileSync(path);
			if (bytes.length > maxBytes) {
				console.error(`[kun-pet] ${label} exceeds ${maxBytes} bytes, skipped`);
				return null;
			}
			console.log(`[kun-pet] ${label} loaded:`, bytes.length, "bytes");
			return bytes;
		} catch (err) {
			console.error(`[kun-pet] failed to load ${label}:`, err);
			return null;
		}
	};
	const spriteBytes = loadAsset("spritesheet", CONFIG.spritePath, CONFIG.spriteMaxBytes);
	const voiceBytes = loadAsset("voice", CONFIG.voicePath, CONFIG.voiceMaxBytes);
	const voiceWavPath = existsSync(CONFIG.voiceWavPath) ? CONFIG.voiceWavPath : null;
	const registerBinaryRoute = (path, bytes, contentType) => {
		if (bytes === null) return;
		routeDisposers.push(webServer.register({
			kind: "exact",
			path,
			handler: (req, res) => {
				res.writeHead(200, {
					"Content-Type": contentType,
					"Content-Length": String(bytes.length),
					"Cache-Control": "public, max-age=86400"
				});
				res.end(bytes);
			}
		}));
	};
	registerBinaryRoute("/kun-pet/spritesheet.webp", spriteBytes, "image/webp");
	registerBinaryRoute("/kun-pet/voice.mp3", voiceBytes, "audio/mpeg");
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
		try {
			const { command, args } = voiceLaunch(CONFIG.voicePath, voiceWavPath);
			const child = spawn(command, args, {
				detached: true,
				stdio: "ignore",
				windowsHide: true
			});
			child.on("error", (err) => {
				lastPlayError = String(err && err.message ? err.message : err);
				console.error("[kun-pet] voice playback failed:", err);
			});
			child.unref();
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
	ctx.on("agent/request-error", (payload, next) => {
		rawRequestError++;
		if (payload && payload.agent) {
			flagsOf(payload.agent).errored = true;
			errorMarks++;
		}
		showFailed();
		return typeof next === "function" ? next() : void 0;
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
	if (!disposed) routeDisposers.push(webServer.register({
		kind: "exact",
		path: "/kun-pet/state",
		handler: (req, res) => {
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
		}
	}));
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map