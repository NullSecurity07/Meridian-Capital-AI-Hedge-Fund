// lib/agents/researcher.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons } from '@/lib/db'
import { getQuote, getNewsHeadlines } from '@/lib/market-data'
import type { AgentReport } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Alex, a Research Analyst at Meridian Capital hedge fund.
Your job is to research companies fundamentally — news, earnings, sector trends, competitive position.
You are thorough, skeptical, and evidence-based. You cite specific data points.
Always output a valid JSON object with these exact fields:
{
  "summary": "2-3 sentence executive summary",
  "thesis": "investment thesis in 1-2 sentences",
  "catalysts": ["list", "of", "positive", "catalysts"],
  "risks": ["list", "of", "key", "risks"],
  "sentiment": "positive|neutral|negative",
  "conviction": 1-10,
  "recommendation": "BUY|SELL|PASS|HOLD",
  "targetPrice": number or null,
  "timeHorizon": "short|medium|long"
}`

export async function generateResearchReport(
  symbol: string,
  db: Database.Database
): Promise<AgentReport> {
  const [quote, news] = await Promise.all([
    getQuote(symbol),
    getNewsHeadlines(symbol),
  ])

  const lessons = getAgentMemoryLessons(db, 'researcher', 5)

  const context = `Symbol: ${symbol}
Current Price: $${quote.price.toFixed(2)} (${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%)
Volume: ${(quote.volume / 1_000_000).toFixed(1)}M
P/E Ratio: ${quote.pe?.toFixed(1) ?? 'N/A'}
Market Cap: $${quote.marketCap ? (quote.marketCap / 1_000_000_000).toFixed(1) + 'B' : 'N/A'}

Recent News (${news.length} articles):
${news.slice(0, 5).map(n => `- [${(n.sentiment ?? 'neutral').toUpperCase()}] ${n.title}`).join('\n') || '(none available)'}`

  const response = await runAgent(
    { id: 'researcher', name: 'Alex', role: 'Research Analyst', systemPrompt: SYSTEM_PROMPT },
    [{ role: 'user', content: `Analyze ${symbol}. Current data:\n\n${context}\n\nRespond with a JSON object only.` }],
    lessons
  )

  let content: Record<string, unknown>
  try {
    const match = response.content.match(/\{[\s\S]*\}/)
    content = match ? JSON.parse(match[0]) : { summary: response.content }
  } catch {
    content = { summary: response.content }
  }

  return {
    id: randomUUID(),
    agentId: 'researcher',
    symbol,
    reportType: 'research',
    content,
    conviction: typeof content.conviction === 'number' ? content.conviction : undefined,
    recommendation: content.recommendation as AgentReport['recommendation'] | undefined,
    createdAt: Date.now(),
  }
}
