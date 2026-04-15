'use client'
import { useEffect, useRef } from 'react'

// ── Canvas config ─────────────────────────────────────────────────────────────
const CW    = 480   // internal canvas width
const CH    = 256   // internal canvas height
const T     = 16   // tile size (px)
const SPEED = 1.8  // px per frame at 60fps
const WALK_MS = 180 // ms between walking frames

// ── Desk positions (pixel coords, character foot position) ────────────────────
const DESK: Record<string, [number, number]> = {
  researcher: [36,  72],
  quant:      [132, 72],
  macro:      [36,  168],
  risk:       [132, 168],
  trader:     [84,  216],
  pm:         [390, 100],
}

// ── Conference room seat positions ────────────────────────────────────────────
const CONF: Record<string, [number, number]> = {
  researcher: [303, 84],
  quant:      [319, 84],
  macro:      [303, 124],
  risk:       [319, 124],
  trader:     [311, 144],
  pm:         [390, 100],  // Morgan stays at his desk
}

// ── Visual config per agent ────────────────────────────────────────────────────
const SHIRT: Record<string, string> = {
  researcher: '#1d4ed8',
  quant:      '#047857',
  macro:      '#b45309',
  risk:       '#b91c1c',
  trader:     '#6d28d9',
  pm:         '#c2410c',
}
const HAIR: Record<string, string> = {
  researcher: '#5c4033',
  quant:      '#9b7653',
  macro:      '#1a1a1a',
  risk:       '#3d2314',
  trader:     '#2c1f10',
  pm:         '#c69d7a',
}
const LABEL: Record<string, string> = {
  researcher: 'ALEX',
  quant:      'SAM',
  macro:      'JORDAN',
  risk:       'DREW',
  trader:     'RILEY',
  pm:         'MORGAN',
}

const SKIN = '#e8c4a8'
const ORDER = ['researcher', 'quant', 'macro', 'risk', 'trader', 'pm'] as const

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SimAgent {
  id: string
  status: 'idle' | 'thinking' | 'active' | 'error'
  task: string
  lastRec?: string
}
export interface SimMeeting { active: boolean; symbol: string | null; decision: string | null }

interface CharState {
  id: string
  x: number; y: number   // current (fractional pixels)
  tx: number; ty: number  // target
  frame: number          // walk frame 0-3
  frameMs: number        // ms accumulator
  sitting: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function px(ctx: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = col
  ctx.fillRect(Math.round(x), Math.round(y), w, h)
}

// ── Static background ─────────────────────────────────────────────────────────
function drawBg(ctx: CanvasRenderingContext2D) {
  // Floor: warm wood (main), cool carpet (conference)
  for (let ty = 0; ty < Math.ceil(CH / T) + 1; ty++) {
    for (let tx = 0; tx < Math.ceil(CW / T) + 1; tx++) {
      const conf = tx >= 18
      ctx.fillStyle = conf
        ? ((tx + ty) % 2 === 0 ? '#1a2847' : '#1e3055')
        : ((tx + ty) % 2 === 0 ? '#3d2a18' : '#4a3420')
      ctx.fillRect(tx * T, ty * T, T, T)
    }
  }

  // Borders
  const bdr = '#0a0f1a'
  const trim = '#2244aa'
  px(ctx, bdr,  0, 0,    CW, 3)
  px(ctx, bdr,  0, CH-3, CW, 3)
  px(ctx, bdr,  0, 0,    3, CH)
  px(ctx, bdr,  CW-3, 0, 3, CH)
  px(ctx, trim, 0, 1,    CW, 2)
  px(ctx, trim, 0, CH-3, CW, 2)

  // Windows (top)
  ;[20, 82, 180, 240].forEach(wx => {
    px(ctx, '#0d2a4a', wx,   0, 28, 14)
    px(ctx, '#87ceeb', wx+2, 0, 24, 12)
    px(ctx, '#b0e0ff', wx+5, 1,  8,  4)
    px(ctx, '#fff6',   wx+3, 1,  5,  3)
  })
  px(ctx, '#0d2a4a', 344, 0, 28, 14)
  px(ctx, '#87ceeb', 346, 0, 24, 12)
  px(ctx, '#fff6',   348, 1,  5,  3)

  // Partition wall
  px(ctx, '#080c14', 17*T, 0,    T, CH)
  px(ctx, '#1e3a6b', 17*T, 0,    2, CH)
  px(ctx, '#1e3a6b', 18*T-2, 0,  2, CH)
  // Door gap
  px(ctx, '#3d2a18', 17*T, 6*T,  T, 3*T)
  px(ctx, '#1e3a6b', 17*T, 6*T,  2, 3*T)
  px(ctx, '#1e3a6b', 18*T-2, 6*T,2, 3*T)

  // Desks
  const deskPos = [
    [1*T, 3*T], [7*T, 3*T],  // Alex, Sam (top row)
    [1*T, 9*T], [7*T, 9*T],  // Jordan, Drew (mid row)
    [4*T, 13*T],              // Riley (bottom)
    [22*T, 5*T],              // Morgan (conf side)
  ]
  deskPos.forEach(([x, y]) => {
    const dw = 3*T, dh = T
    // shadow
    px(ctx, '#0003', x+3, y+dh+1, dw, 4)
    // surface
    px(ctx, '#2d1b0e', x,   y,    dw, dh)
    px(ctx, '#3d2a18', x+2, y+2,  dw-4, 5)  // highlight
    px(ctx, '#1a0f06', x,   y+dh, dw, 4)    // front face
    // legs
    px(ctx, '#0f0805', x+2,    y+dh+3, 3, 6)
    px(ctx, '#0f0805', x+dw-5, y+dh+3, 3, 6)
    // monitor
    const mx = x+T-2, my = y-14
    px(ctx, '#080c14', mx,   my,   24, 16)
    px(ctx, '#001529', mx+2, my+2, 20, 12)
    px(ctx, '#002244', mx+3, my+3, 18, 10)
    px(ctx, '#00ccff55', mx+4, my+4, 10, 1)
    px(ctx, '#00ccff33', mx+4, my+6, 14, 1)
    px(ctx, '#00ccff44', mx+4, my+8,  8, 1)
    // stand
    px(ctx, '#1a1a2a', mx+9,  my+14, 6, 4)
    px(ctx, '#1a1a2a', mx+7,  my+17, 10, 2)
  })

  // Conference table
  const [ctX, ctY, ctW, ctH] = [19*T+2, 5*T, 7*T-4, 7*T]
  px(ctx, '#1a0a0033', ctX+3, ctY+4, ctW, ctH)  // shadow
  px(ctx, '#3d2a18',   ctX,   ctY,   ctW, ctH)   // top
  px(ctx, '#2d1b0e',   ctX,   ctY+ctH-4, ctW, 4) // front edge
  px(ctx, '#4a3420',   ctX+4, ctY+4,  ctW-8, 3)  // line detail
  px(ctx, '#4a3420',   ctX+4, ctY+ctH-10, ctW-8, 2)
  // laptop on table
  px(ctx, '#1a2a3a', ctX+ctW/2-10, ctY+ctH/2-6, 20, 12)
  px(ctx, '#002244', ctX+ctW/2-8,  ctY+ctH/2-4, 16,  8)
  px(ctx, '#00aaff55', ctX+ctW/2-6, ctY+ctH/2-2, 12, 1)
  // chairs (top)
  for (let i = 0; i < 3; i++) drawChair(ctx, ctX+6+i*26, ctY-12)
  // chairs (bottom)
  for (let i = 0; i < 3; i++) drawChair(ctx, ctX+6+i*26, ctY+ctH+2)
  // chairs (sides)
  drawChair(ctx, ctX-14, ctY+ctH/2-4)
  drawChair(ctx, ctX+ctW+2, ctY+ctH/2-4)

  // CONFERENCE ROOM label
  ctx.fillStyle = '#3a6a8a'
  ctx.font = '7px "Courier New"'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('CONFERENCE ROOM', 19*T + (7*T-4)/2 + 2, 3*T + 4)

  // Morgan's private area separator
  px(ctx, '#0a0f1a',  27*T-2, 3*T, 2, 11*T)
  px(ctx, '#334466',  27*T-2, 3*T, 1, 11*T)
  // label
  ctx.fillStyle = '#7a5a3a'
  ctx.textAlign = 'center'
  ctx.font = '6px "Courier New"'
  ctx.fillText("PM OFFICE", 27*T + (CW - 27*T)/2, 3*T + 4)

  // Plants
  drawPlant(ctx, 5,    5)
  drawPlant(ctx, 188,  5)
  drawPlant(ctx, 5,    CH-26)
  drawPlant(ctx, CW-20, 5)
}

function drawChair(ctx: CanvasRenderingContext2D, x: number, y: number) {
  px(ctx, '#1a1a1a', x,   y,   12,  8)
  px(ctx, '#2a2a4a', x+1, y+1, 10,  6)
  px(ctx, '#0a0a0a', x+2, y+7,  3,  4)
  px(ctx, '#0a0a0a', x+7, y+7,  3,  4)
}

function drawPlant(ctx: CanvasRenderingContext2D, x: number, y: number) {
  px(ctx, '#2d1b0e', x+2,  y+12, 8,  8)
  px(ctx, '#1a0f06', x+1,  y+11, 10, 3)
  px(ctx, '#0d4f0d', x,    y,    12, 14)
  px(ctx, '#1a7a1a', x+2,  y-4,  8,  10)
  px(ctx, '#0d4f0d', x-2,  y+3,  6,  7)
  px(ctx, '#1a7a1a', x+7,  y-2,  5,  7)
}

// ── Character ─────────────────────────────────────────────────────────────────
function drawChar(
  ctx: CanvasRenderingContext2D,
  char: CharState,
  agentId: string,
  status: string,
  task: string,
  lastRec?: string
) {
  const x = Math.round(char.x)
  const y = Math.round(char.y)
  const shirt = SHIRT[agentId] ?? '#666'
  const hair  = HAIR[agentId]  ?? '#333'
  const name  = LABEL[agentId] ?? agentId.toUpperCase()
  const f     = char.frame

  // glow
  const glowMap: Record<string, string> = { thinking: '#eab308', active: '#22c55e', error: '#ef4444' }
  const gc = glowMap[status]
  if (gc) {
    ctx.fillStyle = gc + '28'
    ctx.fillRect(x - 5, y - 12, 18, 34)
  }

  // shadow
  ctx.fillStyle = '#00000044'
  ctx.fillRect(x + 1, y + (char.sitting ? 8 : 20), 6, 2)

  // head
  px(ctx, hair, x+2, y-8, 4, 2)
  px(ctx, hair, x+1, y-6, 6, 1)
  px(ctx, SKIN, x+1, y-5, 6, 5)
  px(ctx, '#000b', x+2, y-4, 1, 1)
  px(ctx, '#000b', x+5, y-4, 1, 1)
  px(ctx, '#b06040', x+3, y-1, 2, 1)

  // body
  px(ctx, shirt, x+1, y, 6, 5)
  px(ctx, '#fff3', x+3, y, 2, 2)

  // arms
  const swing = char.sitting ? 0 : (f % 2 === 0 ? 1 : -1)
  px(ctx, shirt, x-1, y+swing,  2, 4)
  px(ctx, shirt, x+7, y-swing,  2, 4)
  px(ctx, SKIN,  x-1, y+swing+3, 2, 2)
  px(ctx, SKIN,  x+7, y-swing+3, 2, 2)

  // legs
  const PANT = '#1e3a5f', SHOE = '#0a0f14'
  if (char.sitting) {
    px(ctx, PANT, x+1, y+5, 3, 3)
    px(ctx, PANT, x+4, y+5, 3, 3)
    px(ctx, SHOE, x,   y+6, 3, 3)
    px(ctx, SHOE, x+5, y+6, 3, 3)
  } else {
    const ll = f % 4 < 2 ? 2 : -2
    px(ctx, PANT, x+1, y+5+ll,  3, 7)
    px(ctx, PANT, x+4, y+5-ll,  3, 7)
    px(ctx, SHOE, x+1, y+12+ll, 3, 2)
    px(ctx, SHOE, x+4, y+12-ll, 3, 2)
  }

  // name tag
  const nc = status === 'thinking' ? '#fde68a'
           : status === 'active'   ? '#86efac'
           : status === 'error'    ? '#fca5a5'
           :                         '#9ca3af'
  const tw = name.length * 4 + 4
  const tx = x + 4 - tw / 2
  ctx.fillStyle = '#000000cc'
  ctx.fillRect(tx - 1, y - 20, tw + 2, 9)
  ctx.fillStyle = nc
  ctx.font = '6px "Courier New"'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(name, tx, y - 19)

  // rec badge
  if (lastRec && lastRec !== 'HOLD' && lastRec !== 'PASS') {
    const rc = lastRec === 'BUY' ? '#22c55e' : '#ef4444'
    const bw = lastRec.length * 4 + 4
    ctx.fillStyle = rc + 'cc'
    ctx.fillRect(x + 8, y - 9, bw, 8)
    ctx.fillStyle = '#000'
    ctx.font = '5px "Courier New"'
    ctx.fillText(lastRec, x + 9, y - 8)
  }

  // speech bubble
  if ((status === 'thinking' || status === 'active') && task && !task.startsWith('Stand')) {
    const clean = task.replace(/^(Researching|Running technicals on|Macro check on|Risk check on|Making decision on|Executing)\s*/i, '')
    const short = clean.slice(0, 16) + (clean.length > 16 ? '…' : '')
    if (short) {
      const bw = short.length * 4 + 10
      const bx = Math.min(x + 4 - bw / 2, CW - bw - 4)
      const by = y - 36
      ctx.fillStyle = '#0d1520ee'
      ctx.fillRect(Math.max(bx, 4), by, bw, 13)
      ctx.fillRect(x + 3, by + 12, 4, 5)  // tail
      ctx.fillStyle = status === 'thinking' ? '#fde68a' : '#86efac'
      ctx.font = '6px "Courier New"'
      ctx.textAlign = 'left'
      ctx.fillText(short, Math.max(bx, 4) + 4, by + 3)
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function OfficeSimulation({
  agents,
  meeting,
  orchestratorRunning,
}: {
  agents: SimAgent[]
  meeting: SimMeeting
  orchestratorRunning: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const charsRef  = useRef<CharState[]>([])
  const agentsRef = useRef(agents)
  const meetingRef = useRef(meeting)
  const bgRef     = useRef<HTMLCanvasElement | null>(null)  // offscreen bg cache
  const rafRef    = useRef<number>(0)
  const lastRef   = useRef<number>(0)
  const bgDirty   = useRef(true)

  // Keep refs in sync with props (no re-render needed)
  agentsRef.current  = agents
  meetingRef.current = meeting

  // Initialise char states once
  if (charsRef.current.length === 0) {
    charsRef.current = ORDER.map(id => {
      const [tx, ty] = DESK[id]
      return { id, x: tx, y: ty, tx, ty, frame: 0, frameMs: 0, sitting: true }
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false

    // Build offscreen background cache
    const buildBg = () => {
      const off = document.createElement('canvas')
      off.width = CW; off.height = CH
      const octx = off.getContext('2d')!
      octx.imageSmoothingEnabled = false
      drawBg(octx)
      bgRef.current = off
      bgDirty.current = false
    }

    const loop = (ts: number) => {
      const dt = Math.min(ts - lastRef.current, 50)  // cap at 50ms
      lastRef.current = ts

      if (bgDirty.current || !bgRef.current) buildBg()

      // ── Update character positions ──────────────────────────────────────────
      const chars  = charsRef.current
      const ags    = agentsRef.current
      const meet   = meetingRef.current

      chars.forEach(char => {
        const ag = ags.find(a => a.id === char.id)
        if (!ag) return

        // Target: conference room when meeting active, desk otherwise
        const [tdx, tdy] = DESK[char.id]
        const [tcx, tcy] = CONF[char.id]
        const goConf = meet.active

        char.tx = goConf ? tcx : tdx
        char.ty = goConf ? tcy : tdy

        // Move toward target (L-path: horizontal first, then vertical)
        const dx = char.tx - char.x
        const dy = char.ty - char.y
        const moving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5

        if (Math.abs(dx) > 0.5) {
          char.x += Math.sign(dx) * Math.min(Math.abs(dx), SPEED * dt / 16)
        } else if (Math.abs(dy) > 0.5) {
          char.y += Math.sign(dy) * Math.min(Math.abs(dy), SPEED * dt / 16)
        } else {
          char.x = char.tx
          char.y = char.ty
        }

        // Walking animation
        if (moving) {
          char.sitting = false
          char.frameMs += dt
          if (char.frameMs >= WALK_MS) {
            char.frame = (char.frame + 1) % 4
            char.frameMs = 0
          }
        } else {
          char.sitting = true
          char.frame = 0
        }

        // Idle wander — small random drift at desk
        if (!moving && ag.status === 'idle' && Math.random() < 0.0005) {
          char.x += (Math.random() - 0.5) * 2
          char.y += (Math.random() - 0.5) * 2
        }
      })

      // ── Draw ────────────────────────────────────────────────────────────────
      // Blit cached background
      ctx.drawImage(bgRef.current!, 0, 0)

      // Meeting highlight overlay
      if (meet.active) {
        ctx.fillStyle = '#3b82f610'
        ctx.fillRect(18*T, 0, CW - 18*T, CH)
        ctx.strokeStyle = '#3b82f644'
        ctx.lineWidth = 1
        ctx.strokeRect(18*T + 1, 1, CW - 18*T - 4, CH - 4)
        // "MEETING IN PROGRESS" text
        ctx.fillStyle = '#3b82f6cc'
        ctx.font = 'bold 7px "Courier New"'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(`● MEETING: ${meet.symbol ?? ''}`, 19*T + (7*T)/2 + 2, 3*T + 18)
      }

      if (meet.decision && !meet.active) {
        const dc = meet.decision === 'BUY' ? '#22c55e' : meet.decision === 'SELL' ? '#ef4444' : '#3b82f6'
        ctx.fillStyle = dc + '22'
        ctx.fillRect(18*T, 0, CW - 18*T, CH)
        ctx.fillStyle = dc + 'cc'
        ctx.font = 'bold 9px "Courier New"'
        ctx.textAlign = 'center'
        ctx.fillText(`✓ ${meet.decision}`, 19*T + (7*T)/2 + 2, 3*T + 16)
        ctx.font = '6px "Courier New"'
        ctx.fillStyle = '#9ca3afaa'
        ctx.fillText(meet.symbol ?? '', 19*T + (7*T)/2 + 2, 3*T + 26)
      }

      // Draw characters (sorted by y for correct overlap)
      const sorted = [...chars].sort((a, b) => a.y - b.y)
      sorted.forEach(char => {
        const ag = ags.find(a => a.id === char.id)
        if (!ag) return
        drawChar(ctx, char, char.id, ag.status, ag.task, ag.lastRec)
      })

      // Overlay: shown briefly while the auto-start is warming up
      if (!orchestratorRunning) {
        ctx.fillStyle = '#00000055'
        ctx.fillRect(0, CH / 2 - 18, CW, 36)
        ctx.fillStyle = '#4b5563'
        ctx.font = '8px "Courier New"'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('INITIALISING — AUTO-STARTING…', CW / 2, CH / 2 - 5)
        ctx.font = '6px "Courier New"'
        ctx.fillStyle = '#374151'
        ctx.fillText('orchestrator starts automatically on boot', CW / 2, CH / 2 + 8)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [orchestratorRunning])

  return (
    <canvas
      ref={canvasRef}
      width={CW}
      height={CH}
      style={{
        width: '100%',
        maxWidth: CW * 2,
        display: 'block',
        imageRendering: 'pixelated',
        borderRadius: 10,
        border: '1px solid #1f2937',
        background: '#080d14',
      }}
    />
  )
}
