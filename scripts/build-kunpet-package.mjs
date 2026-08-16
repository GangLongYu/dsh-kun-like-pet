// 生成 1.x cordis_define 历史载荷（2.x 静态 bundle 不使用此文件）
// 用法：node scripts/build-kunpet-package.mjs > kunpet.package.json
// 产物可直接粘贴给 DSH 的 cordis_define 工具（code.host / code.client 已内嵌源码）
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const host = readFileSync(join(root, 'src', 'host.js'), 'utf-8')
const client = readFileSync(join(root, 'src', 'client.js'), 'utf-8')

const payload = {
  // cordis_define 参数（kind: "new" 表示创建新插件）
  plugin: { kind: 'new', idPrefix: 'kunpet' },
  name: 'Kun Like 桌宠',
  purpose: '在 Web 界面右下角显示 Kun Like 桌宠，随 Agent 工作状态切换动作，任务完成时播放「你干嘛~哎哟」语音。',
  code: { host, client },
}

const out = process.argv[2] || join(root, 'kunpet.package.json')
if (out === '-') {
  process.stdout.write(JSON.stringify(payload, null, 2))
} else {
  writeFileSync(out, JSON.stringify(payload, null, 2))
  console.log('已生成:', out)
  if (!existsSync(join(root, 'assets', 'spritesheet.webp'))) {
    console.warn('⚠️  注意：CONFIG.spritePath 指向的精灵图文件不存在，请先修改 src/host.js 顶部 CONFIG')
  }
}
