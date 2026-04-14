import { describe, it, expect, vi } from 'vitest'
import { getQuote, getHistoricalBars, getNewsHeadlines } from '@/lib/market-data'

vi.mock('yahoo-finance2', () => ({
  default: {
    quote: vi.fn().mockResolvedValue({
      symbol: 'NVDA',
      regularMarketPrice: 127.40,
      regularMarketChange: 2.90,
      regularMarketChangePercent: 2.33,
      regularMarketVolume: 45000000,
      marketCap: 3100000000000,
      trailingPE: 34.2,
    }),
    historical: vi.fn().mockResolvedValue([
      { date: new Date('2026-04-10'), open: 125, high: 129, low: 124, close: 127.40, volume: 45000000 },
      { date: new Date('2026-04-09'), open: 122, high: 126, low: 121, close: 125, volume: 42000000 },
    ]),
  },
}))

global.fetch = vi.fn().mockResolvedValue({
  json: vi.fn().mockResolvedValue({
    feed: [
      {
        title: 'NVIDIA crushes earnings expectations',
        summary: 'Revenue up 78% year over year driven by AI chip demand.',
        url: 'https://example.com/nvda',
        time_published: '20260414T093000',
        overall_sentiment_label: 'Bullish',
      },
    ],
  }),
}) as unknown as typeof fetch

describe('getQuote', () => {
  it('returns a mapped quote', async () => {
    const quote = await getQuote('NVDA')
    expect(quote.symbol).toBe('NVDA')
    expect(quote.price).toBe(127.40)
    expect(quote.changePct).toBeCloseTo(2.33, 1)
    expect(quote.pe).toBeCloseTo(34.2, 1)
  })
})

describe('getHistoricalBars', () => {
  it('returns OHLCV bars sorted oldest first', async () => {
    const bars = await getHistoricalBars('NVDA', '2026-04-09', '2026-04-10')
    expect(bars).toHaveLength(2)
    expect(bars[0].date).toBe('2026-04-09')
    expect(bars[1].close).toBe(127.40)
  })
})

describe('getNewsHeadlines', () => {
  it('returns mapped news items', async () => {
    process.env.ALPHA_VANTAGE_KEY = 'test'
    const news = await getNewsHeadlines('NVDA')
    expect(news).toHaveLength(1)
    expect(news[0].title).toContain('NVIDIA')
    expect(news[0].sentiment).toBe('positive')
  })
})
