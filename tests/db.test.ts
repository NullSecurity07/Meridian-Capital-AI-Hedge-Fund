import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  initDb,
  insertTrade,
  getTradeById,
  updateTradeClose,
  insertAgentReport,
  getLatestReportsBySymbol,
  insertAgentMemory,
  getAgentMemoryLessons,
  updateAgentAccuracy,
  getAgent,
  upsertPortfolio,
  getPortfolio,
  upsertPosition,
  getPositions,
  logSafetyEvent,
} from '@/lib/db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

afterEach(() => {
  db.close()
})

describe('trades', () => {
  it('inserts and retrieves a trade', () => {
    const trade = {
      id: 'trade-1',
      symbol: 'NVDA',
      action: 'BUY' as const,
      quantity: 10,
      price: 127.40,
      total: 1274.00,
      status: 'PENDING' as const,
      mode: 'paper' as const,
      createdAt: Date.now(),
    }
    insertTrade(db, trade)
    const result = getTradeById(db, 'trade-1')
    expect(result?.symbol).toBe('NVDA')
    expect(result?.quantity).toBe(10)
    expect(result?.status).toBe('PENDING')
  })

  it('updates trade on close', () => {
    const trade = {
      id: 'trade-2',
      symbol: 'AAPL',
      action: 'BUY' as const,
      quantity: 5,
      price: 189.20,
      total: 946.00,
      status: 'FILLED' as const,
      mode: 'paper' as const,
      createdAt: Date.now(),
    }
    insertTrade(db, trade)
    const closedAt = Date.now()
    updateTradeClose(db, 'trade-2', { closedAt, closePrice: 200.00, pAndL: 54.00, status: 'FILLED' })
    const result = getTradeById(db, 'trade-2')
    expect(result?.closePrice).toBe(200.00)
    expect(result?.pAndL).toBe(54.00)
    expect(result?.closedAt).toBe(closedAt)
  })
})

describe('agent reports', () => {
  it('inserts and retrieves reports by symbol', () => {
    insertAgentReport(db, {
      id: 'report-1',
      agentId: 'researcher',
      symbol: 'NVDA',
      reportType: 'research',
      content: { summary: 'Strong AI demand' },
      conviction: 8,
      recommendation: 'BUY',
      createdAt: Date.now(),
    })
    const reports = getLatestReportsBySymbol(db, 'NVDA')
    expect(reports).toHaveLength(1)
    expect(reports[0].agentId).toBe('researcher')
    expect(reports[0].conviction).toBe(8)
  })
})

describe('agent memory', () => {
  it('stores and retrieves lessons', () => {
    insertAgentMemory(db, {
      id: 'mem-1',
      agentId: 'quant',
      tradeId: 'trade-1',
      symbol: 'NVDA',
      prediction: 'Price will rise 15% in 90 days',
      actualOutcome: 'Price rose 12% in 90 days',
      pAndL: 120.00,
      lesson: 'Monte Carlo was slightly optimistic; reduce upside target by 2-3% on high-vol stocks',
      createdAt: Date.now(),
    })
    const lessons = getAgentMemoryLessons(db, 'quant', 5)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toContain('Monte Carlo was slightly optimistic')
  })
})

describe('agent accuracy', () => {
  it('initializes and updates accuracy score', () => {
    updateAgentAccuracy(db, 'researcher', true)
    updateAgentAccuracy(db, 'researcher', false)
    updateAgentAccuracy(db, 'researcher', true)
    const agent = getAgent(db, 'researcher')
    expect(agent?.totalPredictions).toBe(3)
    expect(agent?.correctPredictions).toBe(2)
    expect(agent?.accuracyScore).toBeCloseTo(0.667, 2)
  })
})

describe('portfolio', () => {
  it('upserts and reads portfolio state', () => {
    upsertPortfolio(db, {
      mode: 'paper',
      budget: 25000,
      cash: 23000,
      totalValue: 25500,
      updatedAt: Date.now(),
    })
    const p = getPortfolio(db, 'paper')
    expect(p?.budget).toBe(25000)
    expect(p?.cash).toBe(23000)
  })
})

describe('positions', () => {
  it('upserts and reads positions', () => {
    upsertPosition(db, {
      id: 'pos-nvda',
      symbol: 'NVDA',
      quantity: 10,
      avgCost: 127.40,
      currentPrice: 130.00,
      unrealizedPAndL: 26.00,
      mode: 'paper',
      updatedAt: Date.now(),
    })
    const positions = getPositions(db, 'paper')
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('NVDA')
    expect(positions[0].unrealizedPAndL).toBe(26.00)
  })

  it('excludes zero-quantity positions', () => {
    upsertPosition(db, {
      id: 'pos-zero',
      symbol: 'META',
      quantity: 0,
      avgCost: 500.00,
      currentPrice: 510.00,
      unrealizedPAndL: 0,
      mode: 'paper',
      updatedAt: Date.now(),
    })
    const positions = getPositions(db, 'paper')
    expect(positions.find(p => p.symbol === 'META')).toBeUndefined()
  })
})

describe('safety events', () => {
  it('logs safety events', () => {
    logSafetyEvent(db, {
      id: 'ev-1',
      eventType: 'kill_switch',
      details: 'Manual kill switch activated',
      createdAt: Date.now(),
    })
    const row = db.prepare('SELECT * FROM safety_events WHERE id = ?').get('ev-1') as Record<string, unknown> | undefined
    expect(row).toBeDefined()
    expect(row?.event_type).toBe('kill_switch')
    expect(row?.details).toBe('Manual kill switch activated')
  })
})
