import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateResearchReport } from '@/lib/agents/researcher'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      summary: 'NVDA is a leading AI chip company with strong revenue growth.',
      thesis: 'AI demand drives sustained outperformance.',
      catalysts: ['Data center GPU demand', 'New Blackwell architecture'],
      risks: ['Valuation stretch', 'China export restrictions'],
      sentiment: 'positive',
      conviction: 8,
      recommendation: 'BUY',
      targetPrice: 150,
      timeHorizon: 'medium',
    }),
    usage: { inputTokens: 200, outputTokens: 100 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'NVDA', price: 127.40, change: 2.9, changePct: 2.33,
    volume: 45000000, marketCap: 3100000000000, pe: 34.2, timestamp: Date.now(),
  }),
  getNewsHeadlines: vi.fn().mockResolvedValue([
    { title: 'NVIDIA beats estimates', summary: 'Strong quarter', url: 'https://example.com', publishedAt: Date.now(), sentiment: 'positive' },
  ]),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generateResearchReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateResearchReport('NVDA', db)
    expect(report.agentId).toBe('researcher')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('research')
    expect(report.conviction).toBe(8)
    expect(report.recommendation).toBe('BUY')
    expect(report.id).toBeDefined()
    expect(report.createdAt).toBeGreaterThan(0)
  })

  it('handles malformed JSON from Claude gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON at all', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateResearchReport('NVDA', db)
    expect(report.agentId).toBe('researcher')
    expect(report.content).toBeDefined()
  })
})
