// Kun Like 桌宠 · 仓库完整性校验
// 用法：node scripts/validate.mjs
// 检查：素材存在且格式正确、静态插件源码结构正确、精灵图尺寸符合 8×9 契约
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, msg) => {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg)
  if (!cond) failed++
}

// 1. 素材文件
const spritePath = join(root, 'assets', 'spritesheet.webp')
const voicePath = join(root, 'assets', 'voice.mp3')
ok(existsSync(spritePath), 'assets/spritesheet.webp 存在')
ok(existsSync(voicePath), 'assets/voice.mp3 存在')

if (existsSync(spritePath)) {
  const buf = readFileSync(spritePath)
  // WebP RIFF 头，并读取 VP8X / VP8 / VP8L 画布尺寸。
  const isWebp = buf.length > 32 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
  ok(isWebp, 'spritesheet.webp 是合法 WebP（RIFF/WEBP 头）')
  if (isWebp) {
    const vp8x = buf.indexOf(Buffer.from('VP8X'))
    const vp8 = buf.indexOf(Buffer.from('VP8 '))
    const vp8l = buf.indexOf(Buffer.from('VP8L'))
    let dimensions = null
    if (vp8x >= 0 && buf.length >= vp8x + 18) {
      dimensions = [buf.readUIntLE(vp8x + 12, 3) + 1, buf.readUIntLE(vp8x + 15, 3) + 1]
    } else if (vp8 >= 0 && buf.length >= vp8 + 18) {
      dimensions = [buf.readUInt16LE(vp8 + 14) & 0x3fff, buf.readUInt16LE(vp8 + 16) & 0x3fff]
    } else if (vp8l >= 0 && buf.length >= vp8l + 13 && buf[vp8l + 8] === 0x2f) {
      const bits = buf.readUInt32LE(vp8l + 9)
      dimensions = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
    }
    ok(dimensions !== null, 'spritesheet.webp 含可识别的 VP8 画布尺寸')
    if (dimensions !== null) {
      const [w, h] = dimensions
      ok(w === 1536 && h === 1872, `spritesheet.webp 尺寸为 1536×1872（实测 ${w}×${h}，契约要求 8 列 × 9 行、每格 192×208）`)
    }
  }
}
if (existsSync(voicePath)) {
  const buf = readFileSync(voicePath)
  const isMp3 = buf.length > 3 && (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))
  ok(isMp3, 'voice.mp3 是合法 MP3（ID3/MPEG 头）')
  ok(buf.length > 16 * 1024, `voice.mp3 大小合理（${buf.length} bytes）`)
}

// 2. 静态插件源码：标准 ESM 导出，并包含 Host / Client 的关键能力
for (const [name, mustContain] of [
  ['plugin/src/index.ts', ['export const inject', 'export function apply(ctx)', 'kun_pet_debug', '/kun-pet/state', 'agentsService', "ctx.on('agent/status'", "ctx.on('tools/execute'"]],
  ['plugin/src/client/index.ts', ['export const inject', 'export function apply(ctx)', 'shell.overlay', 'ROWS', 'KunPet']],
]) {
  const p = join(root, name)
  ok(existsSync(p), `${name} 存在`)
  if (existsSync(p)) {
    const src = readFileSync(p, 'utf-8')
    for (const token of mustContain) {
      ok(src.includes(token), `${name} 包含关键片段 ${token}`)
    }
  }
}

console.log(failed === 0 ? '\n✅ 校验通过' : `\n❌ ${failed} 项校验失败`)
process.exit(failed === 0 ? 0 : 1)
