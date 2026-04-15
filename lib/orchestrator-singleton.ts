// lib/orchestrator-singleton.ts
// Singleton state so API routes can check/control the orchestrator
import type { SafetyConfig, TradingMode } from '@/types'

export interface OrchestratorOptions {
  watchlist: string[]
  mode: TradingMode
  safetyConfig: SafetyConfig
  intervalMs: number
}

// Diversified watchlist across S&P 500 sectors — necessary to generate alpha vs the index.
// Concentrated tech-only exposure merely tracks the index; sector rotation is the edge.
// SH (inverse S&P 500) and PSQ (inverse NASDAQ) give the PM a natural hedge when macro
// turns risk-off — no special logic required, they're analyzed like any other instrument.
export const DEFAULT_OPTIONS: OrchestratorOptions = {
  watchlist: [
    // Mega-cap tech (index heavyweights — still need these for baseline exposure)
    'NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA',
    // High-growth tech (higher beta, more alpha potential)
    'AMD', 'CRM', 'NFLX', 'ADBE', 'ORCL',
    // Financials (rate-sensitive, diversifies tech correlation)
    'JPM', 'GS', 'V', 'MA',
    // Healthcare (defensive, low correlation to tech)
    'LLY', 'UNH', 'JNJ', 'ABBV',
    // Energy (inflation hedge, geopolitical exposure)
    'XOM', 'CVX', 'COP',
    // Industrials / Defense (late-cycle outperformers)
    'CAT', 'HON', 'LMT',
    // Consumer staples (defensive, dividend yield)
    'WMT', 'COST', 'PG',
    // Inverse ETFs — PM buys these when macro is risk-off (acts as short hedge)
    'SH',   // ProShares Short S&P 500
    'PSQ',  // ProShares Short QQQ (NASDAQ)
  ],
  mode: 'paper',
  safetyConfig: {
    maxPositionPct: 0.15,
    dailyLossLimitPct: 0.05,
    stopLossPct: 0.08,
    budget: 10000,
  },
  // 15 min per symbol → 32 symbols × 15 min = ~8h to sweep the full watchlist.
  // Each sweep uses ~6 Groq calls/symbol = 192 calls/sweep → well within 14,400/day limit.
  intervalMs: 15 * 60 * 1000,
}

let _options: OrchestratorOptions = { ...DEFAULT_OPTIONS }

export function getOrchestratorOptions(): OrchestratorOptions {
  return _options
}

export function setOrchestratorOptions(opts: Partial<OrchestratorOptions>): void {
  _options = { ..._options, ...opts }
}
