import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateQuantReport, calculateRSI } from '@/lib/agents/quant'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      rsi: 42.5,
      trend: 'uptrend',
      signal: 'BUY',
      support: 120.00,
      resistance: 135.00,
      volatility: 'medium',
      upside_probability: 0.65,
      expected_move_pct: 12,
      time_horizon_days: 45,
      conviction: 7,
      recommendation: 'BUY',
      notes: 'RSI is recovering from oversold territory with strong volume.',
    }),
    usage: { inputTokens: 150, outputTokens: 80 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getHistoricalBars: vi.fn().mockResolvedValue(
    Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (30 - i) * 86400000).toISOString().split('T')[0],
      open: 120 + i * 0.5,
      high: 122 + i * 0.5,
      low: 118 + i * 0.5,
      close: 121 + i * 0.5,
      volume: 40000000,
    }))
  ),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('calculateRSI', () => {
  it('returns 50 when insufficient data', () => {
    expect(calculateRSI([100, 101, 102], 14)).toBe(50)
  })

  it('returns 100 when all gains (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    expect(calculateRSI(closes)).toBe(100)
  })

  it('returns a number between 0 and 100', () => {
    const closes = [100, 98, 102, 99, 105, 103, 101, 108, 106, 110, 108, 112, 110, 115, 113]
    const rsi = calculateRSI(closes)
    expect(rsi).toBeGreaterThanOrEqual(0)
    expect(rsi).toBeLessThanOrEqual(100)
  })
})

describe('generateQuantReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateQuantReport('NVDA', db)
    expect(report.agentId).toBe('quant')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('quant')
    expect(report.conviction).toBe(7)
    expect(report.recommendation).toBe('BUY')
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateQuantReport('NVDA', db)
    expect(report.agentId).toBe('quant')
    expect(report.content).toBeDefined()
  })
})
