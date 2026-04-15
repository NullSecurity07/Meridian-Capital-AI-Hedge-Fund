// tests/agents/trader.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, insertTrade, getAgentMemoryLessons, upsertPortfolio, upsertPosition } from '@/lib/db'
import { executeApprovedTrade } from '@/lib/agents/trader'
import type { AgentReport, SafetyConfig } from '@/types'

vi.mock('@/lib/alpaca', () => ({
  createAlpacaClient: vi.fn(),
  submitOrder: vi.fn().mockResolvedValue({ alpacaOrderId: 'alp-123' }),
}))

vi.mock('@/lib/sse', () => ({ broadcast: vi.fn() }))

const safetyConfig: SafetyConfig = {
  maxPositionPct: 0.5,
  dailyLossLimitPct: 0.05,
  stopLossPct: 0.08,
  budget: 10000,
}

function makePmDecision(symbol: string, decision: string, positionSizeUsd = 1000): AgentReport {
  return {
    id: 'pm-1',
    agentId: 'pm',
    symbol,
    reportType: 'pm_decision',
    content: { decision, position_size_usd: positionSizeUsd, reasoning: 'test' },
    recommendation: decision as AgentReport['recommendation'],
    createdAt: Date.now(),
  }
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
  upsertPortfolio(db, { mode: 'simulation', budget: 10000, cash: 10000, totalValue: 10000, updatedAt: Date.now() })
})

describe('executeApprovedTrade — simulation BUY', () => {
  it('places a trade and creates a position', async () => {
    const result = await executeApprovedTrade(makePmDecision('AAPL', 'BUY'), 150, 'simulation', db, safetyConfig)
    expect(result.success).toBe(true)
    expect(result.tradeId).toBeDefined()
  })

  it('rejects PASS decisions', async () => {
    const result = await executeApprovedTrade(makePmDecision('AAPL', 'PASS'), 150, 'simulation', db, safetyConfig)
    expect(result.success).toBe(false)
    expect(result.reason).toMatch(/PASS/)
  })
})

describe('executeApprovedTrade — minimum hold time', () => {
  it('blocks a SELL within 24 hours of the last BUY', async () => {
    // First BUY
    await executeApprovedTrade(makePmDecision('AAPL', 'BUY'), 150, 'simulation', db, safetyConfig)
    // Immediate SELL attempt (< 24h elapsed)
    const result = await executeApprovedTrade(makePmDecision('AAPL', 'SELL'), 155, 'simulation', db, safetyConfig)
    expect(result.success).toBe(false)
    expect(result.reason).toMatch(/Minimum hold not met/)
  })

  it('allows a forced SELL (stop-loss) even within 24 hours', async () => {
    await executeApprovedTrade(makePmDecision('AAPL', 'BUY'), 150, 'simulation', db, safetyConfig)
    // force = true bypasses minimum hold
    const result = await executeApprovedTrade(makePmDecision('AAPL', 'SELL'), 138, 'simulation', db, safetyConfig, true)
    expect(result.success).toBe(true)
  })

  it('allows a SELL after 24 hours have elapsed', async () => {
    // Insert a BUY trade with a timestamp 25 hours ago
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000
    insertTrade(db, {
      id: 'old-buy',
      symbol: 'MSFT',
      action: 'BUY',
      quantity: 5,
      price: 400,
      total: 2000,
      status: 'FILLED',
      mode: 'simulation',
      createdAt: oldTimestamp,
    })
    upsertPosition(db, {
      id: 'simulation-MSFT',
      symbol: 'MSFT',
      quantity: 5,
      avgCost: 400,
      currentPrice: 420,
      unrealizedPAndL: 100,
      mode: 'simulation',
      updatedAt: oldTimestamp,
    })

    const result = await executeApprovedTrade(makePmDecision('MSFT', 'SELL'), 420, 'simulation', db, safetyConfig)
    expect(result.success).toBe(true)
  })
})

describe('executeApprovedTrade — self-learning memory', () => {
  it('writes a winning lesson to agent_memory after a profitable SELL', async () => {
    // Set up a position bought 25h ago at $400
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000
    insertTrade(db, {
      id: 'old-buy-2',
      symbol: 'NVDA',
      action: 'BUY',
      quantity: 4,
      price: 400,
      total: 1600,
      status: 'FILLED',
      mode: 'simulation',
      createdAt: oldTimestamp,
    })
    upsertPosition(db, {
      id: 'simulation-NVDA',
      symbol: 'NVDA',
      quantity: 4,
      avgCost: 400,
      currentPrice: 450,
      unrealizedPAndL: 200,
      mode: 'simulation',
      updatedAt: oldTimestamp,
    })

    await executeApprovedTrade(makePmDecision('NVDA', 'SELL'), 450, 'simulation', db, safetyConfig)

    const researcherLessons = getAgentMemoryLessons(db, 'researcher', 5)
    const pmLessons = getAgentMemoryLessons(db, 'pm', 5)

    expect(researcherLessons.length).toBeGreaterThan(0)
    expect(researcherLessons[0]).toMatch(/gained/)
    expect(pmLessons.length).toBeGreaterThan(0)
  })

  it('writes a losing lesson after an unprofitable SELL', async () => {
    const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000
    insertTrade(db, {
      id: 'old-buy-3',
      symbol: 'AMZN',
      action: 'BUY',
      quantity: 3,
      price: 200,
      total: 600,
      status: 'FILLED',
      mode: 'simulation',
      createdAt: oldTimestamp,
    })
    upsertPosition(db, {
      id: 'simulation-AMZN',
      symbol: 'AMZN',
      quantity: 3,
      avgCost: 200,
      currentPrice: 180,
      unrealizedPAndL: -60,
      mode: 'simulation',
      updatedAt: oldTimestamp,
    })

    await executeApprovedTrade(makePmDecision('AMZN', 'SELL'), 180, 'simulation', db, safetyConfig)

    const lessons = getAgentMemoryLessons(db, 'researcher', 5)
    expect(lessons[0]).toMatch(/lost/)
  })
})
