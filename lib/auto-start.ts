// lib/auto-start.ts
// Called once on server boot via instrumentation.ts.
// Starts the orchestrator automatically and keeps it alive with a watchdog.

import { getDb } from '@/lib/db-singleton'
import { startOrchestrator, isOrchestratorRunning } from '@/lib/agents/orchestrator'
import { DEFAULT_OPTIONS } from '@/lib/orchestrator-singleton'
import { upsertPortfolio, getPortfolio } from '@/lib/db'
import type { TradingMode } from '@/types'

const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes

export function autoStart(): void {
  const mode = (process.env.TRADING_MODE ?? 'paper') as TradingMode
  const config = { ...DEFAULT_OPTIONS, mode }

  try {
    const db = getDb()

    // ── Seed portfolio on first run ─────────────────────────────────────────
    // Without this, the dashboard shows $0 until a trade happens.
    const existing = getPortfolio(db, mode)
    if (!existing) {
      const budget = DEFAULT_OPTIONS.safetyConfig.budget
      upsertPortfolio(db, {
        mode,
        budget,
        cash: budget,
        totalValue: budget,
        updatedAt: Date.now(),
      })
      console.info(`[AutoStart] Portfolio initialised — ${mode} mode, $${budget.toLocaleString()} budget`)
    }

    // ── Start orchestrator ──────────────────────────────────────────────────
    if (!isOrchestratorRunning()) {
      startOrchestrator(db, config)
      console.info(
        `[AutoStart] Orchestrator running — mode: ${mode}, ` +
        `${config.watchlist.length} symbols, ` +
        `interval: ${config.intervalMs / 60_000}min`
      )
    }

    // ── Watchdog ────────────────────────────────────────────────────────────
    // If the orchestrator somehow stops (unhandled rejection, etc.) this
    // restarts it automatically without any user interaction.
    setInterval(() => {
      if (!isOrchestratorRunning()) {
        console.warn('[Watchdog] Orchestrator not running — restarting automatically')
        try {
          startOrchestrator(getDb(), config)
          console.info('[Watchdog] Orchestrator restarted')
        } catch (err) {
          console.error('[Watchdog] Failed to restart orchestrator:', err)
        }
      }
    }, WATCHDOG_INTERVAL_MS)

  } catch (err) {
    console.error('[AutoStart] Failed to start orchestrator:', err)
    // Retry after 30 seconds in case DB isn't ready yet
    setTimeout(() => autoStart(), 30_000)
  }
}
