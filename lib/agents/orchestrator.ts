// lib/agents/orchestrator.ts
import { generateResearchReport } from './researcher'
import { generateQuantReport } from './quant'
import { generateRiskReport } from './risk'
import { generateMacroReport } from './macro'
import { generatePMDecision } from './pm'
import { executeApprovedTrade } from './trader'
import { insertAgentReport } from '@/lib/db'
import { broadcast } from '@/lib/sse'
import { isKillSwitchActive } from '@/lib/safety'
import { getQuote } from '@/lib/market-data'
import type { AgentReport, SafetyConfig, TradingMode } from '@/types'
import type Database from 'better-sqlite3'

let isRunning = false
let intervalId: ReturnType<typeof setInterval> | null = null

export function isOrchestratorRunning(): boolean {
  return isRunning
}

export interface OrchestratorConfig {
  watchlist: string[]
  mode: TradingMode
  safetyConfig: SafetyConfig
  intervalMs: number
}

export function startOrchestrator(db: Database.Database, config: OrchestratorConfig): void {
  if (isRunning) return
  isRunning = true

  let index = 0
  const runCycle = async () => {
    if (!isRunning || isKillSwitchActive()) return
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
    broadcast({ type: 'agent_update', agentId: 'pm', payload: { status: 'idle', task: `${symbol}: low conviction (${research.conviction}/10), skipping` }, timestamp: Date.now() })
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

  // 5. PM decision (meeting)
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
    broadcast({ type: 'agent_update', agentId: 'trader', payload: { status: result.success ? 'active' : 'idle', task: result.success ? `Order placed: ${result.tradeId}` : `Skipped: ${result.reason}` }, timestamp: Date.now() })
  }

  return reports
}
