// lib/agents/quant.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons } from '@/lib/db'
import { getHistoricalBars } from '@/lib/market-data'
import type { AgentReport } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Sam, a Quantitative Analyst at Meridian Capital hedge fund.
You analyze stocks using technical indicators and statistical models.
You are precise, data-driven, and probabilistic in your thinking.
Always output a valid JSON object with these exact fields:
{
  "rsi": number (0-100),
  "trend": "uptrend|downtrend|sideways",
  "signal": "BUY|SELL|NEUTRAL",
  "support": number,
  "resistance": number,
  "volatility": "low|medium|high",
  "upside_probability": number (0-1),
  "expected_move_pct": number,
  "time_horizon_days": number,
  "conviction": 1-10,
  "recommendation": "BUY|SELL|PASS|HOLD",
  "notes": "brief technical summary"
}`

export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export async function generateQuantReport(
  symbol: string,
  db: Database.Database
): Promise<AgentReport> {
  const endDate = new Date().toISOString().split('T')[0]
  const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const bars = await getHistoricalBars(symbol, startDate, endDate)
  const closes = bars.map(b => b.close)
  const rsi = calculateRSI(closes)

  const recent = bars.slice(-20)
  const resistance = Math.max(...recent.map(b => b.high))
  const support = Math.min(...recent.map(b => b.low))
  const currentPrice = closes[closes.length - 1] ?? 0

  const lessons = getAgentMemoryLessons(db, 'quant', 5)

  const barSummary = recent.slice(-5).map(b =>
    `${b.date}: O=${b.open.toFixed(2)} H=${b.high.toFixed(2)} L=${b.low.toFixed(2)} C=${b.close.toFixed(2)} V=${(b.volume / 1_000_000).toFixed(1)}M`
  ).join('\n')

  const context = `Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
RSI(14): ${rsi.toFixed(1)}
20-day Support: $${support.toFixed(2)}
20-day Resistance: $${resistance.toFixed(2)}
Days of historical data: ${bars.length}

Last 5 bars:
${barSummary}`

  const response = await runAgent(
    { id: 'quant', name: 'Sam', role: 'Quant Analyst', systemPrompt: SYSTEM_PROMPT, maxTokens: 512 },
    [{ role: 'user', content: `Technical analysis for ${symbol}:\n\n${context}\n\nRespond with a JSON object only.` }],
    lessons
  )

  let content: Record<string, unknown>
  try {
    const match = response.content.match(/\{[\s\S]*\}/)
    content = match ? JSON.parse(match[0]) : { notes: response.content, rsi }
  } catch {
    content = { notes: response.content, rsi }
  }

  return {
    id: randomUUID(),
    agentId: 'quant',
    symbol,
    reportType: 'quant',
    content,
    conviction: typeof content.conviction === 'number' ? content.conviction : undefined,
    recommendation: content.recommendation as AgentReport['recommendation'] | undefined,
    createdAt: Date.now(),
  }
}
