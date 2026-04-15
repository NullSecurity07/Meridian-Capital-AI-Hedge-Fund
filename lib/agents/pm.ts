// lib/agents/pm.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons } from '@/lib/db'
import type { AgentReport, Recommendation, SafetyConfig } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Morgan, the Portfolio Manager at Meridian Capital hedge fund.
You receive reports from your team and make the final investment decision.
You weigh each report by agent track record. Risk vetoes are absolute — never override them.
Capital preservation is paramount. Aim for risk-adjusted returns that BEAT the S&P 500.

INVERSE ETFs: SH (ProShares Short S&P 500) and PSQ (ProShares Short QQQ) are in the watchlist.
When Jordan (Macro) signals risk-off / bear market and the team is split or bearish, BUY SH or PSQ
as a hedge — this is how we profit in downturns rather than sitting in cash.

EARNINGS RISK: If any report flags an earnings date within 7 days, cut position_size_usd by 50%.

Always output a valid JSON object with these exact fields:
{
  "decision": "BUY|SELL|PASS|HOLD",
  "reasoning": "2-3 sentence explanation",
  "position_size_usd": number (0 if not buying/selling),
  "entry_price_max": number or null,
  "target_price": number or null,
  "stop_loss": number,
  "confidence": 1-10,
  "team_alignment": "aligned|split|conflicted",
  "overriding_factor": "which report most influenced the decision"
}`

const AGENT_LABELS: Record<string, string> = {
  researcher: 'Alex (Research)',
  quant: 'Sam (Quant)',
  risk: 'Drew (Risk)',
  macro: 'Jordan (Macro)',
}

export async function generatePMDecision(
  symbol: string,
  reports: AgentReport[],
  currentPrice: number,
  db: Database.Database,
  safetyConfig: SafetyConfig
): Promise<AgentReport> {
  const lessons = getAgentMemoryLessons(db, 'pm', 5)

  const riskReport = reports.find(r => r.agentId === 'risk')
  const riskVeto = (riskReport?.content as Record<string, unknown>)?.veto === true

  const reportSummaries = reports.map(r => {
    const c = r.content as Record<string, unknown>
    const label = AGENT_LABELS[r.agentId] ?? r.agentId
    return `## ${label}
Recommendation: ${r.recommendation ?? 'none'}
Conviction: ${r.conviction ?? 'N/A'}/10
Summary: ${JSON.stringify(c).slice(0, 250)}`
  }).join('\n\n')

  const macroReport = reports.find(r => r.agentId === 'macro')
  const macroCycle = (macroReport?.content as Record<string, unknown>)?.market_cycle ?? 'uncertain'
  const macroEnv = (macroReport?.content as Record<string, unknown>)?.macro_environment ?? 'neutral'
  const isBearish = typeof macroCycle === 'string' && macroCycle.includes('bear')

  const context = `Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
Available Budget: $${safetyConfig.budget.toFixed(2)}
Risk Veto Active: ${riskVeto ? 'YES — YOU MUST PASS' : 'No'}
Macro Environment: ${macroEnv} | Market Cycle: ${macroCycle}${isBearish ? ' ← BEARISH — consider SH/PSQ hedge if this IS SH or PSQ' : ''}

Team Reports:
${reportSummaries}`

  const response = await runAgent(
    { id: 'pm', name: 'Morgan', role: 'Portfolio Manager', systemPrompt: SYSTEM_PROMPT, maxTokens: 768 },
    [{ role: 'user', content: `Investment decision for ${symbol}:\n\n${context}\n\nRespond with a JSON object only.` }],
    lessons
  )

  let content: Record<string, unknown>
  try {
    const match = response.content.match(/\{[\s\S]*\}/)
    content = match ? JSON.parse(match[0]) : { decision: 'PASS', reasoning: response.content }
  } catch {
    content = { decision: 'PASS', reasoning: response.content }
  }

  // Risk veto is absolute — override regardless of what Claude decided
  if (riskVeto) {
    content.decision = 'PASS'
    content.position_size_usd = 0
    content.reasoning = `Risk Manager veto overrides all other inputs. ${content.reasoning ?? ''}`
  }

  const decision = (content.decision as Recommendation) ?? 'PASS'

  return {
    id: randomUUID(),
    agentId: 'pm',
    symbol,
    reportType: 'pm_decision',
    content,
    conviction: typeof content.confidence === 'number' ? content.confidence : undefined,
    recommendation: decision,
    createdAt: Date.now(),
  }
}
