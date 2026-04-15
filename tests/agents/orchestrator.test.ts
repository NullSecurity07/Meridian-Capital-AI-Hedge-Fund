import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { analyzeSymbol, isOrchestratorRunning, startOrchestrator, stopOrchestrator } from '@/lib/agents/orchestrator'
import type { SafetyConfig } from '@/types'

vi.mock('@/lib/agents/researcher', () => ({
  generateResearchReport: vi.fn().mockResolvedValue({
    id: 'r1', agentId: 'researcher', symbol: 'NVDA', reportType: 'research',
    content: { summary: 'Strong', conviction: 8 }, conviction: 8, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/quant', () => ({
  generateQuantReport: vi.fn().mockResolvedValue({
    id: 'q1', agentId: 'quant', symbol: 'NVDA', reportType: 'quant',
    content: { notes: 'Bullish RSI' }, conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/risk', () => ({
  generateRiskReport: vi.fn().mockResolvedValue({
    id: 'rk1', agentId: 'risk', symbol: 'NVDA', reportType: 'risk',
    content: { veto: false, key_risks: [] }, conviction: 6, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/macro', () => ({
  generateMacroReport: vi.fn().mockResolvedValue({
    id: 'm1', agentId: 'macro', symbol: 'NVDA', reportType: 'macro',
    content: { notes: 'Macro ok' }, conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/pm', () => ({
  generatePMDecision: vi.fn().mockResolvedValue({
    id: 'pm1', agentId: 'pm', symbol: 'NVDA', reportType: 'pm_decision',
    content: { decision: 'BUY', position_size_usd: 1000, reasoning: 'Team aligned' },
    conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/trader', () => ({
  executeApprovedTrade: vi.fn().mockResolvedValue({ success: true, tradeId: 'trade-123' }),
}))

vi.mock('@/lib/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'NVDA', price: 127.40, change: 2.9, changePct: 2.33,
    volume: 45000000, timestamp: Date.now(),
  }),
}))

const safetyConfig: SafetyConfig = { maxPositionPct: 0.15, dailyLossLimitPct: 0.05, stopLossPct: 0.08, budget: 10000 }

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
  vi.clearAllMocks()
  stopOrchestrator()
})

describe('analyzeSymbol', () => {
  it('runs full pipeline and returns 5 reports', async () => {
    const reports = await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    expect(reports).toHaveLength(5) // researcher, quant, macro, risk, pm
  })

  it('skips quant/risk/pm if research conviction is too low', async () => {
    const { generateResearchReport } = await import('@/lib/agents/researcher')
    vi.mocked(generateResearchReport).mockResolvedValueOnce({
      id: 'r1', agentId: 'researcher', symbol: 'NVDA', reportType: 'research',
      content: { summary: 'Weak' }, conviction: 3, recommendation: 'PASS', createdAt: Date.now(),
    })
    const reports = await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    expect(reports).toHaveLength(1) // only research
  })

  it('saves all reports to the database', async () => {
    await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    const { getLatestReportsBySymbol } = await import('@/lib/db')
    const saved = getLatestReportsBySymbol(db, 'NVDA')
    expect(saved.length).toBeGreaterThanOrEqual(4)
  })
})

describe('orchestrator lifecycle', () => {
  it('starts as not running', () => {
    expect(isOrchestratorRunning()).toBe(false)
  })

  it('starts and stops correctly', () => {
    startOrchestrator(db, { watchlist: ['NVDA'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    expect(isOrchestratorRunning()).toBe(true)
    stopOrchestrator()
    expect(isOrchestratorRunning()).toBe(false)
  })

  it('does not start twice', () => {
    startOrchestrator(db, { watchlist: ['NVDA'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    startOrchestrator(db, { watchlist: ['AAPL'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    expect(isOrchestratorRunning()).toBe(true)
    stopOrchestrator()
  })
})
