import yahooFinance from 'yahoo-finance2'
import type { Quote, OHLCVBar, NewsItem } from '@/types'

export async function getQuote(symbol: string): Promise<Quote> {
  const raw = await yahooFinance.quote(symbol)
  return {
    symbol: raw.symbol,
    price: raw.regularMarketPrice ?? 0,
    change: raw.regularMarketChange ?? 0,
    changePct: raw.regularMarketChangePercent ?? 0,
    volume: raw.regularMarketVolume ?? 0,
    marketCap: raw.marketCap,
    pe: raw.trailingPE,
    timestamp: Date.now(),
  }
}

export async function getHistoricalBars(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const raw = await yahooFinance.historical(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
  })
  return raw
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(bar => ({
      date: new Date(bar.date).toISOString().split('T')[0],
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }))
}

export async function getNewsHeadlines(symbol: string): Promise<NewsItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_KEY
  if (!apiKey) return []
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=10&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json() as { feed?: Record<string, string>[] }
  if (!data.feed) return []
  return data.feed.map(item => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: parseAlphaVantageDate(item.time_published),
    sentiment: mapSentiment(item.overall_sentiment_label),
  }))
}

function parseAlphaVantageDate(str: string): number {
  // Format: "20260414T093000"
  const iso = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T${str.slice(9, 11)}:${str.slice(11, 13)}:${str.slice(13, 15)}Z`
  return new Date(iso).getTime()
}

function mapSentiment(label: string): NewsItem['sentiment'] {
  const l = label?.toLowerCase() ?? ''
  if (l.includes('bull') || l.includes('positive')) return 'positive'
  if (l.includes('bear') || l.includes('negative')) return 'negative'
  return 'neutral'
}
