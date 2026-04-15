import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateMacroReport } from '@/lib/agents/macro'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      macro_environment: 'risk-on',
      sector_outlook: 'positive',
      key_macro_factors: ['Fed pause', 'AI spending boom', 'Strong earnings season'],
      rate_sensitivity: 'medium',
      market_cycle: 'mid-bull',
      timing_assessment: 'good-entry',
      conviction: 7,
      recommendation: 'BUY',
      notes: 'Macro tailwinds support risk assets. AI sector benefiting from rate stability.',
    }),
    usage: { inputTokens: 160, outputTokens: 85 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getNewsHeadlines: vi.fn().mockResolvedValue([
    { title: 'Fed holds rates steady', summary: 'Pause continues', url: 'https://example.com', publishedAt: Date.now(), sentiment: 'positive' },
  ]),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generateMacroReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateMacroReport('NVDA', db)
    expect(report.agentId).toBe('macro')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('macro')
    expect(report.conviction).toBe(7)
    expect(report.recommendation).toBe('BUY')
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateMacroReport('NVDA', db)
    expect(report.agentId).toBe('macro')
    expect(report.content).toBeDefined()
  })
})
