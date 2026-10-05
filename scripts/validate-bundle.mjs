// Kun Like 桌宠 · DSH 静态 bundle 结构校验
// 用法：node scripts/validate-bundle.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (condition, message) => {
  console.log((condition ? '  ✔ ' : '  ✘ ') + message)
  if (!condition) failed++
}

const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8')

console.log('DSH 静态 bundle 校验')

const pkg = JSON.parse(read('package.json'))
ok(pkg.name === 'dsh-kun-like-pet', 'package name 与 Cordis 插件名一致')
ok(pkg.main === './plugin/lib/index.js', 'Host 入口指向构建产物')
ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml', '声明 dsh.bundle.patch')
ok(pkg.dsh?.client?.platform === 'web', '声明 Web Client 模块')
ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-renderer'), 'Client 注入提供 slots 服务的 dsh-client-ui-renderer')
ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-slots'), 'Client 注入 UI slots')

// DSH 0.2 起 dsh-app-boot 会校验「以 @deepseek-ai/dsh 开头」的 peerDependencies：
// 只要有一个不满足运行时的 dsh 版本，整个 bundle 会被跳过（插件静默不生效）。
// 这里做一条回归护栏，确保声明的范围面向 0.2 而不是停留在 0.1。
const DSH_PEER_PREFIX = '@deepseek-ai/dsh'
const dshPeers = Object.entries(pkg.peerDependencies ?? {})
  .filter(([peerName]) => peerName === DSH_PEER_PREFIX || peerName.startsWith(`${DSH_PEER_PREFIX}-`))
ok(dshPeers.length > 0, '声明了 @deepseek-ai/dsh* peerDependencies（DSH 兼容性门禁依据）')
for (const [peerName, range] of dshPeers) {
  ok(/0\.2\./.test(String(range)), `${peerName} 的 peer 范围面向 DSH 0.2（当前 ${range}）`)
}
ok(/0\.2\./.test(String(pkg.engines?.dsh ?? '')), `engines.dsh 声明 DSH 0.2 兼容（当前 ${pkg.engines?.dsh}）`)

const cordisPatch = read('cordis.patch.yml')
ok(/name:\s*dsh-kun-like-pet\b/.test(cordisPatch), 'cordis.patch.yml 插入 Host 插件')

for (const output of ['plugin/lib/index.js', 'plugin/lib/client.js']) {
  const path = join(root, output)
  ok(existsSync(path), `${output} 已提交`)
  if (!existsSync(path)) continue
  // stdio 继承：沙箱环境禁止通过管道捕获子进程输出，inherit 在沙箱与 CI 下都可用。
  const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' })
  ok(result.error === undefined && result.status === 0,
    `${output} 语法有效${result.status === 0 ? '' : `（node --check 退出码 ${result.status}）`}`)
}

if (existsSync(join(root, 'plugin/lib/index.js'))) {
  const host = read('plugin/lib/index.js')
  for (const token of [
    'const name = "dsh-kun-like-pet"',
    '/kun-pet/state',
    '/kun-pet/spritesheet.webp',
    '/kun-pet/voice.mp3',
    'agent/status',
    'agent/request-error',
    'kun_pet_debug',
    'node:child_process',
    'System.Media.SoundPlayer',
  ]) ok(host.includes(token), `Host 构建产物包含 ${token}`)
  ok(!/@dsh-external/.test(host), 'Host 不含旧的临时包名')
  ok(!/[A-Za-z]:\\\\Users\\\\|\/Users\//.test(host), 'Host 不含开发者绝对路径')
  // 0.1 的 shell 缝：ShellExecutor.run() 在 0.2 已被 resolve()/execute() 取代
  ok(!/\.run\(\s*spec|shell\.run\(/.test(host), 'Host 不再调用 0.1 的 shell.run()')
  ok(!/"shell"/.test(host), 'Host 不再依赖 shell 服务')
}

if (existsSync(join(root, 'plugin/lib/client.js'))) {
  const client = read('plugin/lib/client.js')
  ok(/window\.__ModuleLoader__\.load\(\{\s*id:\s*["']dsh-kun-like-pet["']/.test(client), 'Client 使用 DSH 模块加载器注册正确 ID')
  ok(client.includes('exports.apply'), 'Client 导出 apply')
  ok(client.includes('exports.inject'), 'Client 导出 inject')
  ok(client.includes('shell.overlay'), 'Client 注入 shell.overlay')
  ok(!client.includes('@deepseek-ai/dsh-client-runtime'), 'Client 不再引用已下线的 dsh-client-runtime')
}

console.log(failed === 0 ? '\n✅ bundle 校验通过' : `\n❌ ${failed} 项 bundle 校验失败`)
process.exit(failed === 0 ? 0 : 1)
