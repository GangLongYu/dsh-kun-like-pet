// Kun Like 桌宠 · DSH 静态 bundle 结构校验
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
ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-runtime'), 'Client 注入 DSH runtime')
ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-slots'), 'Client 注入 UI slots')

const cordisPatch = read('cordis.patch.yml')
ok(/name:\s*dsh-kun-like-pet\b/.test(cordisPatch), 'cordis.patch.yml 插入 Host 插件')

for (const output of ['plugin/lib/index.js', 'plugin/lib/client.js']) {
  const path = join(root, output)
  ok(existsSync(path), `${output} 已提交`)
  if (!existsSync(path)) continue
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  ok(result.status === 0, `${output} 语法有效${result.status === 0 ? '' : `：${result.stderr.trim()}`}`)
}

if (existsSync(join(root, 'plugin/lib/index.js'))) {
  const host = read('plugin/lib/index.js')
  for (const token of [
    'const name = "dsh-kun-like-pet"',
    '/kun-pet/state',
    '/kun-pet/spritesheet.webp',
    '/kun-pet/voice.mp3',
    'agent/status',
    'kun_pet_debug',
  ]) ok(host.includes(token), `Host 构建产物包含 ${token}`)
  ok(!/@dsh-external/.test(host), 'Host 不含旧的临时包名')
  ok(!/[A-Za-z]:\\\\Users\\\\|\/Users\//.test(host), 'Host 不含开发者绝对路径')
}

if (existsSync(join(root, 'plugin/lib/client.js'))) {
  const client = read('plugin/lib/client.js')
  ok(/window\.__ModuleLoader__\.load\(\{\s*id:\s*["']dsh-kun-like-pet["']/.test(client), 'Client 使用 DSH 模块加载器注册正确 ID')
  ok(client.includes('exports.apply'), 'Client 导出 apply')
  ok(client.includes('shell.overlay'), 'Client 注入 shell.overlay')
}

console.log(failed === 0 ? '\n✅ bundle 校验通过' : `\n❌ ${failed} 项 bundle 校验失败`)
process.exit(failed === 0 ? 0 : 1)
