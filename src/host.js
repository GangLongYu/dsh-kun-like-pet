// =============================================================================
// Kun Like 桌宠 · DSH 1.x 动态插件历史参考（Host 半）
// 2.x 静态 bundle 不加载此文件；当前实现位于 plugin/src/index.ts。
//
// 职责：
//   1. 读取本地素材（精灵图 + 完成音），通过 webServer 注册 HTTP 路由给浏览器加载
//   2. 轮询 agents 服务，按 Agent 的 running → idle 转换推导桌宠状态
//   3. 任务完成时由宿主进程用系统命令播放「你干嘛~哎哟」（全窗口/全会话可闻）
//   4. 提供 pet-state RPC 与 kun_pet_debug 调试工具
//
// 如需研究旧版 cordis_define 载荷，可配合 kunpet.package.json 阅读。
// =============================================================================

// ===== 配置区（按需修改） =====
const CONFIG = {
  // 精灵图路径（8 列 × 9 行、每格 192×208 的 WebP）
  spritePath: '/absolute/path/to/dsh-kun-like-pet/assets/spritesheet.webp',
  // 任务完成提示音路径（mp3）
  voicePath: '/absolute/path/to/dsh-kun-like-pet/assets/voice.mp3',
  // 宿主进程系统级播放命令（macOS 用 afplay；Windows 可用 powershell -c (New-Object Media.SoundPlayer '...').PlaySync()；Linux 可用 ffplay -nodisp -autoexit）
  playCommand: (path) => "afplay '" + path.replace(/'/g, "'\\''") + "'",
  // 状态轮询间隔（毫秒）
  pollMs: 500,
  // 庆祝动画持续时长（毫秒）
  celebrateMs: 4800,
  // 失败动画持续时长（毫秒）
  failedMs: 2600,
}

return {
  inject: ['timer'],
  apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    if (fs === undefined || webServer === undefined) {
      console.error('[kun-pet] fs or webServer service is unavailable')
      return
    }

    // ---------- load pet assets once ----------
    let spriteBytes = null
    let voiceBytes = null
    let disposed = false
    const routeDisposers = []

    const registerRoutes = () => {
      if (spriteBytes !== null) {
        routeDisposers.push(webServer.register({
          kind: 'exact',
          path: '/kun-pet/spritesheet.webp',
          handler: (req, res) => {
            res.writeHead(200, {
              'Content-Type': 'image/webp',
              'Content-Length': String(spriteBytes.length),
              'Cache-Control': 'public, max-age=86400',
            })
            res.end(spriteBytes)
          },
        }))
      }
      if (voiceBytes !== null) {
        routeDisposers.push(webServer.register({
          kind: 'exact',
          path: '/kun-pet/voice.mp3',
          handler: (req, res) => {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Length': String(voiceBytes.length),
              'Cache-Control': 'public, max-age=86400',
            })
            res.end(voiceBytes)
          },
        }))
      }
    }

    const loadAssets = async () => {
      try {
        const target = await fs.resolve(CONFIG.spritePath)
        spriteBytes = await fs.readBytes(target, undefined, 16 * 1024 * 1024)
        console.log('[kun-pet] spritesheet loaded:', spriteBytes.length, 'bytes')
      } catch (err) {
        console.error('[kun-pet] failed to load spritesheet:', err)
      }
      try {
        const target = await fs.resolve(CONFIG.voicePath)
        voiceBytes = await fs.readBytes(target, undefined, 8 * 1024 * 1024)
        console.log('[kun-pet] voice loaded:', voiceBytes.length, 'bytes')
      } catch (err) {
        console.error('[kun-pet] failed to load voice:', err)
      }
      if (!disposed) registerRoutes()
    }
    const assetsReady = loadAssets()

    // ---------- pet state machine (polling-driven) ----------
    let mode = 'idle'
    let seq = 0
    let celebrating = false
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
      if (celebrating) return
      let next
      if (waitingCount > 0) next = 'waiting'
      else if (runningCount > 0) next = (toolsInFlight > 0 || recentTool) ? 'working' : 'review'
      else next = 'idle'
      setMode(next)
    }

    const playSystemVoice = () => {
      const shell = ctx.get('shell')
      if (shell === undefined) {
        lastPlayError = 'shell service unavailable'
        return
      }
      try {
        const spec = shell.resolve({ command: CONFIG.playCommand(CONFIG.voicePath) })
        shell.run(spec).catch((err) => {
          lastPlayError = String(err && err.message ? err.message : err)
        })
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
      setMode('failed')
      if (failTimer) failTimer()
      failTimer = ctx.timeout(() => {
        failTimer = null
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

    // ---------- polling: live agent statuses ----------
    const agentsService = ctx.get('agents')
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
      const runningNow = new Set()
      const statuses = []
      for (const agent of list) {
        let status = 'idle'
        try {
          status = agent && agent.status === 'running' ? 'running' : 'idle'
        } catch (err) {
          status = 'idle'
        }
        statuses.push(status)
        if (status === 'running') runningNow.add(agent)
        const prev = lastStatus.get(agent)
        lastStatus.set(agent, status)
        if (agent && prev === undefined) observedAgents.add(agent)
        if (prev === 'running' && status === 'idle') {
          transitionsSeen++
          if (runningNow.size === 0 && waitingCount === 0) {
            const f = turnFlags.get(agent)
            if (f === undefined || !f.errored) celebrate()
            if (f !== undefined) {
              turnFlags.delete(agent)
              flagEntries--
            }
          }
        }
      }
      lastAgentStatuses = statuses
      deriveMode(runningNow.size)
    }
    const stopPolling = ctx.interval(poll, CONFIG.pollMs)
    ctx.effect(() => stopPolling)

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

    ctx.on('agent/request-error', (payload, next) => {
      rawRequestError++
      if (payload && payload.agent) {
        flagsOf(payload.agent).errored = true
        errorMarks++
      }
      showFailed()
      return next()
    })

    // ---------- client RPC ----------
    harness.handle('pet-state', async () => {
      await assetsReady
      const host = webServer.host === '0.0.0.0' ? '127.0.0.1' : webServer.host
      const base = 'http://' + host + ':' + webServer.port
      return {
        mode,
        seq,
        spriteUrl: spriteBytes !== null ? base + '/kun-pet/spritesheet.webp' : null,
        voiceUrl: voiceBytes !== null ? base + '/kun-pet/voice.mp3' : null,
      }
    })

    // ---------- debug tool ----------
    harness.registerTool(ctx, harness.defineTool({
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
    }))
  },
}
