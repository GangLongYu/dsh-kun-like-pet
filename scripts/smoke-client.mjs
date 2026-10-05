// Kun Like 桌宠 · Client 半冒烟测试
// 用法：node scripts/smoke-client.mjs（由 `npm test` 调用）
//
// 按 DSH 的模块加载器契约（window.__ModuleLoader__.load({id, factory})）真实
// materialize plugin/lib/client.js，并用假 React / 假 DOM / 假 slots 服务跑通
// apply()，锁住客户端入口契约（id = 包名、导出 name/inject/apply、注册进
// shell.overlay、样式挂 ctx.effect 生命周期、组件能渲染出桌宠节点）。
//
// 无浏览器、无网络、无副作用：全部是内存桩。
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const ok = (cond, msg, extra = '') => {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg + (cond || extra === '' ? '' : ` → ${extra}`))
  if (!cond) failed++
}

// ---------- 模块加载器契约 ----------
let registration = null
globalThis.window = {
  __ModuleLoader__: {
    load(reg) { registration = reg },
  },
}

// ---------- 假 React ----------
// 像 React 一样：把数组子节点拍平；把 props.key 提升为元素顶层 key
// （真实 React 元素是 {type, key, props, children}，key 不在 props 里）
const flatten = (nodes) => nodes.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
const h = (type, props, ...children) => {
  const { key, ...rest } = props ?? {}
  return { type, key, props: rest, children: flatten(children) }
}
const fakeReact = {
  createElement: h,
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
}
const requireStub = (spec) => {
  if (spec === 'react') return fakeReact
  throw new Error(`unexpected require(${JSON.stringify(spec)}) —— 客户端 bundle 只应外部化 react`)
}

// ---------- 假 DOM ----------
const styleTags = []
globalThis.document = {
  createElement: (tag) => ({
    tag,
    textContent: '',
    remove() { const i = styleTags.indexOf(this); if (i >= 0) styleTags.splice(i, 1) },
  }),
  head: { appendChild: (el) => styleTags.push(el) },
}

console.log('Client 半冒烟测试（DSH 模块加载器契约）\n')

await import(pathToFileURL(join(root, 'plugin', 'lib', 'client.js')).href)

ok(registration !== null, '顶层调用 window.__ModuleLoader__.load(...)')
ok(registration?.id === 'dsh-kun-like-pet', '注册 id = 包名（图行键）', String(registration?.id))
ok(typeof registration?.factory === 'function', 'factory 是函数')

const exportsObj = registration.factory(requireStub)
ok(exportsObj?.name === 'dsh-kun-like-pet', '导出 name')
ok(Array.isArray(exportsObj?.inject) && exportsObj.inject.length === 1 && exportsObj.inject[0] === 'slots',
  `导出 inject = ['slots']（${JSON.stringify(exportsObj?.inject)}）`)
ok(typeof exportsObj?.apply === 'function', '导出 apply')

// ---------- 假 cordis ctx + 假 slots 服务 ----------
let declaredKey = null
let registerOptions = null
let registerComponent = null
let effectDisposers = 0
const slots = {
  inject(key, cb) { declaredKey = key; cb(); return () => { effectDisposers++ } },
  register(options, component) { registerOptions = options; registerComponent = component; return () => { effectDisposers++ } },
}
const ctx = {
  get: (n) => (n === 'slots' ? slots : undefined),
  slots,
  effect: (fn) => { effectDisposers++; fn(); return () => {} },
  on: () => () => {},
}

exportsObj.apply(ctx)

ok(declaredKey === 'shell.overlay', 'slots.inject 目标 = shell.overlay', String(declaredKey))
ok(registerOptions?.name === 'shell.overlay' && registerOptions?.id === 'kun-pet',
  '注册选项正确（name/id）', JSON.stringify(registerOptions))
ok(registerOptions?.order === 100 && typeof registerOptions?.label === 'string',
  '注册选项带 order / label', `order=${registerOptions?.order} label=${JSON.stringify(registerOptions?.label)}`)
ok(typeof registerComponent === 'function', '注册了组件工厂')
ok(styleTags.length === 1 && styleTags[0].tag === 'style', '注入 1 个 style 标签（挂 ctx.effect 生命周期）')
ok(styleTags[0].textContent.includes('.kun-pet-bubble'), 'style 内容含气泡样式')

// 插槽注册的是「组件工厂」：调用它得到 KunPet 元素（插槽机制负责真正渲染）
const element = registerComponent({})
ok(typeof element?.type === 'function' && element.type.name === 'KunPet',
  '组件工厂返回 KunPet 元素', String(element?.type?.name ?? element?.type))

// 直接调用函数组件（假 hooks 已足够），检查真实渲染树
const rendered = element.type({})
ok(rendered?.type === 'div', 'KunPet 渲染出根 div', String(rendered?.type))
const childKeys = (rendered.children ?? []).map((c) => c?.key).filter(Boolean)
ok(childKeys.includes('bubble') && childKeys.includes('viewport'),
  '气泡 / 视口探针节点已渲染', JSON.stringify(childKeys))
const bubble = rendered.children.find((c) => c?.key === 'bubble')
ok(typeof bubble?.children?.[0] === 'string' && bubble.children[0].includes('休息中'),
  'idle 气泡文案正确', JSON.stringify(bubble?.children?.[0]))
ok(rendered.props?.style?.position === 'fixed' && rendered.props?.style?.pointerEvents === 'auto',
  '根节点 fixed + 可点击（overlay 插槽默认穿透）',
  JSON.stringify({ position: rendered.props?.style?.position, pointerEvents: rendered.props?.style?.pointerEvents }))

console.log(failed === 0 ? '\n✅ Client 冒烟测试通过' : `\n❌ ${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
