// @ts-nocheck
// =============================================================================
// Kun Like 桌宠 · DSH 本地静态 bundle 插件（Host 半）
//
// 职责：
//   1. 读取包内素材（精灵图 + 完成音），通过 webServer 注册 HTTP 路由给浏览器加载
//   2. 监听 agent/status 并以 agents.list() 轮询兜底，推导桌宠状态机
//   3. 任务完成时由宿主进程播放「你干嘛~哎哟」（跨平台，不经 shell 缝）
//   4. 提供 /kun-pet/state HTTP 状态接口与 kun_pet_debug 调试工具
//
// DSH 0.2 适配说明（相对 2.0.0 的 0.1 实现）：
//   · 0.1 的 `shell.run(spec)` 已拆成 `ShellExecutor.resolve()` + `execute()`，
//     且解析结果会带上执行器的默认沙箱策略。桌宠完成音只是一次性界面反馈，
//     不需要工作目录 / 超时 / 沙箱语义（Windows 沙箱在只读模式下会把
//     PowerShell 降级为 ConstrainedLanguage，WPF MediaPlayer 直接不可用），
//     因此这里直接 spawn 子进程，绕开会话沙箱。
//   · 素材同理走 node:fs：它们是插件包自身的文件，不属于会话 workspace。
//   · agent/request-error 是 waterfall 事件，监听器必须调用 next() 放行，
//     否则会否决内置行为与后续重试链。
//   · Windows 完成音改用 WAV + System.Media.SoundPlayer（winmm），不再依赖
//     WPF MediaPlayer / Media Foundation；MP3 仅在缺少 WAV 时作为退路。
// =============================================================================
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ===== 配置区 =====
const CONFIG = {
  // 精灵图路径（8 列 × 9 行、每格 192×208 的 WebP）
  spritePath: fileURLToPath(new URL('../../assets/spritesheet.webp', import.meta.url)),
  // 任务完成提示音路径（mp3，浏览器点击互动也用它）
  voicePath: fileURLToPath(new URL('../../assets/voice.mp3', import.meta.url)),
  // 宿主完成音的 WAV 版本：Windows 走 System.Media.SoundPlayer（winmm），
  // 不依赖 Media Foundation，比 WPF MediaPlayer 可靠得多。
  voiceWavPath: fileURLToPath(new URL('../../assets/voice.wav', import.meta.url)),
  // 素材体积上限，防止误替换的大文件打爆内存
  spriteMaxBytes: 16 * 1024 * 1024,
  voiceMaxBytes: 8 * 1024 * 1024,
  // 状态轮询间隔（毫秒）
  pollMs: 500,
  // 庆祝动画持续时长（毫秒）
  celebrateMs: 4800,
  // 失败动画持续时长（毫秒）
  failedMs: 2600,
}

const PS_ARGS = (script) => [
  '-NoProfile',
  '-NonInteractive',
  '-WindowStyle',
  'Hidden',
  '-STA',
  '-EncodedCommand',
  Buffer.from(script, 'utf16le').toString('base64'),
]

// 宿主进程系统级播放命令：
//   Windows —— 首选 WAV + System.Media.SoundPlayer（winmm PlaySound，无需
//   dispatcher/Media Foundation）；没有 WAV 时退回 MP3 + WPF MediaPlayer
//   （System.Media.SoundPlayer 不支持 MP3）。
//   macOS —— afplay；Linux —— ffplay。
const voiceLaunch = (mp3Path, wavPath) => {
  if (process.platform === 'win32') {
    if (typeof wavPath === 'string' && wavPath !== '') {
      const p = String(wavPath).replace(/'/g, "''")
      return {
        command: 'powershell.exe',
        args: PS_ARGS(`$player = New-Object System.Media.SoundPlayer '${p}'; $player.PlaySync()`),
      }
    }
    const p = String(mp3Path).replace(/'/g, "''")
    const script = [
      'Add-Type -AssemblyName PresentationCore',
      '$player = New-Object System.Windows.Media.MediaPlayer',
      `$player.Open([Uri]'${p}')`,
      '$player.Volume = 1.0',
      '$player.Play()',
      'Start-Sleep -Milliseconds 4200',
      '$player.Close()',
    ].join('; ')
    return { command: 'powershell.exe', args: PS_ARGS(script) }
  }
  if (process.platform === 'darwin') {
    return { command: 'afplay', args: [String(mp3Path)] }
  }
  return { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', String(mp3Path)] }
}

export const name = 'dsh-kun-like-pet'
// Cordis only calls apply after every required Host service is ready. Without
// these declarations a bundle appended after dsh-web-app can still race the
// asynchronous service initializers and silently return before registering.
export const inject = ['timer', 'tools', 'webServer', 'agents']

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    console.error('[kun-pet] webServer service is unavailable')
    return
  }

  // ---------- load pet assets once ----------
  let disposed = false
  const routeDisposers = []

  const loadAsset = (label, path, maxBytes) => {
    try {
      const bytes = readFileSync(path)
      if (bytes.length > maxBytes) {
        console.error(`[kun-pet] ${label} exceeds ${maxBytes} bytes, skipped`)
        return null
      }
      console.log(`[kun-pet] ${label} loaded:`, bytes.length, 'bytes')
      return bytes
    } catch (err) {
      console.error(`[kun-pet] failed to load ${label}:`, err)
      return null
    }
  }

  const spriteBytes = loadAsset('spritesheet', CONFIG.spritePath, CONFIG.spriteMaxBytes)
  const voiceBytes = loadAsset('voice', CONFIG.voicePath, CONFIG.voiceMaxBytes)
  const voiceWavPath = existsSync(CONFIG.voiceWavPath) ? CONFIG.voiceWavPath : null

  const registerBinaryRoute = (path, bytes, contentType) => {
    if (bytes === null) return
    routeDisposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=86400',
        })
        res.end(bytes)
      },
    }))
  }

  registerBinaryRoute('/kun-pet/spritesheet.webp', spriteBytes, 'image/webp')
  registerBinaryRoute('/kun-pet/voice.mp3', voiceBytes, 'audio/mpeg')

  // ---------- pet state machine (polling-driven) ----------
  let mode = 'idle'
  let seq = 0
  let celebrating = false
  let failing = false
  let celebrateTimer = null
  let failTimer = null
  let celebrateCount = 0
  let workMarks = 0
  let errorMarks = 0
  let transitionsSeen = 0
  let pollCount = 0
  let rawExecute = 0
  let rawApproval = 0
  let rawRequestError = 0
  let toolsInFlight = 0
  let recentTool = false
  let recentToolTimer = null
  let waitingCount = 0
  let lastAgentStatuses = []
  let lastPlayError = null

  const turnFlags = new WeakMap() // agent -> { worked, errored }
  const lastStatus = new WeakMap() // agent -> 'idle' | 'running'
  const observedAgents = new Set()
  let flagEntries = 0
  const flagsOf = (agent) => {
    let f = turnFlags.get(agent)
    if (f === undefined) {
      f = { worked: false, errored: false }
      turnFlags.set(agent, f)
      flagEntries++
    }
    return f
  }

  const lastStatusEntries = () => {
    const out = []
    for (const agent of observedAgents) {
      const s = lastStatus.get(agent)
      if (s !== undefined) out.push([agent, s])
    }
    return out
  }

  const currentRunningCount = () => {
    let n = 0
    for (const entry of lastStatusEntries()) {
      if (entry[1] === 'running') n++
    }
    return n
  }

  const setMode = (next) => {
    if (next === mode) return
    if (celebrating && next !== 'celebrating') return
    mode = next
    seq++
  }

  const deriveMode = (runningCount) => {
    if (celebrating || failing) return
    let next
    if (waitingCount > 0) next = 'waiting'
    else if (runningCount > 0) next = (toolsInFlight > 0 || recentTool) ? 'working' : 'review'
    else next = 'idle'
    setMode(next)
  }

  const playSystemVoice = () => {
    try {
      const { command, args } = voiceLaunch(CONFIG.voicePath, voiceWavPath)
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', (err) => {
        lastPlayError = String(err && err.message ? err.message : err)
        console.error('[kun-pet] voice playback failed:', err)
      })
      child.unref()
      lastPlayError = null
    } catch (err) {
      lastPlayError = String(err && err.message ? err.message : err)
      console.error('[kun-pet] failed to start voice playback:', err)
    }
  }

  const celebrate = () => {
    if (celebrating) {
      // Extend the ongoing celebration; never double-fire the sound.
      if (celebrateTimer) celebrateTimer()
      celebrateTimer = ctx.timeout(() => {
        celebrateTimer = null
        celebrating = false
        deriveMode(currentRunningCount())
      }, CONFIG.celebrateMs)
      return
    }
    celebrateCount++
    celebrating = true
    setMode('celebrating')
    playSystemVoice()
    celebrateTimer = ctx.timeout(() => {
      celebrateTimer = null
      celebrating = false
      deriveMode(currentRunningCount())
    }, CONFIG.celebrateMs)
  }

  const showFailed = () => {
    if (celebrating) return
    failing = true
    setMode('failed')
    if (failTimer) failTimer()
    failTimer = ctx.timeout(() => {
      failTimer = null
      failing = false
      deriveMode(currentRunningCount())
    }, CONFIG.failedMs)
  }

  const markToolSettled = (wasQuestion) => {
    toolsInFlight = Math.max(0, toolsInFlight - 1)
    if (wasQuestion) {
      waitingCount = Math.max(0, waitingCount - 1)
    }
    if (toolsInFlight === 0) {
      if (recentToolTimer) recentToolTimer()
      recentToolTimer = ctx.timeout(() => {
        recentToolTimer = null
        recentTool = false
        deriveMode(currentRunningCount())
      }, 2500)
    }
    deriveMode(currentRunningCount())
  }

  ctx.effect(() => () => {
    disposed = true
    for (const d of routeDisposers) d()
    if (celebrateTimer) celebrateTimer()
    if (failTimer) failTimer()
    if (recentToolTimer) recentToolTimer()
  })

  // ---------- live agent statuses + polling fallback ----------
  const agentsService = ctx.get('agents')
  const clearFlags = (agent) => {
    if (turnFlags.delete(agent)) flagEntries = Math.max(0, flagEntries - 1)
  }

  const observeStatus = (agent, status) => {
    if (!agent) return false
    const prev = lastStatus.get(agent)
    observedAgents.add(agent)
    lastStatus.set(agent, status)
    return prev === 'running' && status === 'idle'
  }

  const handleCompletedAgents = (completed, runningCount) => {
    if (completed.length === 0) return
    let successful = false
    for (const agent of completed) {
      transitionsSeen++
      const f = turnFlags.get(agent)
      if (f === undefined || !f.errored) successful = true
      clearFlags(agent)
    }
    if (successful && runningCount === 0 && waitingCount === 0) celebrate()
  }

  const readStatus = (agent) => {
    try {
      return agent && agent.status === 'running' ? 'running' : 'idle'
    } catch (err) {
      return 'idle'
    }
  }

  const syncAgents = (list) => {
    const live = new Set()
    const completed = []
    const statuses = []
    for (const agent of list) {
      if (!agent) continue
      live.add(agent)
      const status = readStatus(agent)
      statuses.push(status)
      if (observeStatus(agent, status)) completed.push(agent)
    }
    for (const agent of observedAgents) {
      if (live.has(agent)) continue
      const wasRunning = lastStatus.get(agent) === 'running'
      observedAgents.delete(agent)
      lastStatus.delete(agent)
      // Some registries dispose a completed Agent before exposing an idle
      // snapshot. Treat disappearance-after-running as completion so the
      // polling fallback does not miss the celebration.
      if (wasRunning) completed.push(agent)
      else clearFlags(agent)
    }
    lastAgentStatuses = statuses
    const runningCount = statuses.filter((status) => status === 'running').length
    handleCompletedAgents(completed, runningCount)
    deriveMode(runningCount)
  }

  const poll = () => {
    pollCount++
    if (agentsService === undefined) return
    let list
    try {
      list = agentsService.list()
    } catch (err) {
      return
    }
    if (!Array.isArray(list)) return
    syncAgents(list)
  }
  const stopPolling = ctx.interval(poll, CONFIG.pollMs)
  ctx.effect(() => stopPolling)

  // Static bundle plugins receive the Host event bus directly. Polling remains
  // as a compatibility fallback and also reconciles disposal/missed events.
  ctx.on('agent/status', (payload) => {
    if (!payload || !payload.agent) return
    const status = payload.status === 'running' ? 'running' : 'idle'
    const completed = observeStatus(payload.agent, status) ? [payload.agent] : []
    let runningCount = currentRunningCount()
    try {
      const list = agentsService.list()
      if (Array.isArray(list)) {
        lastAgentStatuses = list.map(readStatus)
        runningCount = lastAgentStatuses.filter((item) => item === 'running').length
      }
    } catch (err) {
      // Keep the event-derived count; the next poll will reconcile the registry.
    }
    handleCompletedAgents(completed, runningCount)
    deriveMode(runningCount)
  })

  // ---------- waterfalls (waiting + errors) ----------
  ctx.on('approval/request', (req, next) => {
    rawApproval++
    waitingCount++
    deriveMode(currentRunningCount())
    let p
    try {
      p = Promise.resolve(next())
    } catch (err) {
      waitingCount = Math.max(0, waitingCount - 1)
      deriveMode(currentRunningCount())
      throw err
    }
    p.then(
      () => { waitingCount = Math.max(0, waitingCount - 1); deriveMode(currentRunningCount()) },
      () => { waitingCount = Math.max(0, waitingCount - 1); deriveMode(currentRunningCount()) },
    )
    return p
  })

  ctx.on('tools/execute', (exec, next) => {
    rawExecute++
    let isQuestion = false
    if (exec && exec.agent) {
      flagsOf(exec.agent).worked = true
      workMarks++
    }
    if (exec && typeof exec.name === 'string' && exec.name === 'ask_user_question') {
      isQuestion = true
      waitingCount++
    }
    toolsInFlight++
    recentTool = true
    if (recentToolTimer) {
      recentToolTimer()
      recentToolTimer = null
    }
    deriveMode(currentRunningCount())
    let p
    try {
      p = Promise.resolve(next())
    } catch (err) {
      markToolSettled(isQuestion)
      throw err
    }
    p.then(
      () => markToolSettled(isQuestion),
      () => markToolSettled(isQuestion),
    )
    return p
  })

  // `agent/request-error` is a waterfall: a listener that never calls `next()`
  // vetoes the built-in behavior and every later listener (the retry policy),
  // so the pet only observes and then passes the chain through.
  ctx.on('agent/request-error', (payload, next) => {
    rawRequestError++
    if (payload && payload.agent) {
      flagsOf(payload.agent).errored = true
      errorMarks++
    }
    showFailed()
    return typeof next === 'function' ? next() : undefined
  })

  // ---------- debug tool ----------
  ctx.effect(() => ctx.get('tools').register(defineTool({
    name: 'kun_pet_debug',
    description: 'Read the Kun Like desktop-pet state machine internals and polling counters. Use only to diagnose pet behavior.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
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
          requestError: rawRequestError,
        },
      })
    },
  })))

  // ---------- debug HTTP endpoint (registered last: the handler closes over
  // the state machine declared above) ----------
  if (!disposed) {
    routeDisposers.push(webServer.register({
      kind: 'exact',
      path: '/kun-pet/state',
      handler: (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(JSON.stringify({
          mode,
          seq,
          spriteUrl: spriteBytes !== null ? '/kun-pet/spritesheet.webp' : null,
          voiceUrl: voiceBytes !== null ? '/kun-pet/voice.mp3' : null,
        }))
      },
    }))
  }
}
