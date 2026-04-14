import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAlpacaClient,
  submitOrder,
  getPositions,
  getAccountCash,
  cancelAllOrders,
} from '@/lib/alpaca'

vi.mock('@alpacahq/alpaca-trade-api', () => {
  class MockAlpaca {
    createOrder = vi.fn().mockResolvedValue({
      id: 'order-abc-123',
      symbol: 'NVDA',
      qty: '10',
      side: 'buy',
      type: 'market',
      status: 'pending_new',
    })

    getPositions = vi.fn().mockResolvedValue([
      {
        symbol: 'AAPL',
        qty: '5',
        avg_entry_price: '189.20',
        current_price: '195.00',
        unrealized_pl: '29.00',
      },
    ])

    getAccount = vi.fn().mockResolvedValue({
      cash: '22000.50',
      portfolio_value: '25500.00',
    })

    cancelAllOrders = vi.fn().mockResolvedValue([])
  }

  return { default: MockAlpaca }
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ALPACA_PAPER_KEY = 'test-key'
  process.env.ALPACA_PAPER_SECRET = 'test-secret'
  process.env.ALPACA_LIVE_KEY = 'live-key'
  process.env.ALPACA_LIVE_SECRET = 'live-secret'
})

describe('createAlpacaClient', () => {
  it('creates a paper client', () => {
    const client = createAlpacaClient('paper')
    expect(client).toBeDefined()
  })

  it('creates a live client', () => {
    const client = createAlpacaClient('live')
    expect(client).toBeDefined()
  })
})

describe('submitOrder', () => {
  it('submits a market buy order', async () => {
    const client = createAlpacaClient('paper')
    const order = await submitOrder(client, 'NVDA', 10, 'buy', 'market')
    expect(order.alpacaOrderId).toBe('order-abc-123')
    expect(order.symbol).toBe('NVDA')
    expect(order.status).toBe('PENDING')
  })
})

describe('getPositions', () => {
  it('returns mapped positions', async () => {
    const client = createAlpacaClient('paper')
    const positions = await getPositions(client, 'paper')
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('AAPL')
    expect(positions[0].quantity).toBe(5)
    expect(positions[0].unrealizedPAndL).toBe(29.00)
  })
})

describe('getAccountCash', () => {
  it('returns cash balance', async () => {
    const client = createAlpacaClient('paper')
    const cash = await getAccountCash(client)
    expect(cash).toBe(22000.50)
  })
})

describe('cancelAllOrders', () => {
  it('cancels without throwing', async () => {
    const client = createAlpacaClient('paper')
    await expect(cancelAllOrders(client)).resolves.not.toThrow()
  })
})
