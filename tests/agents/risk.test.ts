import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, upsertPortfolio } from '@/lib/db'
import { generateRiskReport } from '@/lib/agents/risk'
import type { SafetyConfig } from '@/types'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      risk_level: 'medium',
      max_position_pct: 0.08,
      suggested_position_size_usd: 800,
      stop_loss_price: 117.21,
      max_drawdown_scenario: '18% drawdown in severe bear market',
      key_risks: ['High valuation', 'Macro headwinds', 'Regulatory risk'],
      conviction: 6,
      recommendation: 'BUY',
      veto: false,
    }),
    usage: { inputTokens: 180, outputTokens: 90 },
  }),
}))

const config: SafetyConfig = {
  maxPositionPct: 0.15,
  dailyLossLimitPct: 0.05,
  stopLossPct: 0.08,
  budget: 10000,
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
  upsertPortfolio(db, { mode: 'paper', budget: 10000, cash: 9000, totalValue: 10200, updatedAt: Date.now() })
})

describe('generateRiskReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateRiskReport('NVDA', 1000, 127.40, db, config)
    expect(report.agentId).toBe('risk')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('risk')
    expect(report.conviction).toBe(6)
    expect(report.recommendation).toBe('BUY')
    expect((report.content as Record<string, unknown>).veto).toBe(false)
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateRiskReport('NVDA', 1000, 127.40, db, config)
    expect(report.agentId).toBe('risk')
    expect((report.content as Record<string, unknown>).veto).toBe(false)
  })
})
