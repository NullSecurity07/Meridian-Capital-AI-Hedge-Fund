# Meridian Capital — Agent System + API Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all 6 Claude-powered agents, the orchestrator that runs them, and the Next.js API routes that wire everything together so the backend is fully operational.

**Architecture:** Each agent is a pure async function that fetches market context, injects memory lessons from SQLite, calls Claude via `runAgent` (from Plan 1's `lib/agents/base-agent.ts`), parses the JSON response, and returns an `AgentReport`. The orchestrator runs a cycle: Research → Quant → Macro → Risk → PM decision → Trader execution — broadcasting SSE events at every step. API routes expose start/stop/status/stream endpoints.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3, @anthropic-ai/sdk, @alpacahq/alpaca-trade-api, Vitest (mocked agents in tests)

---

## File Map

| File | Purpose |
|------|---------|
| `next.config.js` | Next.js config (enable ES modules for better-sqlite3) |
| `app/layout.tsx` | Root HTML shell |
| `app/page.tsx` | Placeholder page (replaced by Plan 3 UI) |
| `lib/db-singleton.ts` | Persistent SQLite instance across API route calls |
| `lib/orchestrator-singleton.ts` | Singleton orchestrator state for API routes |
| `lib/agents/researcher.ts` | Research Analyst — news, fundamentals, conviction |
| `lib/agents/quant.ts` | Quant Analyst — RSI, technicals, entry/exit signals |
| `lib/agents/risk.ts` | Risk Manager — position sizing, stop loss, veto |
| `lib/agents/macro.ts` | Macro Strategist — rates, sector rotation |
| `lib/agents/pm.ts` | Portfolio Manager — reads all reports, final decision |
| `lib/agents/trader.ts` | Trader — safety checks, executes via Alpaca |
| `lib/agents/orchestrator.ts` | Runs analysis cycle, coordinates agents, SSE events |
| `app/api/stream/route.ts` | GET — SSE stream endpoint |
| `app/api/agents/route.ts` | GET list agents; POST start/stop orchestrator |
| `app/api/portfolio/route.ts` | GET portfolio state + open positions |
| `app/api/trading/analyze/route.ts` | POST trigger analysis on a symbol |
| `tests/agents/researcher.test.ts` | Researcher agent tests (mocked runAgent + market-data) |
| `tests/agents/quant.test.ts` | Quant agent tests |
| `tests/agents/risk.test.ts` | Risk agent tests |
| `tests/agents/macro.test.ts` | Macro agent tests |
| `tests/agents/pm.test.ts` | PM agent tests |
| `tests/agents/orchestrator.test.ts` | Orchestrator tests (mocked agents) |

---

## Task 1: Next.js bootstrap + DB singleton

**Files:**
- Create: `next.config.js`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `lib/db-singleton.ts`
- Create: `lib/orchestrator-singleton.ts`

- [ ] **Step 1: Create `next.config.js`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
}

module.exports = nextConfig
```

- [ ] **Step 2: Create `app/layout.tsx`**

```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 3: Create `app/page.tsx`**

```typescript
export default function Home() {
  return (
    <main style={{ fontFamily: 'monospace', padding: '2rem', background: '#0a0e14', color: '#22c55e', minHeight: '100vh' }}>
      <h1>Meridian Capital</h1>
      <p>API running. Dashboard coming in Plan 3.</p>
      <p>Endpoints: <code>/api/agents</code> · <code>/api/stream</code> · <code>/api/portfolio</code> · <code>/api/trading/analyze</code></p>
    </main>
  )
}
```

- [ ] **Step 4: Create `lib/db-singleton.ts`**

```typescript
// lib/db-singleton.ts
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import path from 'path'

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'meridian.db')
    _db = new Database(dbPath)
    initDb(_db)
  }
  return _db
}
```

- [ ] **Step 5: Create `lib/orchestrator-singleton.ts`**

```typescript
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
```

- [ ] **Step 6: Verify Next.js starts**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx next dev --port 3000 &
sleep 5
curl -s http://localhost:3000 | head -5
kill %1
```

Expected: HTML response containing "Meridian Capital".

- [ ] **Step 7: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add next.config.js app/layout.tsx app/page.tsx lib/db-singleton.ts lib/orchestrator-singleton.ts
git commit -m "feat: Next.js bootstrap, db singleton, orchestrator options singleton"
```

---

## Task 2: Researcher agent

**Files:**
- Create: `lib/agents/researcher.ts`
- Create: `tests/agents/researcher.test.ts`

- [ ] **Step 1: Write the failing test**

```bash
mkdir -p /home/nullsec/Desktop/cl/tests/agents
```

Create `tests/agents/researcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateResearchReport } from '@/lib/agents/researcher'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      summary: 'NVDA is a leading AI chip company with strong revenue growth.',
      thesis: 'AI demand drives sustained outperformance.',
      catalysts: ['Data center GPU demand', 'New Blackwell architecture'],
      risks: ['Valuation stretch', 'China export restrictions'],
      sentiment: 'positive',
      conviction: 8,
      recommendation: 'BUY',
      targetPrice: 150,
      timeHorizon: 'medium',
    }),
    usage: { inputTokens: 200, outputTokens: 100 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'NVDA', price: 127.40, change: 2.9, changePct: 2.33,
    volume: 45000000, marketCap: 3100000000000, pe: 34.2, timestamp: Date.now(),
  }),
  getNewsHeadlines: vi.fn().mockResolvedValue([
    { title: 'NVIDIA beats estimates', summary: 'Strong quarter', url: 'https://example.com', publishedAt: Date.now(), sentiment: 'positive' },
  ]),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generateResearchReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateResearchReport('NVDA', db)
    expect(report.agentId).toBe('researcher')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('research')
    expect(report.conviction).toBe(8)
    expect(report.recommendation).toBe('BUY')
    expect(report.id).toBeDefined()
    expect(report.createdAt).toBeGreaterThan(0)
  })

  it('handles malformed JSON from Claude gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON at all', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateResearchReport('NVDA', db)
    expect(report.agentId).toBe('researcher')
    expect(report.content).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/researcher.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/researcher'"

- [ ] **Step 3: Implement `lib/agents/researcher.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/researcher.test.ts --reporter=verbose
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/researcher.ts tests/agents/researcher.test.ts
git commit -m "feat: Research Analyst agent (Alex)"
```

---

## Task 3: Quant agent

**Files:**
- Create: `lib/agents/quant.ts`
- Create: `tests/agents/quant.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/quant.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateQuantReport, calculateRSI } from '@/lib/agents/quant'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      rsi: 42.5,
      trend: 'uptrend',
      signal: 'BUY',
      support: 120.00,
      resistance: 135.00,
      volatility: 'medium',
      upside_probability: 0.65,
      expected_move_pct: 12,
      time_horizon_days: 45,
      conviction: 7,
      recommendation: 'BUY',
      notes: 'RSI is recovering from oversold territory with strong volume.',
    }),
    usage: { inputTokens: 150, outputTokens: 80 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getHistoricalBars: vi.fn().mockResolvedValue(
    Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (30 - i) * 86400000).toISOString().split('T')[0],
      open: 120 + i * 0.5,
      high: 122 + i * 0.5,
      low: 118 + i * 0.5,
      close: 121 + i * 0.5,
      volume: 40000000,
    }))
  ),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('calculateRSI', () => {
  it('returns 50 when insufficient data', () => {
    expect(calculateRSI([100, 101, 102], 14)).toBe(50)
  })

  it('returns 100 when all gains (no losses)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i)
    expect(calculateRSI(closes)).toBe(100)
  })

  it('returns a number between 0 and 100', () => {
    const closes = [100, 98, 102, 99, 105, 103, 101, 108, 106, 110, 108, 112, 110, 115, 113]
    const rsi = calculateRSI(closes)
    expect(rsi).toBeGreaterThanOrEqual(0)
    expect(rsi).toBeLessThanOrEqual(100)
  })
})

describe('generateQuantReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateQuantReport('NVDA', db)
    expect(report.agentId).toBe('quant')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('quant')
    expect(report.conviction).toBe(7)
    expect(report.recommendation).toBe('BUY')
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateQuantReport('NVDA', db)
    expect(report.agentId).toBe('quant')
    expect(report.content).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/quant.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/quant'"

- [ ] **Step 3: Implement `lib/agents/quant.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/quant.test.ts --reporter=verbose
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/quant.ts tests/agents/quant.test.ts
git commit -m "feat: Quant Analyst agent (Sam) with RSI calculation"
```

---

## Task 4: Risk agent

**Files:**
- Create: `lib/agents/risk.ts`
- Create: `tests/agents/risk.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/risk.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb, upsertPortfolio } from '@/lib/db'
import { generateRiskReport } from '@/lib/agents/risk'
import type { SafetyConfig } from '@/types'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      risk_level: 'medium',
      max_position_pct: 0.08,
      suggested_position_size_usd: 800,
      stop_loss_price: 117.21,
      max_drawdown_scenario: '18% drawdown in severe bear market',
      key_risks: ['High valuation', 'Macro headwinds', 'Regulatory risk'],
      conviction: 6,
      recommendation: 'BUY',
      veto: false,
    }),
    usage: { inputTokens: 180, outputTokens: 90 },
  }),
}))

const config: SafetyConfig = {
  maxPositionPct: 0.15,
  dailyLossLimitPct: 0.05,
  stopLossPct: 0.08,
  budget: 10000,
}

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
  upsertPortfolio(db, { mode: 'paper', budget: 10000, cash: 9000, totalValue: 10200, updatedAt: Date.now() })
})

describe('generateRiskReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateRiskReport('NVDA', 1000, 127.40, db, config)
    expect(report.agentId).toBe('risk')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('risk')
    expect(report.conviction).toBe(6)
    expect(report.recommendation).toBe('BUY')
    expect((report.content as Record<string, unknown>).veto).toBe(false)
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateRiskReport('NVDA', 1000, 127.40, db, config)
    expect(report.agentId).toBe('risk')
    expect((report.content as Record<string, unknown>).veto).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/risk.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/risk'"

- [ ] **Step 3: Implement `lib/agents/risk.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/risk.test.ts --reporter=verbose
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/risk.ts tests/agents/risk.test.ts
git commit -m "feat: Risk Manager agent (Drew)"
```

---

## Task 5: Macro agent

**Files:**
- Create: `lib/agents/macro.ts`
- Create: `tests/agents/macro.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/macro.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generateMacroReport } from '@/lib/agents/macro'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      macro_environment: 'risk-on',
      sector_outlook: 'positive',
      key_macro_factors: ['Fed pause', 'AI spending boom', 'Strong earnings season'],
      rate_sensitivity: 'medium',
      market_cycle: 'mid-bull',
      timing_assessment: 'good-entry',
      conviction: 7,
      recommendation: 'BUY',
      notes: 'Macro tailwinds support risk assets. AI sector benefiting from rate stability.',
    }),
    usage: { inputTokens: 160, outputTokens: 85 },
  }),
}))

vi.mock('@/lib/market-data', () => ({
  getNewsHeadlines: vi.fn().mockResolvedValue([
    { title: 'Fed holds rates steady', summary: 'Pause continues', url: 'https://example.com', publishedAt: Date.now(), sentiment: 'positive' },
  ]),
}))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generateMacroReport', () => {
  it('returns a valid AgentReport', async () => {
    const report = await generateMacroReport('NVDA', db)
    expect(report.agentId).toBe('macro')
    expect(report.symbol).toBe('NVDA')
    expect(report.reportType).toBe('macro')
    expect(report.conviction).toBe(7)
    expect(report.recommendation).toBe('BUY')
  })

  it('handles malformed JSON gracefully', async () => {
    const { runAgent } = await import('@/lib/agents/base-agent')
    vi.mocked(runAgent).mockResolvedValueOnce({ content: 'Not JSON', usage: { inputTokens: 10, outputTokens: 5 } })
    const report = await generateMacroReport('NVDA', db)
    expect(report.agentId).toBe('macro')
    expect(report.content).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/macro.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/macro'"

- [ ] **Step 3: Implement `lib/agents/macro.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/macro.test.ts --reporter=verbose
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/macro.ts tests/agents/macro.test.ts
git commit -m "feat: Macro Strategist agent (Jordan)"
```

---

## Task 6: Portfolio Manager agent

**Files:**
- Create: `lib/agents/pm.ts`
- Create: `tests/agents/pm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agents/pm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { generatePMDecision } from '@/lib/agents/pm'
import type { AgentReport, SafetyConfig } from '@/types'

vi.mock('@/lib/agents/base-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    content: JSON.stringify({
      decision: 'BUY',
      reasoning: 'Team is 3/4 aligned on a BUY. Risk concerns noted but manageable.',
      position_size_usd: 1500,
      entry_price_max: 130,
      target_price: 150,
      stop_loss: 117.21,
      confidence: 7,
      team_alignment: 'aligned',
      overriding_factor: 'researcher',
    }),
    usage: { inputTokens: 300, outputTokens: 120 },
  }),
}))

const config: SafetyConfig = { maxPositionPct: 0.15, dailyLossLimitPct: 0.05, stopLossPct: 0.08, budget: 10000 }

const makeReport = (agentId: AgentReport['agentId'], recommendation: AgentReport['recommendation'], veto = false): AgentReport => ({
  id: `${agentId}-1`,
  agentId,
  symbol: 'NVDA',
  reportType: agentId === 'pm' ? 'pm_decision' : agentId as AgentReport['reportType'],
  content: { recommendation, veto },
  conviction: 7,
  recommendation,
  createdAt: Date.now(),
})

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

describe('generatePMDecision', () => {
  it('returns BUY when team is aligned', async () => {
    const reports = [
      makeReport('researcher', 'BUY'),
      makeReport('quant', 'BUY'),
      makeReport('risk', 'BUY'),
      makeReport('macro', 'BUY'),
    ]
    const decision = await generatePMDecision('NVDA', reports, 127.40, db, config)
    expect(decision.agentId).toBe('pm')
    expect(decision.reportType).toBe('pm_decision')
    expect(decision.recommendation).toBe('BUY')
    expect((decision.content as Record<string, unknown>).position_size_usd).toBe(1500)
  })

  it('forces PASS when risk agent vetoes', async () => {
    const reports = [
      makeReport('researcher', 'BUY'),
      makeReport('quant', 'BUY'),
      makeReport('risk', 'PASS', true), // veto: true
      makeReport('macro', 'BUY'),
    ]
    const decision = await generatePMDecision('NVDA', reports, 127.40, db, config)
    expect(decision.recommendation).toBe('PASS')
    expect((decision.content as Record<string, unknown>).position_size_usd).toBe(0)
    expect(String((decision.content as Record<string, unknown>).reasoning)).toContain('veto')
  })
})
```

- [ ] **Step 2: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/pm.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/pm'"

- [ ] **Step 3: Implement `lib/agents/pm.ts`**

```typescript
// lib/agents/pm.ts
import { runAgent } from './base-agent'
import { getAgentMemoryLessons } from '@/lib/db'
import type { AgentReport, Recommendation, SafetyConfig } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const SYSTEM_PROMPT = `You are Morgan, the Portfolio Manager at Meridian Capital hedge fund.
You receive reports from your team and make the final investment decision.
You weigh each report by agent track record. Risk vetoes are absolute — never override them.
Capital preservation is paramount. Aim for risk-adjusted returns.
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

  const context = `Symbol: ${symbol}
Current Price: $${currentPrice.toFixed(2)}
Available Budget: $${safetyConfig.budget.toFixed(2)}
Risk Veto Active: ${riskVeto ? 'YES — YOU MUST PASS' : 'No'}

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

  // Risk veto is absolute
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
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/pm.test.ts --reporter=verbose
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/pm.ts tests/agents/pm.test.ts
git commit -m "feat: Portfolio Manager agent (Morgan) with risk veto enforcement"
```

---

## Task 7: Trader agent + Orchestrator

**Files:**
- Create: `lib/agents/trader.ts`
- Create: `lib/agents/orchestrator.ts`
- Create: `tests/agents/orchestrator.test.ts`

- [ ] **Step 1: Create `lib/agents/trader.ts`**

No separate test file — trader is tested through the orchestrator. Create the file:

```typescript
// lib/agents/trader.ts
import { createAlpacaClient, submitOrder } from '@/lib/alpaca'
import { insertTrade, upsertPortfolio, getPortfolio } from '@/lib/db'
import { checkPositionLimit, checkBudgetLimit, isKillSwitchActive } from '@/lib/safety'
import { broadcast } from '@/lib/sse'
import type { AgentReport, SafetyConfig, TradingMode } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

export async function executeApprovedTrade(
  pmDecision: AgentReport,
  currentPrice: number,
  mode: TradingMode,
  db: Database.Database,
  safetyConfig: SafetyConfig
): Promise<{ success: boolean; tradeId?: string; reason?: string }> {
  if (isKillSwitchActive()) {
    return { success: false, reason: 'Kill switch is active — trading halted' }
  }

  const decision = pmDecision.content as Record<string, unknown>
  const action = decision.decision as string

  if (action !== 'BUY' && action !== 'SELL') {
    return { success: false, reason: `PM decision was ${action} — no trade needed` }
  }

  const positionSizeUsd = typeof decision.position_size_usd === 'number' ? decision.position_size_usd : 0
  if (positionSizeUsd <= 0) {
    return { success: false, reason: 'Position size is zero — no trade' }
  }

  const portfolio = getPortfolio(db, mode === 'simulation' ? 'simulation' : mode)
  const availableCash = portfolio?.cash ?? safetyConfig.budget
  const totalValue = portfolio?.totalValue ?? safetyConfig.budget

  const posCheck = checkPositionLimit(positionSizeUsd, totalValue, safetyConfig)
  if (!posCheck.allowed) return { success: false, reason: posCheck.reason }

  const budgetCheck = checkBudgetLimit(positionSizeUsd, availableCash)
  if (!budgetCheck.allowed) return { success: false, reason: budgetCheck.reason }

  const quantity = Math.floor(positionSizeUsd / currentPrice)
  if (quantity < 1) return { success: false, reason: 'Position too small for even 1 share' }

  const tradeId = randomUUID()
  const total = quantity * currentPrice

  if (mode === 'simulation') {
    insertTrade(db, {
      id: tradeId,
      symbol: pmDecision.symbol,
      action: action as 'BUY' | 'SELL',
      quantity,
      price: currentPrice,
      total,
      status: 'FILLED',
      mode: 'simulation',
      createdAt: Date.now(),
    })
    upsertPortfolio(db, {
      mode: 'simulation',
      budget: safetyConfig.budget,
      cash: availableCash - (action === 'BUY' ? total : -total),
      totalValue,
      updatedAt: Date.now(),
    })
    broadcast({ type: 'trade_executed', agentId: 'trader', payload: { tradeId, symbol: pmDecision.symbol, action, quantity, price: currentPrice, total, mode }, timestamp: Date.now() })
    return { success: true, tradeId }
  }

  const alpacaMode = mode === 'live' ? 'live' : 'paper'
  const client = createAlpacaClient(alpacaMode)
  const order = await submitOrder(client, pmDecision.symbol, quantity, action.toLowerCase() as 'buy' | 'sell', 'market')

  insertTrade(db, {
    id: tradeId,
    symbol: pmDecision.symbol,
    action: action as 'BUY' | 'SELL',
    quantity,
    price: currentPrice,
    total,
    status: 'PENDING',
    mode,
    alpacaOrderId: order.alpacaOrderId,
    createdAt: Date.now(),
  })
  broadcast({ type: 'trade_executed', agentId: 'trader', payload: { tradeId, symbol: pmDecision.symbol, action, quantity, price: currentPrice, alpacaOrderId: order.alpacaOrderId, mode }, timestamp: Date.now() })
  return { success: true, tradeId }
}
```

- [ ] **Step 2: Create `lib/agents/orchestrator.ts`**

```typescript
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
```

- [ ] **Step 3: Write orchestrator tests**

Create `tests/agents/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initDb } from '@/lib/db'
import { analyzeSymbol, isOrchestratorRunning, startOrchestrator, stopOrchestrator } from '@/lib/agents/orchestrator'
import type { SafetyConfig } from '@/types'

vi.mock('@/lib/agents/researcher', () => ({
  generateResearchReport: vi.fn().mockResolvedValue({
    id: 'r1', agentId: 'researcher', symbol: 'NVDA', reportType: 'research',
    content: { summary: 'Strong', conviction: 8 }, conviction: 8, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/quant', () => ({
  generateQuantReport: vi.fn().mockResolvedValue({
    id: 'q1', agentId: 'quant', symbol: 'NVDA', reportType: 'quant',
    content: { notes: 'Bullish RSI' }, conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/risk', () => ({
  generateRiskReport: vi.fn().mockResolvedValue({
    id: 'rk1', agentId: 'risk', symbol: 'NVDA', reportType: 'risk',
    content: { veto: false, key_risks: [] }, conviction: 6, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/macro', () => ({
  generateMacroReport: vi.fn().mockResolvedValue({
    id: 'm1', agentId: 'macro', symbol: 'NVDA', reportType: 'macro',
    content: { notes: 'Macro ok' }, conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/pm', () => ({
  generatePMDecision: vi.fn().mockResolvedValue({
    id: 'pm1', agentId: 'pm', symbol: 'NVDA', reportType: 'pm_decision',
    content: { decision: 'BUY', position_size_usd: 1000, reasoning: 'Team aligned' },
    conviction: 7, recommendation: 'BUY', createdAt: Date.now(),
  }),
}))

vi.mock('@/lib/agents/trader', () => ({
  executeApprovedTrade: vi.fn().mockResolvedValue({ success: true, tradeId: 'trade-123' }),
}))

vi.mock('@/lib/market-data', () => ({
  getQuote: vi.fn().mockResolvedValue({
    symbol: 'NVDA', price: 127.40, change: 2.9, changePct: 2.33,
    volume: 45000000, timestamp: Date.now(),
  }),
}))

const safetyConfig: SafetyConfig = { maxPositionPct: 0.15, dailyLossLimitPct: 0.05, stopLossPct: 0.08, budget: 10000 }

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
  vi.clearAllMocks()
  stopOrchestrator()
})

describe('analyzeSymbol', () => {
  it('runs full pipeline and returns 5 reports', async () => {
    const reports = await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    expect(reports).toHaveLength(5) // researcher, quant, macro, risk, pm
  })

  it('skips quant/risk/pm if research conviction is too low', async () => {
    const { generateResearchReport } = await import('@/lib/agents/researcher')
    vi.mocked(generateResearchReport).mockResolvedValueOnce({
      id: 'r1', agentId: 'researcher', symbol: 'NVDA', reportType: 'research',
      content: { summary: 'Weak' }, conviction: 3, recommendation: 'PASS', createdAt: Date.now(),
    })
    const reports = await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    expect(reports).toHaveLength(1) // only research
  })

  it('saves all reports to the database', async () => {
    await analyzeSymbol('NVDA', db, 'simulation', safetyConfig)
    const { getLatestReportsBySymbol } = await import('@/lib/db')
    const saved = getLatestReportsBySymbol(db, 'NVDA')
    expect(saved.length).toBeGreaterThanOrEqual(4)
  })
})

describe('orchestrator lifecycle', () => {
  it('starts as not running', () => {
    expect(isOrchestratorRunning()).toBe(false)
  })

  it('starts and stops correctly', () => {
    startOrchestrator(db, { watchlist: ['NVDA'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    expect(isOrchestratorRunning()).toBe(true)
    stopOrchestrator()
    expect(isOrchestratorRunning()).toBe(false)
  })

  it('does not start twice', () => {
    startOrchestrator(db, { watchlist: ['NVDA'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    startOrchestrator(db, { watchlist: ['AAPL'], mode: 'simulation', safetyConfig, intervalMs: 99999 })
    expect(isOrchestratorRunning()).toBe(true)
    stopOrchestrator()
  })
})
```

- [ ] **Step 4: Run to verify FAIL**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/orchestrator.test.ts 2>&1 | tail -5
```

Expected: FAIL — "Cannot find module '@/lib/agents/orchestrator'"

- [ ] **Step 5: Run tests — verify PASS**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run tests/agents/orchestrator.test.ts --reporter=verbose
```

Expected: 5 tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run 2>&1 | tail -8
```

Expected: All tests pass (55+ total).

- [ ] **Step 7: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add lib/agents/trader.ts lib/agents/orchestrator.ts tests/agents/orchestrator.test.ts
git commit -m "feat: Trader agent (Riley) and Orchestrator — full analysis pipeline"
```

---

## Task 8: API routes

**Files:**
- Create: `app/api/stream/route.ts`
- Create: `app/api/agents/route.ts`
- Create: `app/api/portfolio/route.ts`
- Create: `app/api/trading/analyze/route.ts`

No Vitest tests for API routes — they are tested manually via curl in the verification step.

- [ ] **Step 1: Create `app/api/stream/route.ts`**

```typescript
// app/api/stream/route.ts
import { subscribe, unsubscribe } from '@/lib/sse'
import type { SSEEvent } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()
  let subId: string

  const stream = new ReadableStream({
    start(controller) {
      // Send a heartbeat immediately to confirm connection
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))

      subId = subscribe((event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Controller may be closed if client disconnected
        }
      })

      // Heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30000)
    },
    cancel() {
      unsubscribe(subId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

- [ ] **Step 2: Create `app/api/agents/route.ts`**

```typescript
// app/api/agents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getOrchestratorOptions, setOrchestratorOptions } from '@/lib/orchestrator-singleton'
import { startOrchestrator, stopOrchestrator, isOrchestratorRunning } from '@/lib/agents/orchestrator'
import { getAgent } from '@/lib/db'
import type { AgentId } from '@/types'

const AGENT_IDS: AgentId[] = ['pm', 'researcher', 'quant', 'risk', 'macro', 'trader']

export async function GET() {
  const db = getDb()
  const agents = AGENT_IDS.map(id => getAgent(db, id)).filter(Boolean)
  return NextResponse.json({
    agents,
    orchestrator: { running: isOrchestratorRunning(), options: getOrchestratorOptions() },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: string; options?: Partial<ReturnType<typeof getOrchestratorOptions>> }
  const db = getDb()

  if (body.action === 'start') {
    if (body.options) setOrchestratorOptions(body.options)
    const opts = getOrchestratorOptions()
    startOrchestrator(db, opts)
    return NextResponse.json({ started: true, options: opts })
  }

  if (body.action === 'stop') {
    stopOrchestrator()
    return NextResponse.json({ stopped: true })
  }

  return NextResponse.json({ error: 'Unknown action. Use "start" or "stop".' }, { status: 400 })
}
```

- [ ] **Step 3: Create `app/api/portfolio/route.ts`**

```typescript
// app/api/portfolio/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getPortfolio, getPositions } from '@/lib/db'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'

export async function GET() {
  const db = getDb()
  const { mode } = getOrchestratorOptions()
  const portfolio = getPortfolio(db, mode)
  const positions = getPositions(db, mode)
  return NextResponse.json({ portfolio, positions, mode })
}
```

- [ ] **Step 4: Create `app/api/trading/analyze/route.ts`**

```typescript
// app/api/trading/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'
import { analyzeSymbol } from '@/lib/agents/orchestrator'

export async function POST(req: NextRequest) {
  const { symbol } = await req.json() as { symbol: string }
  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const db = getDb()
  const { mode, safetyConfig } = getOrchestratorOptions()

  // Run analysis in background — respond immediately
  analyzeSymbol(symbol.toUpperCase(), db, mode, safetyConfig).catch(err =>
    console.error(`[analyze route] Error on ${symbol}:`, err)
  )

  return NextResponse.json({ started: true, symbol: symbol.toUpperCase(), mode })
}
```

- [ ] **Step 5: Commit**

```bash
cd /home/nullsec/Desktop/cl
git add app/api/stream/route.ts app/api/agents/route.ts app/api/portfolio/route.ts app/api/trading/analyze/route.ts
git commit -m "feat: API routes — SSE stream, agents, portfolio, trading analyze"
```

---

## Verification

Run the full test suite first:

```bash
cd /home/nullsec/Desktop/cl && ANTHROPIC_API_KEY=test npx vitest run 2>&1 | tail -10
```

Expected: All tests pass (55+ total across 11 test files).

Then start the Next.js dev server and test each route:

```bash
cd /home/nullsec/Desktop/cl
cp .env.local.example .env.local  # if not done yet — fill in real keys
ANTHROPIC_API_KEY=test npx next dev --port 3000 &
sleep 5

# Test home page
curl -s http://localhost:3000 | grep -o "Meridian Capital"

# Test agents endpoint
curl -s http://localhost:3000/api/agents | python3 -m json.tool | head -20

# Test portfolio endpoint
curl -s http://localhost:3000/api/portfolio | python3 -m json.tool

# Test SSE stream (should get "connected" event)
curl -s --max-time 3 http://localhost:3000/api/stream

# Test start orchestrator (simulation mode)
curl -s -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"action":"start","options":{"mode":"simulation","intervalMs":999999}}'

# Test on-demand analysis
curl -s -X POST http://localhost:3000/api/trading/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbol":"NVDA"}'

# Stop
kill %1
```

Expected for each:
- Home: "Meridian Capital"
- `/api/agents`: JSON with 6 agents
- `/api/portfolio`: JSON with portfolio and positions arrays
- `/api/stream`: `data: {"type":"connected"}`
- Start: `{"started":true,...}`
- Analyze: `{"started":true,"symbol":"NVDA",...}`
