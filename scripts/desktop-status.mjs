// Kun Like 桌宠 · 查看各 DSH profile 的安装状态
// 用法：npm run status    （或 node scripts/desktop-status.mjs [--json]）
//
// DSH 的 Web 与桌面客户端各用各的 profile：
//   npx dsh web            → ~/.dsh/profiles/web
//   桌面客户端（Electron）  → ~/.dsh/profiles/desktop
// 插件只装在其中一个 profile 里时，另一个看不到它。这个脚本不需要网络，
// 只读取 profile 的 package.json 与 node_modules，用来确认「到底装到哪去了」。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PACKAGE_NAME = 'dsh-kun-like-pet'
const asJson = process.argv.includes('--json')

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profilesDir = join(dshHome, 'profiles')

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const profiles = existsSync(profilesDir)
  ? readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'node_modules' && !name.startsWith('.'))
    .sort()
  : []

const rows = profiles.map((profile) => {
  const dir = join(profilesDir, profile)
  const manifest = readJson(join(dir, 'package.json'))
  const dependencies = manifest?.dependencies ?? {}
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  const declaredAs = dependencies[PACKAGE_NAME] ?? null

  const installedManifest = readJson(join(dir, 'node_modules', PACKAGE_NAME, 'package.json'))
  const dshManifest = readJson(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))

  return {
    profile,
    dir,
    declaredAs,
    installedVersion: installedManifest?.version ?? null,
    enabled: bundles.includes(PACKAGE_NAME),
    bundles,
    dshVersion: dshManifest?.version ?? null,
  }
})

if (asJson) {
  console.log(JSON.stringify({ dshHome, packageName: PACKAGE_NAME, profiles: rows }, null, 2))
  process.exit(0)
}

console.log(`Kun Like 桌宠 · profile 安装状态`)
console.log(`DSH home: ${dshHome}`)
if (rows.length === 0) {
  console.log('\n没有找到任何 profile。先启动一次 DSH（Web 或桌面客户端）再运行本脚本。')
  process.exit(0)
}

for (const row of rows) {
  console.log(`\n[${row.profile}]`)
  console.log(`  依赖声明: ${row.declaredAs ?? '（未声明）'}`)
  console.log(`  已安装:   ${row.installedVersion ?? '（未安装）'}`)
  console.log(`  bundle 启用: ${row.enabled ? '是' : '否'}`)
  if (row.dshVersion !== null) console.log(`  dsh 运行时: ${row.dshVersion}`)
  if (row.declaredAs !== null && row.installedVersion === null) {
    console.log('  ⚠ 声明了依赖但 node_modules 里没有产物：到该 profile 目录跑一次 pnpm install')
  }
  if (row.declaredAs !== null && row.installedVersion !== null && !row.enabled) {
    console.log('  ⚠ 已安装但不在 dsh.profile.bundles 里：插件不会被加载，重新 add 一次即可')
  }
}

const installed = rows.filter((row) => row.installedVersion !== null)
console.log('')
if (installed.length === 0) {
  console.log('结论：两个 profile 都没装。')
  console.log('  Web:     npx @deepseek-ai/dsh plugin --profile web add github:GangLongYu/dsh-kun-like-pet')
  console.log('  桌面版:  npx @deepseek-ai/dsh plugin --profile desktop add github:GangLongYu/dsh-kun-like-pet')
} else {
  console.log(`结论：已装入 ${installed.map((row) => row.profile).join('、')} profile。`)
  console.log('改完 profile 必须重启对应的应用：Web 刷新页面不够，桌面版要从托盘完全退出再启动。')
}
