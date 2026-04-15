// lib/benchmarks.ts
// Tracks major indices alongside the portfolio for performance comparison.
// All comparisons are % return from first snapshot — the only fair comparison.
import { upsertBenchmark, getBenchmarks, type BenchmarkRow } from '@/lib/db'
import type Database from 'better-sqlite3'

// Yahoo Finance tickers for indices
// Note: Nifty/Sensex are INR-denominated; S&P 500/NASDAQ are USD.
// Returns (%) are still directly comparable regardless of currency.
export const BENCHMARKS: { symbol: string; name: string }[] = [
  { symbol: '^GSPC',  name: 'S&P 500'        },
  { symbol: '^IXIC',  name: 'NASDAQ'          },
  { symbol: '^NSEI',  name: 'Nifty 50'        },
  { symbol: '^BSESN', name: 'BSE Sensex'      },
]

export async function refreshBenchmarks(db: Database.Database): Promise<BenchmarkRow[]> {
  // Lazy import to avoid loading yahoo-finance2 at module evaluation time
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const YahooFinance = require('yahoo-finance2').default
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

  const results: BenchmarkRow[] = []

  for (const { symbol, name } of BENCHMARKS) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (yf as any).quote(symbol) as any
      const price: number = raw?.regularMarketPrice ?? 0
      const changePct: number = (raw?.regularMarketChangePercent ?? 0) / 100

      if (price === 0) continue

      // On first insert, baseline = current price
      // upsertBenchmark preserves baseline_price on subsequent updates
      const row: BenchmarkRow = {
        symbol,
        name,
        currentPrice: price,
        baselinePrice: price, // only used on INSERT; ON CONFLICT preserves existing
        changePct,
        returnSinceBaseline: 0, // computed by SQL on UPDATE
        updatedAt: Date.now(),
      }
      upsertBenchmark(db, row)
      results.push(row)
    } catch (err) {
      console.warn(`[Benchmarks] Could not fetch ${symbol}:`, err)
    }
  }

  // Return fresh data from DB (includes correct returnSinceBaseline from SQL)
  return getBenchmarks(db)
}
