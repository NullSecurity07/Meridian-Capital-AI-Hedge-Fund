// lib/agents/risk.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons, getPositions, getPortfolio } from '@/lib/db'
import { calculateStopLossPrice } from '@/lib/safety'
import type { AgentReport, SafetyConfig } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Drew, a Risk Manager at Meridian Capital hedge fund.
Your job is to assess risk before any trade is made. You protect the fund from large losses.
You are conservative, skeptical, and focused on downside scenarios.
A risk veto (veto: true) is absolute — it blocks the trade from executing regardless of other agents' opinions.
Always output a valid JSON object with these exact fields:
{
  "risk_level": "low|medium|high|extreme",
  "max_position_pct": number (0-1),
  "suggested_position_size_usd": number,
  "stop_loss_price": number,
  "max_drawdown_scenario": "brief worst-case description",
  "key_risks": ["list", "of", "top", "risks"],
  "conviction": 1-10,
  "recommendation": "BUY|SELL|PASS|HOLD",
  "veto": boolean
}`

export async function generateRiskReport(
  symbol: string,
  proposedTradeValue: number,
  currentPrice: number,
  db: Database.Database,
  safetyConfig: SafetyConfig
): Promise<AgentReport> {
  const lessons = getAgentMemoryLessons(db, 'risk', 5)
  const portfolio = getPortfolio(db, 'paper')
  const positions = getPositions(db, 'paper')

  const stopLoss = calculateStopLossPrice(currentPrice, safetyConfig)
  const portfolioValue = portfolio?.totalValue ?? safetyConfig.budget
  const positionPct = proposedTradeValue / portfolioValue
  const deployedValue = positions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0)
  const exposurePct = deployedValue / portfolioValue

  const context = `Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
Proposed Trade Value: $${proposedTradeValue.toFixed(2)} (${(positionPct * 100).toFixed(1)}% of portfolio)
Auto Stop Loss: $${stopLoss.toFixed(2)} (${(safetyConfig.stopLossPct * 100).toFixed(0)}% below entry)
Portfolio Value: $${portfolioValue.toFixed(2)}
Current Deployed: ${(exposurePct * 100).toFixed(1)}% in ${positions.length} position(s)
Max Single Position: ${(safetyConfig.maxPositionPct * 100).toFixed(0)}%
Daily Loss Limit: ${(safetyConfig.dailyLossLimitPct * 100).toFixed(0)}%`

  const response = await runAgent(
    { id: 'risk', name: 'Drew', role: 'Risk Manager', systemPrompt: SYSTEM_PROMPT, maxTokens: 512 },
    [{ role: 'user', content: `Risk assessment for ${symbol}:\n\n${context}\n\nRespond with a JSON object only.` }],
    lessons
  )

  let content: Record<string, unknown>
  try {
    const match = response.content.match(/\{[\s\S]*\}/)
    content = match ? JSON.parse(match[0]) : { key_risks: [response.content], veto: false }
  } catch {
    content = { key_risks: [response.content], veto: false }
  }

  // Ensure veto is always a boolean
  if (typeof content.veto !== 'boolean') content.veto = false

  return {
    id: randomUUID(),
    agentId: 'risk',
    symbol,
    reportType: 'risk',
    content,
    conviction: typeof content.conviction === 'number' ? content.conviction : undefined,
    recommendation: content.recommendation as AgentReport['recommendation'] | undefined,
    createdAt: Date.now(),
  }
}
