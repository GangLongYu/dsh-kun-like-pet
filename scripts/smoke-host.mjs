// Kun Like 桌宠 · Host 半冒烟测试
// 用法：node scripts/smoke-host.mjs（由 `npm test` 调用）
//
// 用一个最小 cordis ctx 桩直接跑 plugin/lib/index.js，锁住那些曾经把插件打挂的
// 行为契约：素材真读得到、路由真注册、0.2 的 defineTool 契约能被接受、状态机
// 转换正确、waterfall 事件必须放行 next()、dispose 后资源清干净。
//
// 无网络、无端口、不出声：庆祝那一步会把 PATH 清空，让完成音的子进程 spawn
// 必然失败，从而顺带断言「失败被记录而不是被吞掉」。
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg + (cond || extra === '' ? '' : ` → ${extra}`))
  if (!cond) failed++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- minimal cordis context ----------
const routes = new Map()
const listeners = new Map()
const disposers = []
const agents = []
let debugTool = null
let intervalCalls = 0

const services = {
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  agents: { list: () => agents },
  tools: {
    register(def) {
      debugTool = def
      return () => { debugTool = null }
    },
  },
}

const ctx = {
  get: (name) => services[name],
  effect: (fn) => { disposers.push(fn()); return () => {} },
  on: (name, fn) => {
    const list = listeners.get(name) ?? []
    list.push(fn)
    listeners.set(name, list)
    return () => {}
  },
  interval: () => { intervalCalls++; return () => {} },
  timeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
}

const emit = (name, ...args) => {
  for (const fn of listeners.get(name) ?? []) fn(...args)
}
const makeRes = () => ({
  statusCode: null, headers: null, body: null, headersSent: false,
  writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true },
  end(body) { this.body = body },
})
const readState = () => {
  const res = makeRes()
  routes.get('/kun-pet/state').handler({}, res)
  return JSON.parse(res.body)
}
const debug = () => debugTool.execute({}, {})

// ---------- run ----------
console.log('Host 半冒烟测试（DSH 0.2 运行时桩）\n')

let mod
try {
  mod = await import(pathToFileURL(join(root, 'plugin', 'lib', 'index.js')).href)
} catch (err) {
  console.error('SKIP: 无法加载 plugin/lib/index.js —— 先跑 `npm run build`。')
  console.error('      ', String(err && err.message ? err.message : err))
  process.exit(1)
}

ok(mod.name === 'dsh-kun-like-pet', '导出 name')
ok(Array.isArray(mod.inject) && !mod.inject.includes('shell') && mod.inject.includes('agents'),
  `导出 inject 不含 shell、含 agents（${JSON.stringify(mod.inject)}）`)
ok(typeof mod.apply === 'function', '导出 apply')

mod.apply(ctx)

ok(routes.has('/kun-pet/spritesheet.webp'), '注册精灵图路由')
ok(routes.has('/kun-pet/voice.mp3'), '注册完成音路由')
ok(routes.has('/kun-pet/state'), '注册 /kun-pet/state 路由')
ok(intervalCalls === 1, '安装 agents 轮询兜底定时器')

// 素材真的读到了（2.1.0 起用 node:fs，不再走会被会话沙箱管辖的 fs 服务）
const state0 = readState()
const spriteSize = statSync(join(root, 'assets', 'spritesheet.webp')).size
ok(state0.spriteUrl === '/kun-pet/spritesheet.webp', 'state.spriteUrl 可用', JSON.stringify(state0))
ok(state0.voiceUrl === '/kun-pet/voice.mp3', 'state.voiceUrl 可用', JSON.stringify(state0))
ok(state0.mode === 'idle', '初始 mode = idle', state0.mode)

const spriteRes = makeRes()
routes.get('/kun-pet/spritesheet.webp').handler({}, spriteRes)
ok(spriteRes.statusCode === 200 && spriteRes.headers['Content-Type'] === 'image/webp',
  '精灵图响应 200 + image/webp')
ok(spriteRes.body.length === spriteSize, `精灵图字节数与磁盘一致（${spriteRes.body.length}）`)

const voiceRes = makeRes()
routes.get('/kun-pet/voice.mp3').handler({}, voiceRes)
ok(voiceRes.statusCode === 200 && voiceRes.headers['Content-Type'] === 'audio/mpeg',
  '完成音响应 200 + audio/mpeg')

// 调试工具在 0.2 的 defineTool 契约下注册成功
ok(debugTool !== null && debugTool.name === 'kun_pet_debug', '用 0.2 的 defineTool 注册 kun_pet_debug')
const d0 = await debug()
ok(d0.mode === 'idle' && typeof d0.pollCount === 'number', 'kun_pet_debug 可调用', JSON.stringify(d0.raw))

// ---- 状态机：工作 ----
const agentA = { id: 'agent-a', status: 'running' }
agents.push(agentA)
emit('agent/status', { agent: agentA, status: 'running' })
ok((await debug()).mode === 'review', '回合运行中 → review（思考）', (await debug()).mode)

await new Promise((resolve) => {
  emit('tools/execute', { agent: agentA, name: 'pwsh' }, () => { resolve(); return Promise.resolve() })
})
ok((await debug()).mode === 'working', '工具执行中 → working（专注干活）', (await debug()).mode)

// ---- waterfall：agent/request-error 必须放行 next ----
const agentB = { id: 'agent-b', status: 'running' }
let nextCalled = 0
emit('agent/request-error', { agent: agentB }, () => { nextCalled++; return Promise.resolve(undefined) })
ok(nextCalled === 1, 'agent/request-error 监听器调用 next() 放行（未否决链）')
ok((await debug()).mode === 'failed', '请求出错 → failed（难过）', (await debug()).mode)

const dErr = await debug()
ok(dErr.raw.requestError === 1 && dErr.errorMarks === 1, '失败计数与按 Agent 归属的 errored 标记', JSON.stringify(dErr.raw))

// ---- 成功结束回合 → 庆祝（此段不出声：PATH 清空让 spawn 必然失败）----
await sleep(2800)
const savedPath = process.env.PATH
const logged = []
const realConsoleError = console.error
console.error = (...args) => { logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')) }
process.env.PATH = ''
agents.length = 0
emit('agent/status', { agent: agentA, status: 'idle' })
await sleep(60)
process.env.PATH = savedPath
console.error = realConsoleError
const dDone = await debug()

ok(dDone.mode === 'celebrating', '成功结束回合 → celebrating（庆祝）', dDone.mode)
ok(dDone.celebrateCount === 1, '庆祝只触发一次', String(dDone.celebrateCount))
ok(typeof dDone.lastPlayError === 'string' && dDone.lastPlayError.length > 0,
  '完成音 spawn 失败被记录在 lastPlayError（未吞异常）', String(dDone.lastPlayError))
ok(logged.some((line) => line.includes('[kun-pet]') && line.includes('voice playback failed')),
  '完成音失败同时写入 console.error 诊断', JSON.stringify(logged.slice(0, 1)))

const seqBefore = (await debug()).seq
await sleep(30)
ok((await debug()).seq === seqBefore, '庆祝期间不重复发号（seq 稳定）', `${seqBefore} → ${(await debug()).seq}`)

// ---- 卸载即净 ----
for (const d of disposers) { if (typeof d === 'function') d() }
ok(routes.size === 0, `插件 dispose 后路由全部注销（剩 ${routes.size}）`)
ok(debugTool === null, '插件 dispose 后调试工具注销')

console.log(failed === 0 ? '\n✅ Host 冒烟测试通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
