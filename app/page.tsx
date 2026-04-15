'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import OfficeSimulation from './components/OfficeSimulation'

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'thinking' | 'active' | 'error'

interface AgentState {
  id: string; name: string; emoji: string; role: string
  status: AgentStatus; task: string; accuracyScore: number
  lastRec?: string; lastConviction?: number; lastSymbol?: string; lastVeto?: boolean
}

interface TeamVote {
  agentId: string; recommendation: string; conviction: number; veto?: boolean
}

interface Meeting {
  active: boolean; symbol: string | null; decision: string | null
  reasoning: string | null; confidence?: number
  positionSizeUsd?: number; targetPrice?: number; stopLoss?: number
  teamVotes: Record<string, TeamVote>
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
  returnSinceBaseline: number; changePct: number; currentPrice: number
}

interface BenchmarkData {
  portfolio: { name: string; returnSinceBaseline: number; currentValue: number; budget: number }
  benchmarks: BenchmarkEntry[]; lastUpdated: number | null
}

interface FeedItem {
  id: string; ts: string; agentId?: string; emoji?: string
  msg: string; color: string
}

interface CycleInfo {
  symbol: string; watchlistIndex: number; totalSymbols: number
}

interface RecentTrade {
  id: string; action: string; symbol: string; qty: number; price: number; ts: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT_META: Record<string, { name: string; emoji: string; role: string; description: string }> = {
  researcher: { name: 'Alex',   emoji: '🧑‍💻', role: 'Research Analyst',   description: 'Reads news, earnings dates, fundamentals. Sets conviction 1–10. Low conviction skips the entire pipeline.' },
  quant:      { name: 'Sam',    emoji: '📊',  role: 'Quant Analyst',       description: 'Computes RSI(14) on 90 days of OHLCV data. Finds support/resistance levels and trend direction.' },
  risk:       { name: 'Drew',   emoji: '⚠️',  role: 'Risk Manager',        description: 'Checks position size vs portfolio limits. Can issue a veto — which the PM cannot override.' },
  macro:      { name: 'Jordan', emoji: '🌍',  role: 'Macro Strategist',    description: 'Reads broad market (SPY) news. Classifies market cycle and whether macro conditions support the trade.' },
  pm:         { name: 'Morgan', emoji: '🧠',  role: 'Portfolio Manager',   description: 'Reads all four reports and makes the final BUY / SELL / HOLD / PASS call. Also decides position size.' },
  trader:     { name: 'Riley',  emoji: '💹',  role: 'Trader',              description: 'Submits market orders via Alpaca. Enforces 24h min hold time. Writes a lesson to memory after every closed position.' },
}

const PIPELINE_ORDER = ['researcher', 'quant', 'macro', 'risk', 'pm', 'trader']
const FLOOR_AGENTS   = ['researcher', 'quant', 'risk', 'macro', 'trader']

const DEFAULT_AGENTS: AgentState[] = Object.entries(AGENT_META).map(([id, m]) => ({
  id, name: m.name, emoji: m.emoji, role: m.role,
  status: 'idle', task: 'Standing by...', accuracyScore: 0.5,
}))

const DEFAULT_PORTFOLIO: PortfolioState = { totalValue: 0, cash: 0, budget: 10000, positions: [], mode: 'paper' }
const DEFAULT_SAFETY: SafetyState = { killSwitchActive: false, dailyLossPct: 0, dailyLossLimitPct: 0.05, maxPositionPct: 0.15, stopLossPct: 0.08, budget: 10000 }

// ─── Colour helpers ───────────────────────────────────────────────────────────

const C = {
  bg:      '#080d14',
  panel:   '#0d1520',
  card:    '#111827',
  border:  '#1f2937',
  dim:     '#374151',
  muted:   '#6b7280',
  text:    '#9ca3af',
  bright:  '#f9fafb',
  green:   '#22c55e',
  red:     '#ef4444',
  yellow:  '#eab308',
  blue:    '#3b82f6',
  purple:  '#a855f7',
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: C.dim, thinking: C.yellow, active: C.green, error: C.red,
}

function recColor(r?: string) {
  if (r === 'BUY')  return C.green
  if (r === 'SELL') return C.red
  if (r === 'HOLD') return C.blue
  return C.muted
}

function pnlColor(v: number) { return v >= 0 ? C.green : C.red }
function fmt$(v: number) { return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function fmtPct(v: number) { return `${(v * 100).toFixed(2)}%` }
function fmtPctSigned(v: number) { return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` }
function nowStr() { return new Date().toLocaleTimeString('en-US', { hour12: false }) }

// ─── Pipeline Flow ────────────────────────────────────────────────────────────

function PipelineFlow({ agents, cycleInfo }: { agents: AgentState[]; cycleInfo: CycleInfo | null }) {
  const activeStep = PIPELINE_ORDER.findIndex(id => agents.find(a => a.id === id)?.status === 'thinking')
  const completedSteps = new Set(
    PIPELINE_ORDER.slice(0, activeStep === -1 ? 0 : activeStep).map((_, i) => i)
  )

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: `0 0 6px ${C.green}`, animation: 'pulse 1.2s ease-in-out infinite' }} />
        <span style={{ color: C.text, fontSize: 11 }}>
          {cycleInfo
            ? `Analyzing ${cycleInfo.symbol} · Symbol ${cycleInfo.watchlistIndex + 1} of ${cycleInfo.totalSymbols}`
            : 'Analysis pipeline'}
        </span>
        {cycleInfo && (
          <span style={{ marginLeft: 'auto', color: C.muted, fontSize: 10 }}>
            32-symbol watchlist · cycles every 15 min
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {PIPELINE_ORDER.map((id, i) => {
          const meta = AGENT_META[id]
          const agent = agents.find(a => a.id === id)
          const isActive = agent?.status === 'thinking'
          const isDone = completedSteps.has(i)
          const color = isActive ? C.yellow : isDone ? C.green : C.dim

          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', flex: i < PIPELINE_ORDER.length - 1 ? 1 : undefined }}>
              <div style={{
                background: isActive ? '#1a1500' : isDone ? '#0a1a0a' : C.card,
                border: `1px solid ${color}44`,
                borderRadius: 8, padding: '6px 10px',
                boxShadow: isActive ? `0 0 10px ${C.yellow}33` : isDone ? `0 0 6px ${C.green}22` : 'none',
                transition: 'all 0.3s', whiteSpace: 'nowrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 13 }}>{meta.emoji}</span>
                  <div>
                    <div style={{ color: isActive ? C.yellow : isDone ? C.green : C.muted, fontSize: 11, fontWeight: isActive ? 'bold' : 'normal' }}>
                      {meta.name}
                    </div>
                    <div style={{ color: C.dim, fontSize: 9 }}>{meta.role.split(' ')[0]}</div>
                  </div>
                  {isDone && agent?.lastRec && (
                    <span style={{ marginLeft: 4, fontSize: 9, padding: '1px 5px', borderRadius: 3, background: `${recColor(agent.lastRec)}22`, color: recColor(agent.lastRec), fontWeight: 'bold' }}>
                      {agent.lastRec}
                    </span>
                  )}
                  {isActive && <span style={{ color: C.yellow, fontSize: 9, animation: 'pulse 1s infinite' }}>●</span>}
                </div>
              </div>
              {i < PIPELINE_ORDER.length - 1 && (
                <div style={{ flex: 1, height: 1, background: isDone ? `${C.green}44` : C.border, margin: '0 2px', position: 'relative' }}>
                  {isDone && <div style={{ position: 'absolute', right: -4, top: -4, color: C.green, fontSize: 9 }}>›</div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Agent Desk ───────────────────────────────────────────────────────────────

function AgentDesk({ agent }: { agent: AgentState }) {
  const color = STATUS_COLOR[agent.status]
  const meta = AGENT_META[agent.id]
  const convictionPct = ((agent.lastConviction ?? 0) / 10) * 100

  return (
    <div style={{
      background: C.card, border: `1px solid ${color}33`,
      borderRadius: 8, padding: '12px 14px',
      boxShadow: agent.status === 'thinking' ? `0 0 14px ${C.yellow}33` : agent.status === 'active' ? `0 0 8px ${C.green}22` : 'none',
      transition: 'all 0.3s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{agent.emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: C.bright, fontSize: 13, fontWeight: 'bold' }}>{agent.name}</span>
            {/* Status badge */}
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: 0.5,
              background: `${color}22`, color,
              animation: agent.status === 'thinking' ? 'pulse 1.2s infinite' : undefined,
            }}>{agent.status}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 10, marginTop: 1 }}>{agent.role}</div>
        </div>
        {/* Accuracy */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ color: C.muted, fontSize: 9 }}>ACCURACY</div>
          <div style={{ color: agent.accuracyScore >= 0.6 ? C.green : agent.accuracyScore >= 0.4 ? C.yellow : C.red, fontSize: 12, fontWeight: 'bold' }}>
            {(agent.accuracyScore * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Current task */}
      <div style={{ color: C.text, fontSize: 11, lineHeight: 1.4, minHeight: 28, wordBreak: 'break-word', marginBottom: 8 }}>
        {agent.task}
      </div>

      {/* Last recommendation */}
      {agent.lastRec && agent.lastSymbol && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ color: C.dim, fontSize: 9 }}>LAST:</span>
          <span style={{ color: C.muted, fontSize: 9 }}>{agent.lastSymbol}</span>
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 3, fontWeight: 'bold',
            background: `${recColor(agent.lastRec)}22`, color: recColor(agent.lastRec),
          }}>{agent.lastRec}</span>
          {agent.lastVeto && (
            <span style={{ fontSize: 9, color: C.red, background: '#7f1d1d55', padding: '1px 5px', borderRadius: 3 }}>VETO</span>
          )}
        </div>
      )}

      {/* Conviction bar */}
      {(agent.lastConviction ?? 0) > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ color: C.dim, fontSize: 9 }}>CONVICTION</span>
            <span style={{ color: C.text, fontSize: 9 }}>{agent.lastConviction}/10</span>
          </div>
          <div style={{ background: C.border, borderRadius: 3, height: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 3, width: `${convictionPct}%`, background: convictionPct >= 70 ? C.green : convictionPct >= 40 ? C.yellow : C.red, transition: 'width 0.5s' }} />
          </div>
        </div>
      )}

      {/* Role description — shown when idle and no conviction */}
      {agent.status === 'idle' && !agent.lastRec && (
        <div style={{ color: C.dim, fontSize: 10, lineHeight: 1.4, marginTop: 4, fontStyle: 'italic' }}>
          {meta.description.split('.')[0]}.
        </div>
      )}
    </div>
  )
}

// ─── Conference Room ──────────────────────────────────────────────────────────

function ConferenceRoom({ pm, meeting }: { pm: AgentState; meeting: Meeting }) {
  const isActive = meeting.active
  const hasDec = !!meeting.decision
  const borderColor = isActive ? C.blue : hasDec ? `${recColor(meeting.decision ?? undefined)}44` : C.border

  const VOTE_AGENTS = ['researcher', 'quant', 'macro', 'risk']

  return (
    <div style={{ background: C.panel, border: `1px solid ${borderColor}`, borderRadius: 10, padding: 16, transition: 'all 0.4s', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>◆ CONFERENCE ROOM</div>

      {/* Morgan header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 12px', background: C.card, borderRadius: 8, border: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 22 }}>🧠</span>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.bright, fontWeight: 'bold', fontSize: 13 }}>Morgan</div>
          <div style={{ color: C.muted, fontSize: 10 }}>Portfolio Manager · makes final call</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLOR[pm.status], animation: pm.status === 'thinking' ? 'pulse 1.2s infinite' : undefined }} />
          <span style={{ color: STATUS_COLOR[pm.status], fontSize: 9, textTransform: 'uppercase' }}>{pm.status}</span>
        </div>
      </div>

      {/* Team votes — always shown if any votes present */}
      {Object.keys(meeting.teamVotes).length > 0 && (
        <div style={{ background: '#070c12', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ color: C.dim, fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>TEAM VOTES — {meeting.symbol}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <td style={{ color: C.dim, fontSize: 9, paddingBottom: 4 }}>AGENT</td>
                <td style={{ color: C.dim, fontSize: 9, paddingBottom: 4, textAlign: 'center' }}>VOTE</td>
                <td style={{ color: C.dim, fontSize: 9, paddingBottom: 4, textAlign: 'right' }}>CONVICTION</td>
              </tr>
            </thead>
            <tbody>
              {VOTE_AGENTS.map(id => {
                const v = meeting.teamVotes[id]
                const meta = AGENT_META[id]
                if (!v) return null
                return (
                  <tr key={id} style={{ borderTop: `1px solid ${C.border}22` }}>
                    <td style={{ padding: '5px 0', fontSize: 11 }}>
                      <span style={{ marginRight: 5 }}>{meta.emoji}</span>
                      <span style={{ color: C.text }}>{meta.name}</span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '5px 0' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 4,
                        background: `${recColor(v.recommendation)}22`, color: recColor(v.recommendation),
                      }}>
                        {v.recommendation}
                        {v.veto && ' ⛔'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '5px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                        <div style={{ width: 40, background: C.border, borderRadius: 2, height: 4, overflow: 'hidden' }}>
                          <div style={{ width: `${(v.conviction / 10) * 100}%`, height: '100%', background: recColor(v.recommendation), borderRadius: 2 }} />
                        </div>
                        <span style={{ color: C.muted, fontSize: 10 }}>{v.conviction}/10</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Meeting status or decision */}
      {isActive ? (
        <div style={{ background: '#0c1a2e', border: `1px solid ${C.blue}33`, borderRadius: 8, padding: 12 }}>
          <div style={{ color: C.blue, fontSize: 11, marginBottom: 4, animation: 'pulse 1s infinite' }}>● MEETING IN PROGRESS</div>
          <div style={{ color: '#93c5fd', fontSize: 12 }}>Morgan is reviewing all reports for <strong>{meeting.symbol}</strong></div>
          <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>Final BUY / SELL / HOLD / PASS decision pending...</div>
        </div>
      ) : meeting.decision ? (
        <div style={{ background: `${recColor(meeting.decision)}0d`, border: `1px solid ${recColor(meeting.decision)}33`, borderRadius: 8, padding: 12 }}>
          <div style={{ color: C.dim, fontSize: 9, marginBottom: 6 }}>FINAL DECISION</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <span style={{ color: recColor(meeting.decision), fontSize: 28, fontWeight: 'bold', letterSpacing: 1 }}>{meeting.decision}</span>
            <span style={{ color: C.text, fontSize: 14 }}>{meeting.symbol}</span>
            {meeting.confidence && (
              <span style={{ color: C.muted, fontSize: 10, marginLeft: 'auto' }}>confidence {meeting.confidence}/10</span>
            )}
          </div>
          {meeting.positionSizeUsd != null && meeting.positionSizeUsd > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
              <div style={{ background: C.card, borderRadius: 5, padding: '4px 8px' }}>
                <div style={{ color: C.dim, fontSize: 8 }}>POSITION SIZE</div>
                <div style={{ color: C.text, fontSize: 11, fontWeight: 'bold' }}>{fmt$(meeting.positionSizeUsd)}</div>
              </div>
              {meeting.targetPrice && (
                <div style={{ background: C.card, borderRadius: 5, padding: '4px 8px' }}>
                  <div style={{ color: C.dim, fontSize: 8 }}>TARGET</div>
                  <div style={{ color: C.green, fontSize: 11, fontWeight: 'bold' }}>{fmt$(meeting.targetPrice)}</div>
                </div>
              )}
              {meeting.stopLoss && (
                <div style={{ background: C.card, borderRadius: 5, padding: '4px 8px' }}>
                  <div style={{ color: C.dim, fontSize: 8 }}>STOP LOSS</div>
                  <div style={{ color: C.red, fontSize: 11, fontWeight: 'bold' }}>{fmt$(meeting.stopLoss)}</div>
                </div>
              )}
            </div>
          )}
          {meeting.reasoning && (
            <div style={{ color: C.muted, fontSize: 10, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
              {String(meeting.reasoning).slice(0, 220)}{String(meeting.reasoning).length > 220 ? '...' : ''}
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: '20px 0', lineHeight: 1.7 }}>
          No meetings yet.<br />
          <span style={{ fontSize: 10, color: C.border }}>Start the orchestrator — Morgan reviews<br />all team reports and makes the final call.</span>
        </div>
      )}
    </div>
  )
}

// ─── Portfolio Panel ──────────────────────────────────────────────────────────

function PortfolioPanel({ portfolio, safety }: { portfolio: PortfolioState; safety: SafetyState }) {
  const totalValue = portfolio.totalValue || safety.budget
  const invested = totalValue - (portfolio.cash || safety.budget)
  const pnl = totalValue - safety.budget
  const pnlPct = safety.budget > 0 ? pnl / safety.budget : 0
  const deployedPct = safety.budget > 0 ? invested / totalValue : 0

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2 }}>◆ PORTFOLIO</div>
        <span style={{
          marginLeft: 'auto', fontSize: 9, padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: 1,
          background: portfolio.mode === 'live' ? '#7f1d1d' : portfolio.mode === 'paper' ? '#1e3a5f' : '#1a2d1a',
          color: portfolio.mode === 'live' ? '#fca5a5' : portfolio.mode === 'paper' ? '#93c5fd' : '#86efac',
        }}>{portfolio.mode} mode</span>
      </div>

      {/* Key numbers */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: C.muted, fontSize: 10 }}>TOTAL VALUE</div>
        <div style={{ color: C.bright, fontSize: 24, fontWeight: 'bold', marginTop: 2, letterSpacing: -0.5 }}>{fmt$(totalValue)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ color: pnlColor(pnl), fontSize: 13, fontWeight: 'bold' }}>{pnl >= 0 ? '+' : ''}{fmt$(pnl)}</span>
          <span style={{ color: pnlColor(pnlPct), fontSize: 11 }}>({fmtPctSigned(pnlPct)})</span>
          <span style={{ color: C.dim, fontSize: 10 }}>vs ${safety.budget.toLocaleString()} budget</span>
        </div>
      </div>

      {/* Cash / Invested */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
        <div style={{ background: C.panel, borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: C.dim, fontSize: 9 }}>CASH AVAILABLE</div>
          <div style={{ color: '#93c5fd', fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{fmt$(portfolio.cash || safety.budget)}</div>
        </div>
        <div style={{ background: C.panel, borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ color: C.dim, fontSize: 9 }}>DEPLOYED</div>
          <div style={{ color: C.yellow, fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{fmtPct(deployedPct)}</div>
        </div>
      </div>

      {/* Positions */}
      <div>
        <div style={{ color: C.dim, fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>
          OPEN POSITIONS {portfolio.positions.length > 0 ? `(${portfolio.positions.length})` : ''}
        </div>
        {portfolio.positions.length === 0 ? (
          <div style={{ color: C.border, fontSize: 11, textAlign: 'center', padding: '10px 0' }}>No open positions</div>
        ) : portfolio.positions.map(p => {
          const entryReturn = p.avgCost > 0 ? (p.currentPrice - p.avgCost) / p.avgCost : 0
          return (
            <div key={p.symbol} style={{ background: C.panel, borderRadius: 6, padding: '8px 10px', marginBottom: 5, border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: C.bright, fontWeight: 'bold', fontSize: 12 }}>{p.symbol}</span>
                  <span style={{ color: C.muted, fontSize: 10 }}>{p.quantity} shares</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: pnlColor(p.unrealizedPAndL), fontSize: 12, fontWeight: 'bold' }}>
                    {p.unrealizedPAndL >= 0 ? '+' : ''}{fmt$(p.unrealizedPAndL)}
                  </span>
                  <span style={{ color: pnlColor(entryReturn), fontSize: 10 }}>
                    ({fmtPctSigned(entryReturn)})
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 10, color: C.muted }}>
                <span>entry {fmt$(p.avgCost)}</span>
                <span style={{ color: C.text }}>now {fmt$(p.currentPrice)}</span>
                <span style={{ marginLeft: 'auto', color: C.dim }}>value {fmt$(p.quantity * p.currentPrice)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Safety Panel ─────────────────────────────────────────────────────────────

function SafetyPanel({ safety, onToggleKill }: { safety: SafetyState; onToggleKill: () => void }) {
  const killActive = safety.killSwitchActive
  const lossBarPct = safety.dailyLossLimitPct > 0 ? Math.min(1, safety.dailyLossPct / safety.dailyLossLimitPct) : 0
  const lossColor = lossBarPct > 0.8 ? C.red : lossBarPct > 0.5 ? C.yellow : C.green

  return (
    <div style={{ background: C.card, border: `1px solid ${killActive ? C.red + '44' : C.border}`, borderRadius: 10, padding: 16, transition: 'all 0.3s' }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2, marginBottom: 12 }}>◆ SAFETY CONTROLS</div>

      {/* Kill switch */}
      <button
        onClick={onToggleKill}
        style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: killActive ? '#7f1d1d' : '#111827',
          color: killActive ? '#fca5a5' : C.muted,
          fontSize: 12, fontFamily: 'inherit', fontWeight: 'bold',
          boxShadow: killActive ? `0 0 18px ${C.red}44` : 'none',
          transition: 'all 0.2s', letterSpacing: 1,
          outline: `1px solid ${killActive ? C.red + '55' : C.dim}`,
        }}
      >
        {killActive ? '🔴 KILL SWITCH ON — CLICK TO RESUME' : '⬛ KILL SWITCH OFF'}
      </button>
      <div style={{ color: C.dim, fontSize: 9, textAlign: 'center', marginTop: 5, lineHeight: 1.5 }}>
        {killActive ? 'All trading halted. Kill switch triggered by daily loss limit or manual activation.' : 'Click to instantly halt all trading. Stop-loss sells still execute.'}
      </div>

      {/* Daily loss */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ color: C.muted, fontSize: 9 }}>TODAY'S LOSS</span>
          <span style={{ color: lossColor, fontSize: 9 }}>
            {fmtPct(safety.dailyLossPct)} used of {fmtPct(safety.dailyLossLimitPct)} limit
          </span>
        </div>
        <div style={{ background: C.border, borderRadius: 4, height: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 4, width: `${lossBarPct * 100}%`, background: lossColor, transition: 'width 0.5s', boxShadow: lossBarPct > 0.5 ? `0 0 6px ${lossColor}` : 'none' }} />
        </div>
        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>Kill switch auto-fires at {fmtPct(safety.dailyLossLimitPct)} daily loss</div>
      </div>

      {/* Limit summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 12 }}>
        {[
          { label: 'Max per position', value: fmtPct(safety.maxPositionPct), hint: 'of total portfolio' },
          { label: 'Stop loss per trade', value: fmtPct(safety.stopLossPct), hint: 'below entry price' },
        ].map(({ label, value, hint }) => (
          <div key={label} style={{ background: C.panel, borderRadius: 6, padding: '8px 10px', border: `1px solid ${C.border}` }}>
            <div style={{ color: C.dim, fontSize: 9 }}>{label}</div>
            <div style={{ color: C.green, fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>{value}</div>
            <div style={{ color: C.border, fontSize: 8, marginTop: 1 }}>{hint}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Benchmark Panel ──────────────────────────────────────────────────────────

function BenchmarkPanel({ data, onRefresh }: { data: BenchmarkData | null; onRefresh: () => void }) {
  if (!data) return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2 }}>◆ BENCHMARK COMPARISON</div>
      <div style={{ color: C.dim, fontSize: 11, marginTop: 12, textAlign: 'center' }}>Loading benchmarks...</div>
    </div>
  )

  const all = [
    { symbol: 'MERIDIAN', name: '▶ This Portfolio', ret: data.portfolio.returnSinceBaseline, today: null, isMe: true },
    ...data.benchmarks.map(b => ({ symbol: b.symbol, name: b.name, ret: b.returnSinceBaseline, today: b.changePct, isMe: false })),
  ]
  const maxAbs = Math.max(0.01, ...all.map(e => Math.abs(e.ret)))
  const ts = data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString('en-US', { hour12: false }) : '—'

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2 }}>◆ VS BENCHMARKS</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: C.dim, fontSize: 9 }}>updated {ts}</span>
          <button onClick={onRefresh} style={{ padding: '3px 8px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 9, fontFamily: 'inherit', cursor: 'pointer' }}>↻</button>
        </div>
      </div>
      <div style={{ color: C.dim, fontSize: 9, marginBottom: 10, lineHeight: 1.5 }}>
        % return from first snapshot · Goal: beat S&P 500 (+{(data.benchmarks.find(b => b.symbol === '^GSPC')?.returnSinceBaseline ?? 0 * 100).toFixed(1)}%)
      </div>
      {all.map(({ symbol, name, ret, today, isMe }) => {
        const barPct = (ret / maxAbs) * 50
        const color = ret >= 0 ? C.green : C.red
        return (
          <div key={symbol} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: isMe ? C.bright : C.text, fontSize: isMe ? 12 : 11, fontWeight: isMe ? 'bold' : 'normal' }}>{name}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {today !== null && (
                  <span style={{ color: today >= 0 ? C.green : C.red, fontSize: 9 }}>
                    {today >= 0 ? '+' : ''}{(today * 100).toFixed(2)}% today
                  </span>
                )}
                <span style={{ color, fontSize: 12, fontWeight: 'bold' }}>{fmtPctSigned(ret)}</span>
              </div>
            </div>
            <div style={{ background: C.border, borderRadius: 3, height: 5, position: 'relative' }}>
              <div style={{ position: 'absolute', left: ret >= 0 ? '50%' : `${50 + barPct}%`, width: `${Math.abs(barPct)}%`, height: '100%', background: color, borderRadius: 3, boxShadow: isMe ? `0 0 6px ${color}` : 'none', transition: 'width 0.5s' }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: C.dim }} />
            </div>
          </div>
        )
      })}
      <div style={{ marginTop: 8, padding: '6px 8px', background: C.panel, borderRadius: 5, fontSize: 9, color: C.dim, lineHeight: 1.6 }}>
        ⚠ Nifty 50 & Sensex are INR-denominated — Alpaca only trades US markets.
      </div>
    </div>
  )
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ items }: { items: FeedItem[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [items])

  return (
    <div ref={ref} style={{ height: 280, overflowY: 'auto', background: '#040810', border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
      {items.length === 0 ? (
        <div style={{ color: C.dim, fontSize: 11, paddingTop: 12, textAlign: 'center', lineHeight: 2 }}>
          Waiting for activity...<br />
          <span style={{ fontSize: 10, color: C.border }}>Agent events will appear here in real time.</span>
        </div>
      ) : items.map(item => (
        <div key={item.id} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: C.dim, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{item.ts}</span>
          {item.emoji && <span style={{ flexShrink: 0 }}>{item.emoji}</span>}
          <span style={{ color: item.color, wordBreak: 'break-word' }}>{item.msg}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Recent Trades ────────────────────────────────────────────────────────────

function RecentTradesPanel({ trades }: { trades: RecentTrade[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>
      <div style={{ color: C.muted, fontSize: 10, letterSpacing: 2, marginBottom: 10 }}>◆ RECENT TRADES</div>
      {trades.length === 0 ? (
        <div style={{ color: C.border, fontSize: 11, textAlign: 'center', padding: '12px 0' }}>No trades yet this session</div>
      ) : trades.slice(-8).reverse().map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${C.border}22`, fontSize: 11 }}>
          <span style={{ color: C.dim, fontSize: 9, flexShrink: 0 }}>{t.ts}</span>
          <span style={{
            fontSize: 10, fontWeight: 'bold', padding: '1px 6px', borderRadius: 3, flexShrink: 0,
            background: t.action === 'BUY' ? `${C.green}22` : `${C.red}22`,
            color: t.action === 'BUY' ? C.green : C.red,
          }}>{t.action}</span>
          <span style={{ color: C.bright, fontWeight: 'bold' }}>{t.symbol}</span>
          <span style={{ color: C.muted }}>{t.qty}×</span>
          <span style={{ color: C.text, marginLeft: 'auto' }}>{fmt$(t.price)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentState[]>(DEFAULT_AGENTS)
  const [meeting, setMeeting] = useState<Meeting>({ active: false, symbol: null, decision: null, reasoning: null, teamVotes: {} })
  const [portfolio, setPortfolio] = useState<PortfolioState>(DEFAULT_PORTFOLIO)
  const [safety, setSafety] = useState<SafetyState>(DEFAULT_SAFETY)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [benchmarks, setBenchmarks] = useState<BenchmarkData | null>(null)
  const [connected, setConnected] = useState(false)
  const [orchestratorRunning, setOrchestratorRunning] = useState(false)
  const [cycleInfo, setCycleInfo] = useState<CycleInfo | null>(null)
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([])
  const esRef = useRef<EventSource | null>(null)

  const addFeed = useCallback((agentId: string | undefined, msg: string, color: string) => {
    const meta = agentId ? AGENT_META[agentId] : undefined
    setFeed(f => [...f.slice(-299), { id: Math.random().toString(36).slice(2), ts: nowStr(), agentId, emoji: meta?.emoji, msg, color }])
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
      const r = await fetch('/api/benchmarks', { method: force ? 'POST' : 'GET' })
      const d = await r.json()
      setBenchmarks(d)
    } catch {}
  }, [])

  const fetchOrchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/agents')
      const d = await r.json()
      setOrchestratorRunning(d.orchestrator?.running ?? false)
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

        if (type === 'cycle_started') {
          setCycleInfo({ symbol: payload.symbol as string, watchlistIndex: payload.watchlistIndex as number, totalSymbols: payload.totalSymbols as number })
          // Clear team votes for new cycle
          setMeeting(m => ({ ...m, teamVotes: {}, symbol: payload.symbol as string, active: false }))
          addFeed(undefined, `─── New cycle: ${payload.symbol} ───`, C.dim)
        }

        if (type === 'agent_update') {
          const status = (payload.status as AgentStatus) ?? 'idle'
          const task = (payload.task as string) ?? ''
          const rec = payload.recommendation as string | undefined
          const conv = payload.conviction as number | undefined
          const sym = payload.symbol as string | undefined
          const veto = payload.veto as boolean | undefined

          if (agentId) {
            updateAgent(agentId, {
              status, task,
              ...(rec ? { lastRec: rec, lastSymbol: sym, lastConviction: conv, lastVeto: veto } : {}),
            })
            // Store team vote for conference room
            if (rec && agentId !== 'pm' && agentId !== 'trader') {
              setMeeting(m => ({
                ...m,
                teamVotes: { ...m.teamVotes, [agentId]: { agentId, recommendation: rec, conviction: conv ?? 5, veto } },
              }))
            }
          }
          if (task && task !== 'Standing by...' && !task.includes('Starting cycle')) {
            addFeed(agentId, task, STATUS_COLOR[status] ?? C.muted)
          }
        }

        if (type === 'meeting_started') {
          setMeeting(m => ({ ...m, active: true, symbol: payload.symbol as string }))
          addFeed('pm', `Meeting started — ${payload.symbol}`, C.blue)
        }

        if (type === 'decision_made') {
          const dec = payload.decision as string
          setMeeting(m => ({
            ...m, active: false, decision: dec,
            reasoning: payload.reasoning as string,
            confidence: payload.confidence as number,
            positionSizeUsd: payload.positionSizeUsd as number,
            targetPrice: payload.targetPrice as number,
            stopLoss: payload.stopLoss as number,
          }))
          updateAgent('pm', { status: dec === 'BUY' || dec === 'SELL' ? 'active' : 'idle', task: `Decision: ${dec} ${payload.symbol}`, lastRec: dec, lastSymbol: payload.symbol as string })
          addFeed('pm', `Decision: ${dec} on ${payload.symbol} (confidence ${payload.confidence ?? '?'}/10)`, recColor(dec))
        }

        if (type === 'trade_executed') {
          const action = payload.action as string
          const qty = payload.quantity as number
          const price = payload.price as number
          const sym = payload.symbol as string
          setRecentTrades(t => [...t, { id: Math.random().toString(36).slice(2), action, symbol: sym, qty, price, ts: nowStr() }])
          addFeed('trader', `${action} ${qty} × ${sym} @ ${fmt$(price)}`, action === 'BUY' ? C.green : C.red)
          fetchPortfolio()
        }

        if (type === 'safety_event') {
          const msg = (payload.message ?? payload.reason) as string
          addFeed(agentId ?? 'risk', `🛑 ${msg}`, C.red)
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
    const t4 = setInterval(fetchBenchmarks, 60000)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); clearInterval(t4) }
  }, [fetchPortfolio, fetchSafety, fetchOrchStatus, fetchBenchmarks])

  const toggleOrchestrator = async () => {
    const action = orchestratorRunning ? 'stop' : 'start'
    // No options passed on start — server uses TRADING_MODE env var and DEFAULT_OPTIONS.
    // Sending mode: 'simulation' here would override the user's .env.local setting.
    await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    setOrchestratorRunning(!orchestratorRunning)
    if (action === 'stop') setCycleInfo(null)
    addFeed(undefined, `Orchestrator ${action === 'start' ? 'started' : 'stopped'}`, action === 'start' ? C.green : C.muted)
  }

  const toggleKillSwitch = async () => {
    const action = safety.killSwitchActive ? 'deactivate' : 'activate'
    await fetch('/api/safety', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    setSafety(s => ({ ...s, killSwitchActive: !s.killSwitchActive }))
    addFeed(undefined, `Kill switch ${action}d`, action === 'activate' ? C.red : C.green)
  }

  const analyzeSymbol = async (sym: string) => {
    await fetch('/api/trading/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol: sym }) })
    addFeed(undefined, `Manual analysis triggered: ${sym}`, C.blue)
  }

  const pmAgent = agents.find(a => a.id === 'pm') ?? DEFAULT_AGENTS.find(a => a.id === 'pm')!
  const floorAgents = FLOOR_AGENTS.map(id => agents.find(a => a.id === id)!)
  const activeStepIndex = PIPELINE_ORDER.findIndex(id => agents.find(a => a.id === id)?.status === 'thinking')

  return (
    <>
      <style>{`
        * { box-sizing: border-box }
        body { background: ${C.bg}; margin: 0; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }
        ::-webkit-scrollbar { width: 5px }
        ::-webkit-scrollbar-track { background: #040810 }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px }
        button:hover { filter: brightness(1.2) }
      `}</style>

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '0 16px 32px' }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0 12px', borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
          <div>
            <div style={{ color: C.green, fontSize: 18, fontWeight: 'bold', letterSpacing: 3 }}>◆ MERIDIAN CAPITAL</div>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginTop: 1 }}>AUTONOMOUS AI HEDGE FUND</div>
          </div>

          {/* Orchestrator status pill */}
          {orchestratorRunning && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 12px', background: '#052e16', border: `1px solid ${C.green}33`, borderRadius: 20 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, animation: 'pulse 1.2s infinite' }} />
              <span style={{ color: C.green, fontSize: 10 }}>
                {cycleInfo ? `Analyzing ${cycleInfo.symbol} · ${cycleInfo.watchlistIndex + 1}/${cycleInfo.totalSymbols}` : 'Running'}
                {activeStepIndex >= 0 && ` · Step ${activeStepIndex + 1}/6: ${AGENT_META[PIPELINE_ORDER[activeStepIndex]]?.name}`}
              </span>
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Connection */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', background: C.panel, borderRadius: 10, border: `1px solid ${C.border}` }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? C.green : C.red, boxShadow: connected ? `0 0 5px ${C.green}` : 'none' }} />
              <span style={{ color: C.muted, fontSize: 9 }}>{connected ? 'LIVE STREAM' : 'RECONNECTING'}</span>
            </div>

            {/* Quick analyze */}
            <div style={{ display: 'flex', gap: 4 }}>
              {['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'].map(sym => (
                <button key={sym} onClick={() => analyzeSymbol(sym)} title={`Manually trigger analysis of ${sym}`} style={{ padding: '4px 8px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, fontSize: 9, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {sym}
                </button>
              ))}
            </div>

            {/* Start / Stop */}
            <button onClick={toggleOrchestrator} style={{
              padding: '7px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold', fontSize: 11, letterSpacing: 1,
              background: orchestratorRunning ? '#422006' : '#052e16',
              color: orchestratorRunning ? '#fbbf24' : C.green,
              outline: `1px solid ${orchestratorRunning ? '#78350f' : '#14532d'}`,
            }}>
              {orchestratorRunning ? '⏹ STOP' : '▶ START'}
            </button>
          </div>
        </div>

        {/* ── Pipeline Flow (only when running) ───────────────────────────── */}
        {orchestratorRunning && <PipelineFlow agents={agents} cycleInfo={cycleInfo} />}

        {/* ── Status banner ────────────────────────────────────────────────── */}
        {!orchestratorRunning && (
          <div style={{ background: '#0a0f18', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.yellow, animation: 'pulse 1.2s infinite', flexShrink: 0 }} />
            <div style={{ fontSize: 11, color: C.text, lineHeight: 1.7 }}>
              <strong style={{ color: C.bright }}>Initialising…</strong>{' '}
              The orchestrator starts automatically — no action needed. 6 AI agents will loop through 32 stocks every 15 minutes, research each one, and execute trades when conditions are met.
              If it doesn't start within 10 seconds, check that your <code style={{ color: C.yellow, fontSize: 10 }}>GROQ_API_KEY</code> is set in Secrets.
              The <strong style={{ color: C.green }}>▶ START</strong> button lets you manually restart if you stopped it.
            </div>
          </div>
        )}

        {/* ── Pixel art office simulation ──────────────────────────────────── */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>
            ◆ TRADING FLOOR — LIVE SIMULATION
            <span style={{ color: C.border, marginLeft: 12 }}>
              Alex · Sam · Jordan · Drew · Riley walk to conference room when meeting starts · Morgan stays at his desk
            </span>
          </div>
          <OfficeSimulation
            agents={agents.map(a => ({ id: a.id, status: a.status, task: a.task, lastRec: a.lastRec }))}
            meeting={{ active: meeting.active, symbol: meeting.symbol, decision: meeting.decision }}
            orchestratorRunning={orchestratorRunning}
          />
        </div>

        {/* ── Main 3-column data grid ──────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px 280px', gap: 12, marginBottom: 12 }}>

          {/* Left: Agent status cards */}
          <div>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>◆ AGENT STATUS</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {floorAgents.map(a => <AgentDesk key={a.id} agent={a} />)}
            </div>
          </div>

          {/* Middle: Conference Room */}
          <div>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>◆ C-SUITE — MORGAN'S DECISION</div>
            <ConferenceRoom pm={pmAgent} meeting={meeting} />
          </div>

          {/* Right: Portfolio */}
          <div>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>◆ PORTFOLIO</div>
            <PortfolioPanel portfolio={portfolio} safety={safety} />
          </div>
        </div>

        {/* ── Bottom row ───────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 300px', gap: 12 }}>

          {/* Activity feed */}
          <div>
            <div style={{ color: C.dim, fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>◆ LIVE ACTIVITY FEED</div>
            <ActivityFeed items={feed} />
          </div>

          {/* Benchmarks */}
          <BenchmarkPanel data={benchmarks} onRefresh={() => fetchBenchmarks(true)} />

          {/* Safety + Recent trades stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SafetyPanel safety={safety} onToggleKill={toggleKillSwitch} />
            <RecentTradesPanel trades={recentTrades} />
          </div>
        </div>

      </div>
    </>
  )
}
