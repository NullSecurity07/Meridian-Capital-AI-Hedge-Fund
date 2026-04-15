// lib/agents/orchestrator.ts
import { generateResearchReport } from './researcher'
import { generateQuantReport } from './quant'
import { generateRiskReport } from './risk'
import { generateMacroReport } from './macro'
import { generatePMDecision } from './pm'
import { executeApprovedTrade } from './trader'
import { insertAgentReport, getPortfolio, getPositions } from '@/lib/db'
import { broadcast } from '@/lib/sse'
import { isKillSwitchActive, checkDailyLossLimit, calculateStopLossPrice } from '@/lib/safety'
import { getQuote } from '@/lib/market-data'
import type { AgentReport, SafetyConfig, TradingMode } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

// ── Daily baseline — pinned to globalThis so HMR doesn't reset it ──────────
const g = globalThis as typeof globalThis & {
  _dailyBaseline?: number
  _dailyBaselineDate?: string
}

function getOrSetDailyBaseline(value: number): number {
  const today = new Date().toISOString().split('T')[0]
  if (g._dailyBaselineDate !== today || g._dailyBaseline === undefined) {
    g._dailyBaselineDate = today
    g._dailyBaseline = value
    console.info(`[Orchestrator] New trading day — baseline set to $${value.toFixed(2)}`)
  }
  return g._dailyBaseline
}

export function getDailyBaseline(): number | undefined { return g._dailyBaseline }

// ── Orchestrator state ─────────────────────────────────────────────────────
let isRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

export function isOrchestratorRunning(): boolean { return isRunning }

export interface OrchestratorConfig {
  watchlist: string[]
  mode: TradingMode
  safetyConfig: SafetyConfig
  intervalMs: number
}

// ── Stop loss enforcement ─────────────────────────────────────────────────
async function enforceStopLosses(
  db: Database.Database,
  mode: TradingMode,
  safetyConfig: SafetyConfig
): Promise<void> {
  const positions = getPositions(db, mode)
  if (positions.length === 0) return

  for (const pos of positions) {
    if (pos.quantity <= 0) continue
    const stopLossPrice = calculateStopLossPrice(pos.avgCost, safetyConfig)
    try {
      const quote = await getQuote(pos.symbol)
      // Update current price in position display
      if (quote.price <= stopLossPrice) {
        const msg = `STOP LOSS: ${pos.symbol} at $${quote.price.toFixed(2)} ≤ stop $${stopLossPrice.toFixed(2)} (entry $${pos.avgCost.toFixed(2)})`
        console.error(`[Safety] ${msg}`)
        broadcast({
          type: 'safety_event',
          agentId: 'trader',
          payload: { eventType: 'stop_loss_triggered', symbol: pos.symbol, currentPrice: quote.price, stopLossPrice, message: msg },
          timestamp: Date.now(),
        })
        // Emergency sell — force=true bypasses kill switch so we can exit the position
        const emergencySell: AgentReport = {
          id: randomUUID(),
          agentId: 'trader',
          symbol: pos.symbol,
          reportType: 'pm_decision',
          content: { decision: 'SELL', position_size_usd: pos.quantity * quote.price, reasoning: msg },
          recommendation: 'SELL',
          createdAt: Date.now(),
        }
        await executeApprovedTrade(emergencySell, quote.price, mode, db, safetyConfig, true)
      }
    } catch (err) {
      console.error(`[Orchestrator] Stop loss check failed for ${pos.symbol}:`, err)
    }
  }
}

// ── Start / Stop ───────────────────────────────────────────────────────────
export function startOrchestrator(db: Database.Database, config: OrchestratorConfig): void {
  if (isRunning) return
  isRunning = true

  let index = 0
  const runCycle = async () => {
    if (!isRunning) return

    // 1. Enforce stop losses on all open positions first
    await enforceStopLosses(db, config.mode, config.safetyConfig)

    // 2. Daily loss check — auto-activates kill switch if breached
    const portfolio = getPortfolio(db, config.mode)
    const currentValue = portfolio?.totalValue ?? config.safetyConfig.budget
    const baseline = getOrSetDailyBaseline(currentValue)
    const lossCheck = checkDailyLossLimit(baseline, currentValue, config.safetyConfig)
    if (lossCheck.triggered) {
      broadcast({
        type: 'safety_event',
        payload: { eventType: 'daily_loss_limit', message: lossCheck.reason },
        timestamp: Date.now(),
      })
      broadcast({ type: 'agent_update', payload: { status: 'error', task: `🛑 ${lossCheck.reason}` }, timestamp: Date.now() })
      return // kill switch is now active; trader.ts will block any further trades
    }

    if (isKillSwitchActive()) {
      broadcast({ type: 'agent_update', payload: { status: 'idle', task: 'Kill switch active — trading halted' }, timestamp: Date.now() })
      return
    }

    // 3. Normal analysis cycle
    const symbol = config.watchlist[index % config.watchlist.length]
    index++
    broadcast({ type: 'agent_update', payload: { status: 'active', task: `Starting cycle: ${symbol}` }, timestamp: Date.now() })
    try {
      await analyzeSymbol(symbol, db, config.mode, config.safetyConfig)
    } catch (err) {
      console.error(`[Orchestrator] Error on ${symbol}:`, err)
      broadcast({ type: 'agent_update', payload: { status: 'error', symbol, error: String(err) }, timestamp: Date.now() })
    }
  }

  runCycle()
  intervalId = setInterval(runCycle, config.intervalMs)
}

export function stopOrchestrator(): void {
  isRunning = false
  if (intervalId) { clearInterval(intervalId); intervalId = null }
  broadcast({ type: 'agent_update', payload: { status: 'idle', task: 'Orchestrator stopped' }, timestamp: Date.now() })
}

// ── Analysis pipeline ──────────────────────────────────────────────────────
export async function analyzeSymbol(
  symbol: string,
  db: Database.Database,
  mode: TradingMode,
  safetyConfig: SafetyConfig
): Promise<AgentReport[]> {
  const reports: AgentReport[] = []
  const emit = (agentId: AgentReport['agentId'] | undefined, task: string, extra: Record<string, unknown> = {}) =>
    broadcast({ type: 'agent_update', agentId, payload: { status: 'thinking', task, ...extra }, timestamp: Date.now() })

  // 1. Research
  emit('researcher', `Researching ${symbol}...`)
  const research = await generateResearchReport(symbol, db)
  insertAgentReport(db, research)
  reports.push(research)
  broadcast({ type: 'agent_update', agentId: 'researcher', payload: { status: 'active', task: `Research done: ${research.recommendation} (${research.conviction}/10)` }, timestamp: Date.now() })

  if ((research.conviction ?? 0) < 5) {
    broadcast({ type: 'agent_update', agentId: 'pm', payload: { status: 'idle', task: `${symbol}: conviction ${research.conviction}/10 too low — skipping` }, timestamp: Date.now() })
    return reports
  }

  // 2. Quant
  emit('quant', `Running technicals on ${symbol}...`)
  const quant = await generateQuantReport(symbol, db)
  insertAgentReport(db, quant)
  reports.push(quant)
  broadcast({ type: 'agent_update', agentId: 'quant', payload: { status: 'active', task: `Quant done: ${quant.recommendation}` }, timestamp: Date.now() })

  // 3. Macro
  emit('macro', `Macro check on ${symbol}...`)
  const macro = await generateMacroReport(symbol, db)
  insertAgentReport(db, macro)
  reports.push(macro)
  broadcast({ type: 'agent_update', agentId: 'macro', payload: { status: 'active', task: `Macro done: ${macro.recommendation}` }, timestamp: Date.now() })

  // 4. Risk
  const quote = await getQuote(symbol)
  const proposedSize = safetyConfig.budget * safetyConfig.maxPositionPct * 0.5
  emit('risk', `Risk check on ${symbol}...`)
  const risk = await generateRiskReport(symbol, proposedSize, quote.price, db, safetyConfig)
  insertAgentReport(db, risk)
  reports.push(risk)
  broadcast({ type: 'agent_update', agentId: 'risk', payload: { status: 'active', task: `Risk done: ${risk.recommendation}`, veto: (risk.content as Record<string, unknown>).veto }, timestamp: Date.now() })

  // 5. PM decision
  broadcast({ type: 'meeting_started', payload: { symbol, agents: ['researcher', 'quant', 'risk', 'macro'] }, timestamp: Date.now() })
  emit('pm', `Making decision on ${symbol}...`)
  const pmDecision = await generatePMDecision(symbol, reports, quote.price, db, safetyConfig)
  insertAgentReport(db, pmDecision)
  reports.push(pmDecision)
  broadcast({ type: 'decision_made', agentId: 'pm', payload: { symbol, decision: pmDecision.recommendation, reasoning: (pmDecision.content as Record<string, unknown>).reasoning }, timestamp: Date.now() })

  // 6. Execute
  if (pmDecision.recommendation === 'BUY' || pmDecision.recommendation === 'SELL') {
    emit('trader', `Executing ${pmDecision.recommendation} for ${symbol}...`)
    const result = await executeApprovedTrade(pmDecision, quote.price, mode, db, safetyConfig)
    broadcast({ type: 'agent_update', agentId: 'trader', payload: { status: result.success ? 'active' : 'idle', task: result.success ? `Order placed: ${result.tradeId?.slice(0, 8)}` : `Skipped: ${result.reason}` }, timestamp: Date.now() })
  } else {
    broadcast({ type: 'agent_update', agentId: 'trader', payload: { status: 'idle', task: `No trade — PM said ${pmDecision.recommendation}` }, timestamp: Date.now() })
  }

  return reports
}
