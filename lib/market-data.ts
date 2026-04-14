import yahooFinance from 'yahoo-finance2'
import type { Quote, OHLCVBar, NewsItem } from '@/types'

export async function getQuote(symbol: string): Promise<Quote> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await yahooFinance.quote(symbol) as any
  return {
    symbol: raw.symbol as string,
    price: (raw.regularMarketPrice as number | undefined) ?? 0,
    change: (raw.regularMarketChange as number | undefined) ?? 0,
    changePct: (raw.regularMarketChangePercent as number | undefined) ?? 0,
    volume: (raw.regularMarketVolume as number | undefined) ?? 0,
    marketCap: raw.marketCap as number | undefined,
    pe: raw.trailingPE as number | undefined,
    timestamp: Date.now(),
  }
}

export async function getHistoricalBars(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await yahooFinance.historical(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
  }) as any[]
  return raw
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((bar: any) => ({
      date: new Date(bar.date).toISOString().split('T')[0],
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }))
}

interface AlphaVantageNewsItem {
  title: string
  summary: string
  url: string
  time_published: string
  overall_sentiment_label: string
}

export async function getNewsHeadlines(symbol: string): Promise<NewsItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_KEY
  if (!apiKey) return []
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=10&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Alpha Vantage request failed: HTTP ${res.status}`)
  const data = await res.json() as { feed?: AlphaVantageNewsItem[] }
  if (!data.feed) return []
  return data.feed.map((item: AlphaVantageNewsItem) => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: parseAlphaVantageDate(item.time_published),
    sentiment: mapSentiment(item.overall_sentiment_label),
  }))
}

function parseAlphaVantageDate(str: string): number {
  // Input format: "20260414T093000" → "2026-04-14T09:30:00Z"
  const s = str.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z')
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) throw new Error(`Unparseable Alpha Vantage date: ${str}`)
  return ms
}

function mapSentiment(label: string): NewsItem['sentiment'] {
  const l = label?.toLowerCase() ?? ''
  if (l.includes('bull') || l.includes('positive')) return 'positive'
  if (l.includes('bear') || l.includes('negative')) return 'negative'
  return 'neutral'
}
