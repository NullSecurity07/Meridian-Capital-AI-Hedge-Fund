import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generatePMDecision } from '@/lib/agents/pm'
import type { AgentReport, SafetyConfig } from '@/types'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      decision: 'BUY',
      reasoning: 'Team is 3/4 aligned on a BUY. Risk concerns noted but manageable.',
      position_size_usd: 1500,
      entry_price_max: 130,
      target_price: 150,
      stop_loss: 117.21,
      confidence: 7,
      team_alignment: 'aligned',
      overriding_factor: 'researcher',
    }),
    usage: { inputTokens: 300, outputTokens: 120 },
  }),
}))

const config: SafetyConfig = { maxPositionPct: 0.15, dailyLossLimitPct: 0.05, stopLossPct: 0.08, budget: 10000 }

const makeReport = (agentId: AgentReport['agentId'], recommendation: AgentReport['recommendation'], veto = false): AgentReport => ({
  id: `${agentId}-1`,
  agentId,
  symbol: 'NVDA',
  reportType: agentId === 'pm' ? 'pm_decision' : agentId as AgentReport['reportType'],
  content: { recommendation, veto },
  conviction: 7,
  recommendation,
  createdAt: Date.now(),
})

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generatePMDecision', () => {
  it('returns BUY when team is aligned', async () => {
    const reports = [
      makeReport('researcher', 'BUY'),
      makeReport('quant', 'BUY'),
      makeReport('risk', 'BUY'),
      makeReport('macro', 'BUY'),
    ]
    const decision = await generatePMDecision('NVDA', reports, 127.40, db, config)
    expect(decision.agentId).toBe('pm')
    expect(decision.reportType).toBe('pm_decision')
    expect(decision.recommendation).toBe('BUY')
    expect((decision.content as Record<string, unknown>).position_size_usd).toBe(1500)
  })

  it('forces PASS when risk agent vetoes', async () => {
    const reports = [
      makeReport('researcher', 'BUY'),
      makeReport('quant', 'BUY'),
      makeReport('risk', 'PASS', true), // veto: true
      makeReport('macro', 'BUY'),
    ]
    const decision = await generatePMDecision('NVDA', reports, 127.40, db, config)
    expect(decision.recommendation).toBe('PASS')
    expect((decision.content as Record<string, unknown>).position_size_usd).toBe(0)
    expect(String((decision.content as Record<string, unknown>).reasoning)).toContain('veto')
  })
})
