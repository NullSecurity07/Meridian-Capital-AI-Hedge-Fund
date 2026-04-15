// lib/agents/macro.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons } from '@/lib/db'
import { getNewsHeadlines } from '@/lib/market-data'
import type { AgentReport } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Jordan, a Macro Strategist at Meridian Capital hedge fund.
You assess macro-economic conditions affecting a potential trade.
You monitor interest rates, sector rotation, Fed policy, geopolitical risks, and market cycles.
Always output a valid JSON object with these exact fields:
{
  "macro_environment": "risk-on|risk-off|neutral",
  "sector_outlook": "positive|neutral|negative",
  "key_macro_factors": ["top", "3-5", "macro", "factors"],
  "rate_sensitivity": "high|medium|low",
  "market_cycle": "early-bull|mid-bull|late-bull|early-bear|mid-bear|late-bear|uncertain",
  "timing_assessment": "good-entry|wait|avoid",
  "conviction": 1-10,
  "recommendation": "BUY|SELL|PASS|HOLD",
  "notes": "1-2 sentence macro commentary"
}`

export async function generateMacroReport(
  symbol: string,
  db: Database.Database
): Promise<AgentReport> {
  const lessons = getAgentMemoryLessons(db, 'macro', 5)

  const [stockNews, spyNews] = await Promise.all([
    getNewsHeadlines(symbol),
    getNewsHeadlines('SPY').catch(() => []),
  ])

  const context = `Stock Being Evaluated: ${symbol}

${symbol} News (${stockNews.length} items):
${stockNews.slice(0, 3).map(n => `- ${n.title}`).join('\n') || '(none available)'}

Broad Market News (${spyNews.length} items):
${spyNews.slice(0, 3).map(n => `- ${n.title}`).join('\n') || '(none available)'}`

  const response = await runAgent(
    { id: 'macro', name: 'Jordan', role: 'Macro Strategist', systemPrompt: SYSTEM_PROMPT, maxTokens: 512 },
    [{ role: 'user', content: `Macro analysis for a potential ${symbol} trade:\n\n${context}\n\nRespond with a JSON object only.` }],
    lessons
  )

  let content: Record<string, unknown>
  try {
    const match = response.content.match(/\{[\s\S]*\}/)
    content = match ? JSON.parse(match[0]) : { notes: response.content }
  } catch {
    content = { notes: response.content }
  }

  return {
    id: randomUUID(),
    agentId: 'macro',
    symbol,
    reportType: 'macro',
    content,
    conviction: typeof content.conviction === 'number' ? content.conviction : undefined,
    recommendation: content.recommendation as AgentReport['recommendation'] | undefined,
    createdAt: Date.now(),
  }
}
