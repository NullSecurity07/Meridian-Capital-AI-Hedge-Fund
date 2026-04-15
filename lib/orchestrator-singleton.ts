// lib/orchestrator-singleton.ts
// Singleton state so API routes can check/control the orchestrator
import type { SafetyConfig, TradingMode } from '@/types'

export interface OrchestratorOptions {
  watchlist: string[]
  mode: TradingMode
  safetyConfig: SafetyConfig
  intervalMs: number
}

export const DEFAULT_OPTIONS: OrchestratorOptions = {
  watchlist: ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'AMZN'],
  mode: 'paper',
  safetyConfig: {
    maxPositionPct: 0.15,
    dailyLossLimitPct: 0.05,
    stopLossPct: 0.08,
    budget: 10000,
  },
  intervalMs: 5 * 60 * 1000,
}

let _options: OrchestratorOptions = { ...DEFAULT_OPTIONS }

export function getOrchestratorOptions(): OrchestratorOptions {
  return _options
}

export function setOrchestratorOptions(opts: Partial<OrchestratorOptions>): void {
  _options = { ..._options, ...opts }
}
