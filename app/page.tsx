'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'thinking' | 'active' | 'error'

interface AgentState {
  id: string; name: string; emoji: string; role: string
  status: AgentStatus; task: string; accuracyScore: number
}

interface Meeting {
  active: boolean; symbol: string | null
  decision: string | null; reasoning: string | null
  agents: string[]
}

interface Position {
  symbol: string; quantity: number; avgCost: number
  currentPrice: number; unrealizedPAndL: number
}

interface PortfolioState {
  totalValue: number; cash: number; budget: number
  positions: Position[]; mode: string
}

interface SafetyState {
  killSwitchActive: boolean; dailyLossPct: number
  dailyLossLimitPct: number; maxPositionPct: number
  stopLossPct: number; budget: number
}

interface BenchmarkEntry {
  symbol: string; name: string
  returnSinceBaseline: number; changePct: number
  currentPrice: number
}

interface BenchmarkData {
  portfolio: { name: string; returnSinceBaseline: number; currentValue: number; budget: number }
  benchmarks: BenchmarkEntry[]
  lastUpdated: number | null
}

interface FeedItem {
  id: string; ts: string; agentId?: string; emoji?: string
  msg: string; color: string
}

// ─── Constants ────────────────────────────────────────────────────────────

const AGENT_META: Record<string, { name: string; emoji: string; role: string }> = {
  researcher: { name: 'Alex',   emoji: '🧑‍💻', role: 'Research Analyst' },
  quant:      { name: 'Sam',    emoji: '📊',  role: 'Quant Analyst'    },
  risk:       { name: 'Drew',   emoji: '⚠️',  role: 'Risk Manager'     },
  macro:      { name: 'Jordan', emoji: '🌍',  role: 'Macro Strategist' },
  trader:     { name: 'Riley',  emoji: '💹',  role: 'Trader'           },
  pm:         { name: 'Morgan', emoji: '🧠',  role: 'Portfolio Manager' },
}

const FLOOR_AGENTS = ['researcher', 'quant', 'risk', 'macro', 'trader']

const DEFAULT_AGENTS: AgentState[] = Object.entries(AGENT_META).map(([id, m]) => ({
  id, ...m, status: 'idle', task: 'Standing by...', accuracyScore: 0.5,
}))

const DEFAULT_PORTFOLIO: PortfolioState = {
  totalValue: 0, cash: 0, budget: 10000, positions: [], mode: 'paper',
}

const DEFAULT_SAFETY: SafetyState = {
  killSwitchActive: false, dailyLossPct: 0, dailyLossLimitPct: 0.05,
  maxPositionPct: 0.15, stopLossPct: 0.08, budget: 10000,
}

// ─── Colour helpers ───────────────────────────────────────────────────────

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: '#4b5563', thinking: '#eab308', active: '#22c55e', error: '#ef4444',
}

const STATUS_GLOW: Record<AgentStatus, string> = {
  idle: 'none',
  thinking: '0 0 12px rgba(234,179,8,0.5)',
  active:   '0 0 12px rgba(34,197,94,0.5)',
  error:    '0 0 12px rgba(239,68,68,0.5)',
}

function decisionColor(d: string | null) {
  if (d === 'BUY')  return '#22c55e'
  if (d === 'SELL') return '#ef4444'
  if (d === 'HOLD') return '#3b82f6'
  return '#6b7280'
}

function pnlColor(v: number) { return v >= 0 ? '#22c55e' : '#ef4444' }
function fmt$(v: number) { return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtPct(v: number) { return `${(v * 100).toFixed(2)}%` }
function now() { return new Date().toLocaleTimeString('en-US', { hour12: false }) }

// ─── Sub-components ───────────────────────────────────────────────────────

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 6,
      animation: pulse ? 'pulse 1.2s ease-in-out infinite' : undefined,
    }} />
  )
}

function AgentDesk({ agent }: { agent: AgentState }) {
  const color = STATUS_COLOR[agent.status]
  const glow = STATUS_GLOW[agent.status]
  return (
    <div style={{
      background: '#111827', border: `1px solid ${color}33`,
      borderRadius: 8, padding: '12px 14px',
      boxShadow: glow, transition: 'box-shadow 0.3s, border-color 0.3s',
      minHeight: 90,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{agent.emoji}</span>
        <div>
          <div style={{ color: '#f9fafb', fontSize: 13, fontWeight: 'bold' }}>{agent.name}</div>
          <div style={{ color: '#6b7280', fontSize: 10 }}>{agent.role}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <Dot color={color} pulse={agent.status === 'thinking'} />
          <span style={{ color, fontSize: 10, textTransform: 'uppercase' }}>{agent.status}</span>
        </div>
      </div>
      <div style={{ color: '#9ca3af', fontSize: 11, lineHeight: 1.4, minHeight: 28, wordBreak: 'break-word' }}>
        {agent.task}
      </div>
    </div>
  )
}

function ConferenceRoom({ pm, meeting }: { pm: AgentState; meeting: Meeting }) {
  const glow = meeting.active
    ? '0 0 20px rgba(59,130,246,0.4)'
    : meeting.decision ? '0 0 12px rgba(34,197,94,0.2)' : 'none'
  const borderColor = meeting.active ? '#3b82f6' : '#1f2937'

  return (
    <div style={{
      background: '#0d1520', border: `1px solid ${borderColor}`,
      borderRadius: 10, padding: 16, boxShadow: glow,
      transition: 'all 0.4s',
    }}>
      <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>
        ◆ CONFERENCE ROOM
      </div>

      {/* Morgan */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', background: '#111827', borderRadius: 8, border: '1px solid #1f2937' }}>
        <span style={{ fontSize: 24 }}>🧠</span>
        <div>
          <div style={{ color: '#f9fafb', fontWeight: 'bold' }}>Morgan</div>
          <div style={{ color: '#6b7280', fontSize: 10 }}>Portfolio Manager</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <Dot color={STATUS_COLOR[pm.status]} pulse={pm.status === 'thinking'} />
          <span style={{ color: STATUS_COLOR[pm.status], fontSize: 10, textTransform: 'uppercase' }}>{pm.status}</span>
        </div>
      </div>

      {/* Meeting state */}
      {meeting.active ? (
        <div style={{ background: '#0c1a2e', border: '1px solid #3b82f633', borderRadius: 8, padding: 12 }}>
          <div style={{ color: '#3b82f6', fontSize: 11, marginBottom: 6, animation: 'pulse 1s infinite' }}>
            ● MEETING IN PROGRESS
          </div>
          <div style={{ color: '#93c5fd', fontSize: 12 }}>
            Reviewing: <strong>{meeting.symbol}</strong>
          </div>
          <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>
            {meeting.agents.join(' · ')}
          </div>
        </div>
      ) : meeting.decision ? (
        <div style={{ background: '#0c1a14', border: `1px solid ${decisionColor(meeting.decision)}33`, borderRadius: 8, padding: 12 }}>
          <div style={{ color: '#6b7280', fontSize: 10, marginBottom: 6 }}>LAST DECISION</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: decisionColor(meeting.decision), fontSize: 18, fontWeight: 'bold' }}>
              {meeting.decision}
            </span>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>{meeting.symbol}</span>
          </div>
          {meeting.reasoning && (
            <div style={{ color: '#6b7280', fontSize: 10, lineHeight: 1.5, maxHeight: 56, overflow: 'hidden' }}>
              {String(meeting.reasoning).slice(0, 180)}{String(meeting.reasoning).length > 180 ? '...' : ''}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: '#374151', fontSize: 11, textAlign: 'center', padding: '16px 0' }}>
          No meetings yet.<br />Start the orchestrator to begin.
        </div>
      )}

      <div style={{ marginTop: 10, color: '#374151', fontSize: 10 }}>
        {pm.task !== 'Standing by...' && pm.task}
      </div>
    </div>
  )
}

function SafetyPanel({ safety, onToggleKill }: { safety: SafetyState; onToggleKill: () => void }) {
  const killActive = safety.killSwitchActive
  const lossBarPct = Math.min(1, safety.dailyLossPct / safety.dailyLossLimitPct)
  const lossColor = lossBarPct > 0.8 ? '#ef4444' : lossBarPct > 0.5 ? '#eab308' : '#22c55e'

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
      <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>◆ SAFETY CONTROLS</div>

      {/* Kill switch */}
      <button
        onClick={onToggleKill}
        style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: killActive ? '#7f1d1d' : '#1f2937',
          color: killActive ? '#fca5a5' : '#6b7280',
          fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 'bold',
          boxShadow: killActive ? '0 0 16px rgba(239,68,68,0.4)' : 'none',
          transition: 'all 0.2s', letterSpacing: 1,
          border: killActive ? '1px solid #ef444466' : '1px solid #374151',
        }}
      >
        {killActive ? '🔴 KILL SWITCH ACTIVE — CLICK TO RESUME' : '⬛ KILL SWITCH OFF'}
      </button>

      {killActive && (
        <div style={{ marginTop: 8, color: '#ef4444', fontSize: 10, textAlign: 'center' }}>
          All trading halted. Click to resume.
        </div>
      )}

      {/* Daily loss bar */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#6b7280', fontSize: 10 }}>DAILY LOSS</span>
          <span style={{ color: lossColor, fontSize: 10 }}>
            {fmtPct(safety.dailyLossPct)} / {fmtPct(safety.dailyLossLimitPct)} limit
          </span>
        </div>
        <div style={{ background: '#1f2937', borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4, transition: 'width 0.5s',
            width: `${lossBarPct * 100}%`,
            background: lossColor,
            boxShadow: lossBarPct > 0.5 ? `0 0 6px ${lossColor}` : 'none',
          }} />
        </div>
      </div>

      {/* Limit badges */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        {[
          { label: 'Max Position', value: fmtPct(safety.maxPositionPct), ok: true },
          { label: 'Stop Loss',    value: fmtPct(safety.stopLossPct),    ok: true },
        ].map(({ label, value, ok }) => (
          <div key={label} style={{ background: '#0a0e14', borderRadius: 6, padding: '8px 10px', border: '1px solid #1f2937' }}>
            <div style={{ color: '#6b7280', fontSize: 9 }}>{label}</div>
            <div style={{ color: ok ? '#22c55e' : '#ef4444', fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PortfolioPanel({ portfolio, safety }: { portfolio: PortfolioState; safety: SafetyState }) {
  const totalValue = portfolio.totalValue || safety.budget
  const pnl = totalValue - safety.budget
  const pnlPct = safety.budget > 0 ? pnl / safety.budget : 0

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
      <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>◆ PORTFOLIO</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ color: '#6b7280', fontSize: 10 }}>TOTAL VALUE</div>
        <div style={{ color: '#f9fafb', fontSize: 22, fontWeight: 'bold', marginTop: 2 }}>{fmt$(totalValue)}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: '#0a0e14', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: '#6b7280', fontSize: 9 }}>CASH</div>
          <div style={{ color: '#93c5fd', fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{fmt$(portfolio.cash || safety.budget)}</div>
        </div>
        <div style={{ background: '#0a0e14', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: '#6b7280', fontSize: 9 }}>P&L</div>
          <div style={{ color: pnlColor(pnl), fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>
            {pnl >= 0 ? '+' : ''}{fmt$(pnl)} ({pnl >= 0 ? '+' : ''}{fmtPct(Math.abs(pnlPct))})
          </div>
        </div>
      </div>

      {/* Mode badge */}
      <div style={{ marginBottom: 10 }}>
        <span style={{
          fontSize: 9, padding: '3px 8px', borderRadius: 4,
          background: portfolio.mode === 'live' ? '#7f1d1d' : portfolio.mode === 'paper' ? '#1e3a5f' : '#1a2d1a',
          color: portfolio.mode === 'live' ? '#fca5a5' : portfolio.mode === 'paper' ? '#93c5fd' : '#86efac',
          textTransform: 'uppercase', letterSpacing: 1,
        }}>
          {portfolio.mode} mode
        </span>
      </div>

      {/* Positions */}
      {portfolio.positions.length > 0 ? (
        <div>
          <div style={{ color: '#6b7280', fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>OPEN POSITIONS ({portfolio.positions.length})</div>
          {portfolio.positions.map(p => (
            <div key={p.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: '#0a0e14', borderRadius: 6, marginBottom: 4, fontSize: 11 }}>
              <div>
                <span style={{ color: '#f9fafb', fontWeight: 'bold' }}>{p.symbol}</span>
                <span style={{ color: '#6b7280', marginLeft: 6 }}>×{p.quantity}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#9ca3af' }}>{fmt$(p.currentPrice)}</div>
                <div style={{ color: pnlColor(p.unrealizedPAndL), fontSize: 10 }}>
                  {p.unrealizedPAndL >= 0 ? '+' : ''}{fmt$(p.unrealizedPAndL)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: '#374151', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>No open positions</div>
      )}
    </div>
  )
}

function BenchmarkPanel({ data, onRefresh }: { data: BenchmarkData | null; onRefresh: () => void }) {
  if (!data) return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
      <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2 }}>◆ BENCHMARK COMPARISON</div>
      <div style={{ color: '#374151', fontSize: 11, marginTop: 12, textAlign: 'center' }}>Loading benchmarks...</div>
    </div>
  )

  const all = [
    { symbol: 'MERIDIAN', name: data.portfolio.name, ret: data.portfolio.returnSinceBaseline, today: null },
    ...data.benchmarks.map(b => ({ symbol: b.symbol, name: b.name, ret: b.returnSinceBaseline, today: b.changePct })),
  ]

  const maxAbs = Math.max(0.01, ...all.map(e => Math.abs(e.ret)))
  const ts = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('en-US', { hour12: false }) : '—'

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2 }}>◆ BENCHMARK COMPARISON</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#374151', fontSize: 9 }}>updated {ts}</span>
          <button onClick={onRefresh} style={{ padding: '3px 8px', background: '#1f2937', border: '1px solid #374151', borderRadius: 4, color: '#6b7280', fontSize: 9, fontFamily: 'inherit', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ fontSize: 9, color: '#374151', marginBottom: 10 }}>
        % return from first snapshot · Nifty/Sensex in ₹ · Portfolio in $
      </div>

      {all.map(({ symbol, name, ret, today }) => {
        const barPct = (ret / maxAbs) * 50 // 50% = max bar width
        const color = ret >= 0 ? '#22c55e' : '#ef4444'
        const isMine = symbol === 'MERIDIAN'
        return (
          <div key={symbol} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: isMine ? '#f9fafb' : '#9ca3af', fontSize: isMine ? 12 : 11, fontWeight: isMine ? 'bold' : 'normal' }}>
                {isMine ? '▶ ' : ''}{name}
              </span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {today !== null && (
                  <span style={{ color: today >= 0 ? '#22c55e' : '#ef4444', fontSize: 9 }}>
                    {today >= 0 ? '+' : ''}{(today * 100).toFixed(2)}% today
                  </span>
                )}
                <span style={{ color, fontSize: 12, fontWeight: 'bold' }}>
                  {ret >= 0 ? '+' : ''}{(ret * 100).toFixed(2)}%
                </span>
              </div>
            </div>
            <div style={{ background: '#1f2937', borderRadius: 3, height: 4, position: 'relative' }}>
              <div style={{
                position: 'absolute',
                left: ret >= 0 ? '50%' : `${50 + barPct}%`,
                width: `${Math.abs(barPct)}%`,
                height: '100%',
                background: color,
                borderRadius: 3,
                boxShadow: isMine ? `0 0 6px ${color}` : 'none',
                transition: 'width 0.5s',
              }} />
              {/* centre line */}
              <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: '#374151' }} />
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: 10, padding: '8px 10px', background: '#0a0e14', borderRadius: 6, fontSize: 9, color: '#374151', lineHeight: 1.6 }}>
        ⚠ Nifty 50 &amp; Sensex are INR-denominated. Alpaca only trades US markets (USD).<br />
        To trade Indian markets, Zerodha/Upstox API integration is needed.
      </div>
    </div>
  )
}

function ActivityFeed({ items }: { items: FeedItem[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [items])

  return (
    <div ref={ref} style={{ height: 160, overflowY: 'auto', background: '#050a10', border: '1px solid #1f2937', borderRadius: 8, padding: '8px 12px' }}>
      {items.length === 0 ? (
        <div style={{ color: '#374151', fontSize: 11, paddingTop: 8 }}>Waiting for activity...</div>
      ) : items.map(item => (
        <div key={item.id} style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: '#374151', flexShrink: 0 }}>{item.ts}</span>
          {item.emoji && <span style={{ flexShrink: 0 }}>{item.emoji}</span>}
          <span style={{ color: item.color }}>{item.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main dashboard ───────────────────────────────────────────────────────

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentState[]>(DEFAULT_AGENTS)
  const [meeting, setMeeting] = useState<Meeting>({ active: false, symbol: null, decision: null, reasoning: null, agents: [] })
  const [portfolio, setPortfolio] = useState<PortfolioState>(DEFAULT_PORTFOLIO)
  const [safety, setSafety] = useState<SafetyState>(DEFAULT_SAFETY)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [benchmarks, setBenchmarks] = useState<BenchmarkData | null>(null)
  const [connected, setConnected] = useState(false)
  const [orchestratorRunning, setOrchestratorRunning] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const addFeed = useCallback((agentId: string | undefined, msg: string, color: string) => {
    const meta = agentId ? AGENT_META[agentId] : undefined
    setFeed(f => [...f.slice(-199), { id: Math.random().toString(36).slice(2), ts: now(), agentId, emoji: meta?.emoji, msg, color }])
  }, [])

  const updateAgent = useCallback((id: string, patch: Partial<AgentState>) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a))
  }, [])

  const fetchPortfolio = useCallback(async () => {
    try {
      const r = await fetch('/api/portfolio')
      const d = await r.json()
      if (d.portfolio || d.positions) {
        setPortfolio({
          totalValue: d.portfolio?.totalValue ?? 0,
          cash: d.portfolio?.cash ?? 0,
          budget: d.portfolio?.budget ?? 10000,
          positions: (d.positions ?? []).map((p: Record<string, unknown>) => ({
            symbol: p.symbol, quantity: p.quantity,
            avgCost: p.avgCost ?? p.avg_cost ?? 0,
            currentPrice: p.currentPrice ?? p.current_price ?? 0,
            unrealizedPAndL: p.unrealizedPAndL ?? p.unrealized_p_and_l ?? 0,
          })),
          mode: d.mode ?? 'paper',
        })
      }
    } catch {}
  }, [])

  const fetchSafety = useCallback(async () => {
    try {
      const r = await fetch('/api/safety')
      const d = await r.json()
      setSafety(d)
    } catch {}
  }, [])

  const fetchBenchmarks = useCallback(async (force = false) => {
    try {
      const r = await fetch(force ? '/api/benchmarks' : '/api/benchmarks', { method: force ? 'POST' : 'GET' })
      const d = await r.json()
      setBenchmarks(d)
    } catch {}
  }, [])

  const fetchOrchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/agents')
      const d = await r.json()
      setOrchestratorRunning(d.orchestrator?.running ?? false)
      // Seed agent accuracy scores
      if (d.agents) {
        setAgents(prev => prev.map(a => {
          const srv = d.agents.find((s: Record<string, unknown>) => s.id === a.id)
          return srv ? { ...a, accuracyScore: srv.accuracyScore ?? 0.5 } : a
        }))
      }
    } catch {}
  }, [])

  // SSE connection
  useEffect(() => {
    let es: EventSource
    let reconnect: ReturnType<typeof setTimeout>

    function connect() {
      es = new EventSource('/api/stream')
      esRef.current = es

      es.onopen = () => setConnected(true)
      es.onerror = () => {
        setConnected(false)
        es.close()
        reconnect = setTimeout(connect, 3000)
      }

      es.onmessage = (e: MessageEvent) => {
        let ev: Record<string, unknown>
        try { ev = JSON.parse(e.data) } catch { return }

        const type = ev.type as string
        const payload = (ev.payload ?? {}) as Record<string, unknown>
        const agentId = ev.agentId as string | undefined

        if (type === 'agent_update') {
          const status = (payload.status as AgentStatus) ?? 'idle'
          const task = (payload.task as string) ?? ''
          if (agentId) updateAgent(agentId, { status, task })
          if (task) addFeed(agentId, task, STATUS_COLOR[status] ?? '#6b7280')
        }

        if (type === 'meeting_started') {
          setMeeting(m => ({ ...m, active: true, symbol: payload.symbol as string, agents: (payload.agents as string[]) ?? [] }))
          addFeed('pm', `Meeting started — ${payload.symbol}`, '#3b82f6')
        }

        if (type === 'decision_made') {
          const dec = payload.decision as string
          setMeeting(m => ({ ...m, active: false, decision: dec, reasoning: payload.reasoning as string }))
          updateAgent('pm', { status: dec === 'BUY' || dec === 'SELL' ? 'active' : 'idle', task: `Decision: ${dec} ${payload.symbol}` })
          addFeed('pm', `Decision: ${dec} on ${payload.symbol}`, decisionColor(dec))
        }

        if (type === 'trade_executed') {
          const action = payload.action as string
          const qty = payload.quantity as number
          const price = payload.price as number
          const sym = payload.symbol as string
          addFeed('trader', `${action} ${qty} × ${sym} @ $${price?.toFixed(2)}`, action === 'BUY' ? '#22c55e' : '#ef4444')
          fetchPortfolio()
        }

        if (type === 'safety_event') {
          const msg = (payload.message ?? payload.reason) as string
          addFeed(agentId ?? 'risk', `🛑 ${msg}`, '#ef4444')
          fetchSafety()
        }
      }
    }

    connect()
    return () => { es?.close(); clearTimeout(reconnect) }
  }, [addFeed, updateAgent, fetchPortfolio, fetchSafety])

  // Polling
  useEffect(() => {
    fetchPortfolio(); fetchSafety(); fetchOrchStatus(); fetchBenchmarks()
    const t1 = setInterval(fetchPortfolio, 10000)
    const t2 = setInterval(fetchSafety, 4000)
    const t3 = setInterval(fetchOrchStatus, 5000)
    const t4 = setInterval(fetchBenchmarks, 60000) // benchmarks every 60s
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, [fetchPortfolio, fetchSafety, fetchOrchStatus, fetchBenchmarks])

  const toggleOrchestrator = async () => {
    const action = orchestratorRunning ? 'stop' : 'start'
    const opts = action === 'start' ? { mode: 'simulation', intervalMs: 300000 } : undefined
    await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, options: opts }) })
    setOrchestratorRunning(!orchestratorRunning)
    addFeed(undefined, `Orchestrator ${action}ped`, orchestratorRunning ? '#6b7280' : '#22c55e')
  }

  const toggleKillSwitch = async () => {
    const action = safety.killSwitchActive ? 'deactivate' : 'activate'
    await fetch('/api/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    setSafety(s => ({ ...s, killSwitchActive: !s.killSwitchActive }))
    addFeed(undefined, `Kill switch ${action}d`, action === 'activate' ? '#ef4444' : '#22c55e')
  }

  const analyzeSymbol = async (sym: string) => {
    await fetch('/api/trading/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) })
    addFeed(undefined, `Analysis triggered: ${sym}`, '#3b82f6')
  }

  const pmAgent = agents.find(a => a.id === 'pm') ?? DEFAULT_AGENTS.find(a => a.id === 'pm')!
  const floorAgents = FLOOR_AGENTS.map(id => agents.find(a => a.id === id)!)

  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        ::-webkit-scrollbar { width:6px }
        ::-webkit-scrollbar-track { background:#0a0e14 }
        ::-webkit-scrollbar-thumb { background:#1f2937; border-radius:3px }
        button:hover { filter:brightness(1.15) }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 24px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0 12px', borderBottom: '1px solid #1f2937', marginBottom: 16 }}>
          <div>
            <div style={{ color: '#22c55e', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 }}>◆ MERIDIAN CAPITAL</div>
            <div style={{ color: '#374151', fontSize: 10, letterSpacing: 1 }}>AI HEDGE FUND</div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Connection indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#22c55e' : '#ef4444', boxShadow: connected ? '0 0 6px #22c55e' : 'none' }} />
              <span style={{ color: '#6b7280', fontSize: 10 }}>{connected ? 'LIVE' : 'DISCONNECTED'}</span>
            </div>

            {/* Watchlist quick-trigger buttons */}
            {['NVDA','AAPL','MSFT','GOOGL','AMZN'].map(sym => (
              <button key={sym} onClick={() => analyzeSymbol(sym)} style={{ padding: '4px 10px', background: '#1f2937', border: '1px solid #374151', borderRadius: 5, color: '#9ca3af', fontSize: 10, fontFamily: 'inherit', cursor: 'pointer', letterSpacing: 0.5 }}>
                {sym}
              </button>
            ))}

            {/* Start/Stop */}
            <button onClick={toggleOrchestrator} style={{ padding: '6px 16px', background: orchestratorRunning ? '#422006' : '#052e16', border: `1px solid ${orchestratorRunning ? '#78350f' : '#14532d'}`, borderRadius: 6, color: orchestratorRunning ? '#fbbf24' : '#22c55e', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 'bold', letterSpacing: 1 }}>
              {orchestratorRunning ? '⏹ STOP' : '▶ START'}
            </button>
          </div>
        </div>

        {/* Main grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px 280px', gap: 12, marginBottom: 12 }}>

          {/* Office floor */}
          <div>
            <div style={{ color: '#374151', fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>◆ OFFICE FLOOR</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {floorAgents.map(a => <AgentDesk key={a.id} agent={a} />)}
            </div>
          </div>

          {/* Conference room */}
          <div>
            <div style={{ color: '#374151', fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>◆ C-SUITE</div>
            <ConferenceRoom pm={pmAgent} meeting={meeting} />
          </div>

          {/* Right column: portfolio + safety */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PortfolioPanel portfolio={portfolio} safety={safety} />
            <SafetyPanel safety={safety} onToggleKill={toggleKillSwitch} />
          </div>
        </div>

        {/* Bottom row: benchmarks + activity feed */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ color: '#374151', fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>◆ ACTIVITY FEED</div>
            <ActivityFeed items={feed} />
          </div>
          <BenchmarkPanel data={benchmarks} onRefresh={() => fetchBenchmarks(true)} />
        </div>
      </div>
    </>
  )
}
