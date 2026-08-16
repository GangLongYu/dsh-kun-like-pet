// @ts-nocheck
// =============================================================================
// Kun Like 桌宠 · DSH 本地静态插件（Client 半）
// 从动态 cordis_define 包转换为本地 bundle 插件。
//
// 职责：
//   1. 注入 shell.overlay 插槽，在 Web 界面右下角渲染桌宠
//   2. 按 8 列 × 9 行的精灵图契约播放 9 种状态动画
//   3. 支持拖动（跑步动画）、点击（挥手互动 + 浏览器端播放语音）
//   4. 每 400ms 通过 /kun-pet/state 同步宿主端状态机
// =============================================================================
import React from 'react'

export const inject = ['slots']

const CSS = `
.kun-pet-bubble {
  position: absolute;
  left: 50%;
  bottom: 100%;
  margin-bottom: 12px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.96);
  color: #333333;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  padding: 6px 12px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  pointer-events: none;
  z-index: 2;
}
.kun-pet-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 7px solid transparent;
  border-top-color: rgba(255, 255, 255, 0.96);
}
`

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  // 注入样式
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS
  document.head.appendChild(styleEl)
  ctx.effect(() => () => styleEl.remove(), 'dsh-kun-like-pet: styles')

  const CW = 192
  const CH = 208
  const SCALE = 0.85
  const W = CW * SCALE
  const H = CH * SCALE

  // 8 列 × 9 行精灵图契约：每行一种状态动画（帧时长单位 ms）
  const ROWS = {
    idle: { row: 0, count: 6, frames: [280, 110, 110, 140, 140, 320] },
    runRight: { row: 1, count: 8, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
    runLeft: { row: 2, count: 8, frames: [120, 120, 120, 120, 120, 120, 120, 220] },
    wave: { row: 3, count: 4, frames: [140, 140, 140, 280] },
    jump: { row: 4, count: 5, frames: [140, 140, 140, 140, 280] },
    failed: { row: 5, count: 8, frames: [140, 140, 140, 140, 140, 140, 140, 240] },
    waiting: { row: 6, count: 6, frames: [150, 150, 150, 150, 150, 260] },
    working: { row: 7, count: 6, frames: [120, 120, 120, 120, 120, 220] },
    review: { row: 8, count: 6, frames: [150, 150, 150, 150, 150, 280] },
  }

  const MODE_ANIM = {
    idle: 'idle',
    working: 'working',
    review: 'review',
    waiting: 'waiting',
    failed: 'failed',
    celebrating: 'wave',
  }

  const BUBBLES = {
    idle: '休息中~ 有事叫我',
    working: '努力工作中…',
    review: '思考中…',
    waiting: '在等你回复哦~',
    failed: '呜…出错了 (._.)',
    celebrating: '完成啦！你干嘛~哎哟',
    dragging: '呜哇~ 别拽我！',
    poke: '诶嘿~',
  }

  let celebrateFlip = 0
  let lastCelebrateSeq = -1
  let dragData = null
  let audioEl = null
  let reactionTimer = null
  let viewportEl = null

  const viewportSize = () => {
    if (viewportEl) {
      const r = viewportEl.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height }
    }
    return { w: 1400, h: 900 }
  }

  function KunPet() {
    const [st, setSt] = React.useState({ mode: 'idle', seq: -1, spriteUrl: null, voiceUrl: null })
    const [frame, setFrame] = React.useState(0)
    const [pos, setPos] = React.useState(null)
    const [dragging, setDragging] = React.useState(false)
    const [dragDir, setDragDir] = React.useState('runRight')
    const [reaction, setReaction] = React.useState(null)
    const [celebrateAnim, setCelebrateAnim] = React.useState('wave')

    React.useEffect(() => {
      let alive = true
      const sync = async () => {
        try {
          const res = await fetch('/kun-pet/state')
          if (!res.ok) return
          const s = await res.json()
          if (!alive || !s) return
          setSt((prev) => {
            const seq = typeof s.seq === 'number' ? s.seq : 0
            if (prev.seq === seq && prev.spriteUrl === s.spriteUrl && prev.voiceUrl === s.voiceUrl) return prev
            return {
              mode: String(s.mode || 'idle'),
              seq,
              spriteUrl: s.spriteUrl || null,
              voiceUrl: s.voiceUrl || null,
            }
          })
        } catch (err) {
          // transient fetch error, retry next tick
        }
      }
      sync()
      const intervalId = setInterval(sync, 400)
      return () => { alive = false; clearInterval(intervalId) }
    }, [])

    const playVoice = () => {
      if (!audioEl || !st.voiceUrl) return
      try {
        audioEl.currentTime = 0
        const p = audioEl.play()
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch (err) {
        // autoplay may be blocked until the first user gesture
      }
    }

    const doReaction = (animName, ms) => {
      setReaction(animName)
      if (reactionTimer) clearTimeout(reactionTimer)
      reactionTimer = setTimeout(() => {
        reactionTimer = null
        setReaction(null)
      }, ms)
    }

    // Celebration sound is played by the HOST (system-wide), so the
    // client only animates here — no double playback.
    React.useEffect(() => {
      if (st.mode !== 'celebrating' || st.seq === lastCelebrateSeq) return
      lastCelebrateSeq = st.seq
      celebrateFlip = celebrateFlip + 1
      setCelebrateAnim(celebrateFlip % 2 === 0 ? 'jump' : 'wave')
    }, [st.mode, st.seq])

    React.useEffect(() => () => {
      if (reactionTimer) clearTimeout(reactionTimer)
    }, [])

    let anim
    let bubble
    if (dragging) {
      anim = dragDir
      bubble = BUBBLES.dragging
    } else if (reaction) {
      anim = reaction
      bubble = BUBBLES.poke
    } else if (st.mode === 'celebrating') {
      anim = celebrateAnim
      bubble = BUBBLES.celebrating
    } else {
      anim = MODE_ANIM[st.mode] || 'idle'
      bubble = BUBBLES[st.mode] || BUBBLES.idle
    }
    const spec = ROWS[anim] || ROWS.idle

    React.useEffect(() => {
      setFrame(0)
      let disposed = false
      let stopTimer = null
      const step = (i) => {
        if (disposed) return
        setFrame(i)
        const delay = spec.frames[i] || 150
        stopTimer = setTimeout(() => step((i + 1) % spec.count), delay)
      }
      step(0)
      return () => {
        disposed = true
        if (stopTimer) clearTimeout(stopTimer)
      }
    }, [anim])

    const onPointerDown = (e) => {
      if (typeof e.button === 'number' && e.button !== 0) return
      const el = e.currentTarget
      try { el.setPointerCapture(e.pointerId) } catch (err) { /* ignore */ }
      const rect = el.getBoundingClientRect()
      dragData = {
        x: e.clientX,
        y: e.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
      }
      setDragging(true)
    }

    const onPointerMove = (e) => {
      if (!dragData) return
      const dx = e.clientX - dragData.x
      const dy = e.clientY - dragData.y
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragData.moved = true
      if (dx > 4) setDragDir('runRight')
      else if (dx < -4) setDragDir('runLeft')
      const vp = viewportSize()
      const left = Math.min(Math.max(dragData.left + dx, -W * 0.7), vp.w - W * 0.3)
      const top = Math.min(Math.max(dragData.top + dy, -H * 0.5), vp.h - H * 0.5)
      setPos({ left, top })
    }

    const onPointerEnd = () => {
      const d = dragData
      dragData = null
      setDragging(false)
      if (d && !d.moved) {
        doReaction('wave', 2400)
        playVoice()
      }
    }

    const col = frame % spec.count
    const bgX = -(col * W)
    const bgY = -(spec.row * H)

    const wrapStyle = {
      position: 'fixed',
      width: W,
      height: H,
      zIndex: 1000,
      pointerEvents: 'auto',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'none',
    }
    if (pos) {
      wrapStyle.left = pos.left
      wrapStyle.top = pos.top
    } else {
      wrapStyle.right = 20
      wrapStyle.bottom = 20
    }

    const spriteStyle = {
      position: 'absolute',
      left: 0,
      top: 0,
      width: W,
      height: H,
      backgroundImage: st.spriteUrl ? 'url("' + st.spriteUrl + '")' : 'none',
      backgroundSize: String(W * 8) + 'px ' + String(H * 9) + 'px',
      backgroundPosition: String(bgX) + 'px ' + String(bgY) + 'px',
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
      cursor: dragging ? 'grabbing' : 'grab',
    }

    const children = [
      st.spriteUrl
        ? React.createElement('div', { key: 'sprite', style: spriteStyle })
        : React.createElement('div', {
            key: 'emoji',
            style: { position: 'absolute', left: 0, top: 0, width: W, height: H, fontSize: 110, lineHeight: 1.6, textAlign: 'center' },
          }, '🐤'),
      React.createElement('div', { key: 'bubble', className: 'kun-pet-bubble' }, bubble),
      React.createElement('div', {
        key: 'viewport',
        ref: (el) => { viewportEl = el },
        style: {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          pointerEvents: 'none',
          visibility: 'hidden',
        },
      }),
    ]
    if (st.voiceUrl) {
      children.push(React.createElement('audio', {
        key: 'voice',
        src: st.voiceUrl,
        preload: 'auto',
        ref: (el) => { audioEl = el },
      }))
    }

    return React.createElement('div', {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      style: wrapStyle,
      title: 'Kun Like 桌宠 · 拖动移动 · 点击互动',
    }, children)
  }

  ctx.effect(() => slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'kun-pet', order: 100, label: 'Kun Like 桌宠' },
    () => React.createElement(KunPet),
    )), 'dsh-kun-like-pet: overlay')
}
