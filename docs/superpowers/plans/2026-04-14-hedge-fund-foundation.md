# Meridian Capital — Foundation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete foundation layer — shared types, SQLite database, safety controls, Alpaca brokerage client, market data client, base Claude agent, and SSE broadcaster — so that Plans 2–4 have a stable, tested base to build on.

**Architecture:** Next.js 14 App Router monolith. All foundation code lives in `/lib`. Each module has a single responsibility and is tested independently with Vitest. No UI in this plan — pure backend/library code.

**Tech Stack:** Next.js 14, TypeScript, Vitest, better-sqlite3, @anthropic-ai/sdk, @alpacahq/alpaca-trade-api, yahoo-finance2

---

## File Map

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for Next.js |
| `types/index.ts` | All shared TypeScript interfaces and enums |
| `lib/db.ts` | SQLite schema creation + all query functions |
| `lib/safety.ts` | Kill switch, daily loss limit, position size checks |
| `lib/alpaca.ts` | Alpaca SDK wrapper — orders, positions, account |
| `lib/market-data.ts` | Yahoo Finance + Alpha Vantage data fetching |
| `lib/agents/base-agent.ts` | Claude API wrapper + memory injection |
| `lib/sse.ts` | In-memory SSE event broadcaster |
| `tests/db.test.ts` | DB tests |
| `tests/safety.test.ts` | Safety control tests |
| `tests/alpaca.test.ts` | Alpaca wrapper tests (mocked) |
| `tests/market-data.test.ts` | Market data tests (mocked) |
| `tests/base-agent.test.ts` | Base agent tests (mocked Claude) |
| `tests/sse.test.ts` | SSE broadcaster tests |

---

## Task 1: Install dependencies and configure project

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tsconfig.json` (if not present)

- [ ] **Step 1: Install all dependencies**

```bash
cd /home/nullsec/Desktop/cl
npm install next@14 react react-dom typescript @types/node @types/react @types/react-dom
npm install @anthropic-ai/sdk better-sqlite3 @types/better-sqlite3
npm install @alpacahq/alpaca-trade-api yahoo-finance2
npm install -D vitest @vitest/coverage-v8 vite-tsconfig-paths
```

- [ ] **Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
})
```

- [ ] **Step 3: Add test script to `package.json`**

Open `package.json` and ensure it contains:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "vite-tsconfig-paths": "^4.0.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Verify setup**

```bash
npx vitest run --reporter=verbose 2>&1 | head -20
```

Expected: "No test files found" — that's fine, we haven't written tests yet.

- [ ] **Step 6: Commit**

```bash
git init
git add package.json vitest.config.ts tsconfig.json
git commit -m "chore: project setup with Next.js 14, Vitest, and core dependencies"
```

---

## Task 2: Shared TypeScript types

**Files:**
- Create: `types/index.ts`

- [ ] **Step 1: Create `types/index.ts`**

```typescript
// types/index.ts

export type TradingMode = 'simulation' | 'paper' | 'live'

export type AgentId = 'pm' | 'researcher' | 'quant' | 'risk' | 'macro' | 'trader'

export type TradeAction = 'BUY' | 'SELL'

export type TradeStatus = 'PENDING' | 'FILLED' | 'CANCELLED'

export type Recommendation = 'BUY' | 'SELL' | 'PASS' | 'HOLD'

export type AgentStatus = 'active' | 'thinking' | 'idle'

export interface Agent {
  id: AgentId
  name: string
  role: string
  emoji: string
  accuracyScore: number
  totalPredictions: number
  correctPredictions: number
}

export interface Trade {
  id: string
  symbol: string
  action: TradeAction
  quantity: number
  price: number
  total: number
  status: TradeStatus
  mode: TradingMode
  alpacaOrderId?: string
  createdAt: number
  closedAt?: number
  closePrice?: number
  pAndL?: number
}

export interface AgentReport {
  id: string
  agentId: AgentId
  symbol: string
  reportType: 'research' | 'quant' | 'risk' | 'macro' | 'pm_decision'
  content: Record<string, unknown>
  conviction?: number // 1–10
  recommendation?: Recommendation
  createdAt: number
}

export interface AgentMemoryEntry {
  id: string
  agentId: AgentId
  tradeId: string
  symbol: string
  prediction: string
  actualOutcome: string
  pAndL: number
  lesson: string
  createdAt: number
}

export interface Portfolio {
  mode: TradingMode
  budget: number
  cash: number
  totalValue: number
  updatedAt: number
}

export interface Position {
  id: string
  symbol: string
  quantity: number
  avgCost: number
  currentPrice: number
  unrealizedPAndL: number
  mode: TradingMode
  updatedAt: number
}

export interface SafetyConfig {
  maxPositionPct: number   // e.g. 0.15 for 15%
  dailyLossLimitPct: number // e.g. 0.05 for 5%
  stopLossPct: number      // e.g. 0.08 for 8%
  budget: number
}

export interface Quote {
  symbol: string
  price: number
  change: number
  changePct: number
  volume: number
  marketCap?: number
  pe?: number
  timestamp: number
}

export interface OHLCVBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface CompanyInfo {
  symbol: string
  name: string
  sector: string
  industry: string
  description: string
  employees?: number
  website?: string
}

export interface NewsItem {
  title: string
  summary: string
  url: string
  publishedAt: number
  sentiment?: 'positive' | 'negative' | 'neutral'
}

export interface SSEEvent {
  type: 'agent_update' | 'trade_executed' | 'meeting_started' | 'decision_made' | 'kill_switch' | 'portfolio_update'
  agentId?: AgentId
  payload: Record<string, unknown>
  timestamp: number
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add shared TypeScript types"
```

---

## Task 3: SQLite database layer

**Files:**
- Create: `lib/db.ts`
- Create: `tests/db.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  initDb,
  insertTrade,
  getTradeById,
  updateTradeClose,
  insertAgentReport,
  getLatestReportsBySymbol,
  insertAgentMemory,
  getAgentMemoryLessons,
  updateAgentAccuracy,
  getAgent,
  upsertPortfolio,
  getPortfolio,
  upsertPosition,
  getPositions,
  logSafetyEvent,
} from '@/lib/db'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  initDb(db)
})

afterEach(() => {
  db.close()
})

describe('trades', () => {
  it('inserts and retrieves a trade', () => {
    const trade = {
      id: 'trade-1',
      symbol: 'NVDA',
      action: 'BUY' as const,
      quantity: 10,
      price: 127.40,
      total: 1274.00,
      status: 'PENDING' as const,
      mode: 'paper' as const,
      createdAt: Date.now(),
    }
    insertTrade(db, trade)
    const result = getTradeById(db, 'trade-1')
    expect(result?.symbol).toBe('NVDA')
    expect(result?.quantity).toBe(10)
    expect(result?.status).toBe('PENDING')
  })

  it('updates trade on close', () => {
    const trade = {
      id: 'trade-2',
      symbol: 'AAPL',
      action: 'BUY' as const,
      quantity: 5,
      price: 189.20,
      total: 946.00,
      status: 'FILLED' as const,
      mode: 'paper' as const,
      createdAt: Date.now(),
    }
    insertTrade(db, trade)
    const closedAt = Date.now()
    updateTradeClose(db, 'trade-2', { closedAt, closePrice: 200.00, pAndL: 54.00, status: 'FILLED' })
    const result = getTradeById(db, 'trade-2')
    expect(result?.closePrice).toBe(200.00)
    expect(result?.pAndL).toBe(54.00)
  })
})

describe('agent reports', () => {
  it('inserts and retrieves reports by symbol', () => {
    insertAgentReport(db, {
      id: 'report-1',
      agentId: 'researcher',
      symbol: 'NVDA',
      reportType: 'research',
      content: { summary: 'Strong AI demand' },
      conviction: 8,
      recommendation: 'BUY',
      createdAt: Date.now(),
    })
    const reports = getLatestReportsBySymbol(db, 'NVDA')
    expect(reports).toHaveLength(1)
    expect(reports[0].agentId).toBe('researcher')
    expect(reports[0].conviction).toBe(8)
  })
})

describe('agent memory', () => {
  it('stores and retrieves lessons', () => {
    insertAgentMemory(db, {
      id: 'mem-1',
      agentId: 'quant',
      tradeId: 'trade-1',
      symbol: 'NVDA',
      prediction: 'Price will rise 15% in 90 days',
      actualOutcome: 'Price rose 12% in 90 days',
      pAndL: 120.00,
      lesson: 'Monte Carlo was slightly optimistic; reduce upside target by 2-3% on high-vol stocks',
      createdAt: Date.now(),
    })
    const lessons = getAgentMemoryLessons(db, 'quant', 5)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toContain('Monte Carlo was slightly optimistic')
  })
})

describe('agent accuracy', () => {
  it('initializes and updates accuracy score', () => {
    updateAgentAccuracy(db, 'researcher', true)
    updateAgentAccuracy(db, 'researcher', false)
    updateAgentAccuracy(db, 'researcher', true)
    const agent = getAgent(db, 'researcher')
    expect(agent?.totalPredictions).toBe(3)
    expect(agent?.correctPredictions).toBe(2)
    expect(agent?.accuracyScore).toBeCloseTo(0.667, 2)
  })
})

describe('portfolio', () => {
  it('upserts and reads portfolio state', () => {
    upsertPortfolio(db, {
      mode: 'paper',
      budget: 25000,
      cash: 23000,
      totalValue: 25500,
      updatedAt: Date.now(),
    })
    const p = getPortfolio(db, 'paper')
    expect(p?.budget).toBe(25000)
    expect(p?.cash).toBe(23000)
  })
})

describe('positions', () => {
  it('upserts and reads positions', () => {
    upsertPosition(db, {
      id: 'pos-nvda',
      symbol: 'NVDA',
      quantity: 10,
      avgCost: 127.40,
      currentPrice: 130.00,
      unrealizedPAndL: 26.00,
      mode: 'paper',
      updatedAt: Date.now(),
    })
    const positions = getPositions(db, 'paper')
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('NVDA')
    expect(positions[0].unrealizedPAndL).toBe(26.00)
  })
})

describe('safety events', () => {
  it('logs safety events', () => {
    expect(() =>
      logSafetyEvent(db, {
        id: 'ev-1',
        eventType: 'kill_switch',
        details: 'Manual kill switch activated',
        createdAt: Date.now(),
      })
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/db.test.ts 2>&1 | tail -20
```

Expected: FAIL — "Cannot find module '@/lib/db'"

- [ ] **Step 3: Implement `lib/db.ts`**

```typescript
// lib/db.ts
import Database from 'better-sqlite3'
import type {
  Trade, AgentReport, AgentMemoryEntry,
  Portfolio, Position, AgentId, TradingMode
} from '@/types'

export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      emoji TEXT NOT NULL,
      accuracy_score REAL DEFAULT 0.5,
      total_predictions INTEGER DEFAULT 0,
      correct_predictions INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO agents VALUES ('pm',         'Morgan', 'Portfolio Manager', '🧠', 0.5, 0, 0);
    INSERT OR IGNORE INTO agents VALUES ('researcher', 'Alex',   'Research Analyst',  '🧑‍💻', 0.5, 0, 0);
    INSERT OR IGNORE INTO agents VALUES ('quant',      'Sam',    'Quant Analyst',     '📊', 0.5, 0, 0);
    INSERT OR IGNORE INTO agents VALUES ('risk',       'Drew',   'Risk Manager',      '⚠️', 0.5, 0, 0);
    INSERT OR IGNORE INTO agents VALUES ('macro',      'Jordan', 'Macro Strategist',  '🌍', 0.5, 0, 0);
    INSERT OR IGNORE INTO agents VALUES ('trader',     'Riley',  'Trader',            '💹', 0.5, 0, 0);

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      alpaca_order_id TEXT,
      created_at INTEGER NOT NULL,
      closed_at INTEGER,
      close_price REAL,
      p_and_l REAL
    );

    CREATE TABLE IF NOT EXISTS agent_reports (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      report_type TEXT NOT NULL,
      content TEXT NOT NULL,
      conviction INTEGER,
      recommendation TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      trade_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      prediction TEXT NOT NULL,
      actual_outcome TEXT NOT NULL,
      p_and_l REAL NOT NULL,
      lesson TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      mode TEXT PRIMARY KEY,
      budget REAL NOT NULL,
      cash REAL NOT NULL,
      total_value REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      quantity REAL NOT NULL,
      avg_cost REAL NOT NULL,
      current_price REAL NOT NULL,
      unrealized_p_and_l REAL NOT NULL,
      mode TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS safety_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
}

export function insertTrade(db: Database.Database, trade: Omit<Trade, 'alpacaOrderId' | 'closedAt' | 'closePrice' | 'pAndL'> & Partial<Pick<Trade, 'alpacaOrderId'>>): void {
  db.prepare(`
    INSERT INTO trades (id, symbol, action, quantity, price, total, status, mode, alpaca_order_id, created_at)
    VALUES (@id, @symbol, @action, @quantity, @price, @total, @status, @mode, @alpacaOrderId, @createdAt)
  `).run({ ...trade, alpacaOrderId: trade.alpacaOrderId ?? null })
}

export function getTradeById(db: Database.Database, id: string): Trade | undefined {
  const row = db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return undefined
  return mapTradeRow(row)
}

export function updateTradeClose(
  db: Database.Database,
  id: string,
  update: { closedAt: number; closePrice: number; pAndL: number; status: Trade['status'] }
): void {
  db.prepare(`
    UPDATE trades SET closed_at = ?, close_price = ?, p_and_l = ?, status = ? WHERE id = ?
  `).run(update.closedAt, update.closePrice, update.pAndL, update.status, id)
}

function mapTradeRow(row: Record<string, unknown>): Trade {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    action: row.action as Trade['action'],
    quantity: row.quantity as number,
    price: row.price as number,
    total: row.total as number,
    status: row.status as Trade['status'],
    mode: row.mode as Trade['mode'],
    alpacaOrderId: row.alpaca_order_id as string | undefined,
    createdAt: row.created_at as number,
    closedAt: row.closed_at as number | undefined,
    closePrice: row.close_price as number | undefined,
    pAndL: row.p_and_l as number | undefined,
  }
}

export function insertAgentReport(db: Database.Database, report: AgentReport): void {
  db.prepare(`
    INSERT INTO agent_reports (id, agent_id, symbol, report_type, content, conviction, recommendation, created_at)
    VALUES (@id, @agentId, @symbol, @reportType, @content, @conviction, @recommendation, @createdAt)
  `).run({
    ...report,
    content: JSON.stringify(report.content),
    conviction: report.conviction ?? null,
    recommendation: report.recommendation ?? null,
  })
}

export function getLatestReportsBySymbol(db: Database.Database, symbol: string): AgentReport[] {
  const rows = db.prepare(`
    SELECT * FROM agent_reports WHERE symbol = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(symbol) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as string,
    agentId: r.agent_id as AgentId,
    symbol: r.symbol as string,
    reportType: r.report_type as AgentReport['reportType'],
    content: JSON.parse(r.content as string),
    conviction: r.conviction as number | undefined,
    recommendation: r.recommendation as AgentReport['recommendation'],
    createdAt: r.created_at as number,
  }))
}

export function insertAgentMemory(db: Database.Database, entry: AgentMemoryEntry): void {
  db.prepare(`
    INSERT INTO agent_memory (id, agent_id, trade_id, symbol, prediction, actual_outcome, p_and_l, lesson, created_at)
    VALUES (@id, @agentId, @tradeId, @symbol, @prediction, @actualOutcome, @pAndL, @lesson, @createdAt)
  `).run(entry)
}

export function getAgentMemoryLessons(db: Database.Database, agentId: AgentId, limit: number): string[] {
  const rows = db.prepare(`
    SELECT lesson FROM agent_memory WHERE agent_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(agentId, limit) as { lesson: string }[]
  return rows.map(r => r.lesson)
}

export function updateAgentAccuracy(db: Database.Database, agentId: AgentId, correct: boolean): void {
  db.prepare(`
    UPDATE agents
    SET total_predictions = total_predictions + 1,
        correct_predictions = correct_predictions + ?,
        accuracy_score = CAST(correct_predictions + ? AS REAL) / (total_predictions + 1)
    WHERE id = ?
  `).run(correct ? 1 : 0, correct ? 1 : 0, agentId)
}

export function getAgent(db: Database.Database, agentId: AgentId) {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: row.id as AgentId,
    name: row.name as string,
    role: row.role as string,
    emoji: row.emoji as string,
    accuracyScore: row.accuracy_score as number,
    totalPredictions: row.total_predictions as number,
    correctPredictions: row.correct_predictions as number,
  }
}

export function upsertPortfolio(db: Database.Database, portfolio: Portfolio): void {
  db.prepare(`
    INSERT INTO portfolio (mode, budget, cash, total_value, updated_at)
    VALUES (@mode, @budget, @cash, @totalValue, @updatedAt)
    ON CONFLICT(mode) DO UPDATE SET
      budget = @budget, cash = @cash, total_value = @totalValue, updated_at = @updatedAt
  `).run(portfolio)
}

export function getPortfolio(db: Database.Database, mode: TradingMode): Portfolio | undefined {
  const row = db.prepare('SELECT * FROM portfolio WHERE mode = ?').get(mode) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    mode: row.mode as TradingMode,
    budget: row.budget as number,
    cash: row.cash as number,
    totalValue: row.total_value as number,
    updatedAt: row.updated_at as number,
  }
}

export function upsertPosition(db: Database.Database, position: Position): void {
  db.prepare(`
    INSERT INTO positions (id, symbol, quantity, avg_cost, current_price, unrealized_p_and_l, mode, updated_at)
    VALUES (@id, @symbol, @quantity, @avgCost, @currentPrice, @unrealizedPAndL, @mode, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      quantity = @quantity, avg_cost = @avgCost, current_price = @currentPrice,
      unrealized_p_and_l = @unrealizedPAndL, updated_at = @updatedAt
  `).run(position)
}

export function getPositions(db: Database.Database, mode: TradingMode): Position[] {
  const rows = db.prepare('SELECT * FROM positions WHERE mode = ? AND quantity > 0').all(mode) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as string,
    symbol: r.symbol as string,
    quantity: r.quantity as number,
    avgCost: r.avg_cost as number,
    currentPrice: r.current_price as number,
    unrealizedPAndL: r.unrealized_p_and_l as number,
    mode: r.mode as TradingMode,
    updatedAt: r.updated_at as number,
  }))
}

export function logSafetyEvent(
  db: Database.Database,
  event: { id: string; eventType: string; details: string; createdAt: number }
): void {
  db.prepare(`
    INSERT INTO safety_events (id, event_type, details, created_at)
    VALUES (@id, @eventType, @details, @createdAt)
  `).run(event)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/db.test.ts --reporter=verbose
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/db.test.ts
git commit -m "feat: SQLite database layer with schema and query functions"
```

---

## Task 4: Safety controls

**Files:**
- Create: `lib/safety.ts`
- Create: `tests/safety.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/safety.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkPositionLimit,
  checkDailyLossLimit,
  checkBudgetLimit,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
} from '@/lib/safety'
import type { SafetyConfig } from '@/types'

const config: SafetyConfig = {
  maxPositionPct: 0.15,
  dailyLossLimitPct: 0.05,
  stopLossPct: 0.08,
  budget: 25000,
}

beforeEach(() => {
  deactivateKillSwitch()
})

describe('checkPositionLimit', () => {
  it('allows position within 15% of portfolio', () => {
    const result = checkPositionLimit(3000, 25000, config)
    expect(result.allowed).toBe(true)
  })

  it('blocks position exceeding 15% of portfolio', () => {
    const result = checkPositionLimit(4000, 25000, config)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/15%/)
  })

  it('allows position exactly at 15%', () => {
    const result = checkPositionLimit(3750, 25000, config)
    expect(result.allowed).toBe(true)
  })
})

describe('checkDailyLossLimit', () => {
  it('returns not triggered when loss is below 5%', () => {
    const result = checkDailyLossLimit(25000, 24000, config)
    expect(result.triggered).toBe(false)
  })

  it('triggers when loss is exactly 5%', () => {
    const result = checkDailyLossLimit(25000, 23750, config)
    expect(result.triggered).toBe(true)
    expect(result.reason).toMatch(/5%/)
  })

  it('triggers when loss exceeds 5%', () => {
    const result = checkDailyLossLimit(25000, 23000, config)
    expect(result.triggered).toBe(true)
  })

  it('returns not triggered when portfolio is up', () => {
    const result = checkDailyLossLimit(25000, 26000, config)
    expect(result.triggered).toBe(false)
  })
})

describe('checkBudgetLimit', () => {
  it('allows trade within remaining cash', () => {
    const result = checkBudgetLimit(2000, 5000)
    expect(result.allowed).toBe(true)
  })

  it('blocks trade exceeding remaining cash', () => {
    const result = checkBudgetLimit(6000, 5000)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/cash/)
  })
})

describe('kill switch', () => {
  it('starts inactive', () => {
    expect(isKillSwitchActive()).toBe(false)
  })

  it('activates and deactivates', () => {
    activateKillSwitch('test')
    expect(isKillSwitchActive()).toBe(true)
    deactivateKillSwitch()
    expect(isKillSwitchActive()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/safety.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/safety'"

- [ ] **Step 3: Implement `lib/safety.ts`**

```typescript
// lib/safety.ts
import type { SafetyConfig } from '@/types'

let killSwitchActive = false

export function isKillSwitchActive(): boolean {
  return killSwitchActive
}

export function activateKillSwitch(reason: string): void {
  killSwitchActive = true
  console.error(`[KILL SWITCH ACTIVATED] ${reason}`)
}

export function deactivateKillSwitch(): void {
  killSwitchActive = false
}

export function checkPositionLimit(
  proposedTradeValue: number,
  totalPortfolioValue: number,
  config: SafetyConfig
): { allowed: boolean; reason?: string } {
  const maxAllowed = totalPortfolioValue * config.maxPositionPct
  if (proposedTradeValue > maxAllowed) {
    return {
      allowed: false,
      reason: `Position value $${proposedTradeValue.toFixed(2)} exceeds max 15% of portfolio ($${maxAllowed.toFixed(2)})`,
    }
  }
  return { allowed: true }
}

export function checkDailyLossLimit(
  startOfDayValue: number,
  currentValue: number,
  config: SafetyConfig
): { triggered: boolean; reason?: string } {
  const lossPct = (startOfDayValue - currentValue) / startOfDayValue
  if (lossPct >= config.dailyLossLimitPct) {
    return {
      triggered: true,
      reason: `Daily loss of ${(lossPct * 100).toFixed(1)}% exceeds 5% limit. Kill switch required.`,
    }
  }
  return { triggered: false }
}

export function checkBudgetLimit(
  proposedTradeValue: number,
  availableCash: number
): { allowed: boolean; reason?: string } {
  if (proposedTradeValue > availableCash) {
    return {
      allowed: false,
      reason: `Trade value $${proposedTradeValue.toFixed(2)} exceeds available cash $${availableCash.toFixed(2)}`,
    }
  }
  return { allowed: true }
}

export function calculateStopLossPrice(entryPrice: number, config: SafetyConfig): number {
  return entryPrice * (1 - config.stopLossPct)
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/safety.test.ts --reporter=verbose
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/safety.ts tests/safety.test.ts
git commit -m "feat: safety controls — position limits, daily loss kill switch, budget cap"
```

---

## Task 5: Alpaca brokerage wrapper

**Files:**
- Create: `lib/alpaca.ts`
- Create: `tests/alpaca.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/alpaca.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAlpacaClient,
  submitOrder,
  getPositions,
  getAccountCash,
  cancelAllOrders,
} from '@/lib/alpaca'

// Mock the Alpaca SDK
vi.mock('@alpacahq/alpaca-trade-api', () => {
  const MockAlpaca = vi.fn().mockImplementation(() => ({
    createOrder: vi.fn().mockResolvedValue({
      id: 'order-abc-123',
      symbol: 'NVDA',
      qty: '10',
      side: 'buy',
      type: 'market',
      status: 'pending_new',
    }),
    getPositions: vi.fn().mockResolvedValue([
      {
        symbol: 'AAPL',
        qty: '5',
        avg_entry_price: '189.20',
        current_price: '195.00',
        unrealized_pl: '29.00',
      },
    ]),
    getAccount: vi.fn().mockResolvedValue({
      cash: '22000.50',
      portfolio_value: '25500.00',
    }),
    cancelAllOrders: vi.fn().mockResolvedValue([]),
  }))
  return { default: MockAlpaca }
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ALPACA_PAPER_KEY = 'test-key'
  process.env.ALPACA_PAPER_SECRET = 'test-secret'
  process.env.ALPACA_LIVE_KEY = 'live-key'
  process.env.ALPACA_LIVE_SECRET = 'live-secret'
})

describe('createAlpacaClient', () => {
  it('creates a paper client', () => {
    const client = createAlpacaClient('paper')
    expect(client).toBeDefined()
  })

  it('creates a live client', () => {
    const client = createAlpacaClient('live')
    expect(client).toBeDefined()
  })
})

describe('submitOrder', () => {
  it('submits a market buy order', async () => {
    const client = createAlpacaClient('paper')
    const order = await submitOrder(client, 'NVDA', 10, 'buy', 'market')
    expect(order.alpacaOrderId).toBe('order-abc-123')
    expect(order.symbol).toBe('NVDA')
    expect(order.status).toBe('PENDING')
  })
})

describe('getPositions', () => {
  it('returns mapped positions', async () => {
    const client = createAlpacaClient('paper')
    const positions = await getPositions(client, 'paper')
    expect(positions).toHaveLength(1)
    expect(positions[0].symbol).toBe('AAPL')
    expect(positions[0].quantity).toBe(5)
    expect(positions[0].unrealizedPAndL).toBe(29.00)
  })
})

describe('getAccountCash', () => {
  it('returns cash balance', async () => {
    const client = createAlpacaClient('paper')
    const cash = await getAccountCash(client)
    expect(cash).toBe(22000.50)
  })
})

describe('cancelAllOrders', () => {
  it('cancels without throwing', async () => {
    const client = createAlpacaClient('paper')
    await expect(cancelAllOrders(client)).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/alpaca.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/alpaca'"

- [ ] **Step 3: Implement `lib/alpaca.ts`**

```typescript
// lib/alpaca.ts
import Alpaca from '@alpacahq/alpaca-trade-api'
import type { Position, TradingMode } from '@/types'
import { randomUUID } from 'crypto'

type AlpacaClient = InstanceType<typeof Alpaca>

export function createAlpacaClient(mode: 'paper' | 'live'): AlpacaClient {
  if (mode === 'paper') {
    return new Alpaca({
      keyId: process.env.ALPACA_PAPER_KEY!,
      secretKey: process.env.ALPACA_PAPER_SECRET!,
      paper: true,
    })
  }
  return new Alpaca({
    keyId: process.env.ALPACA_LIVE_KEY!,
    secretKey: process.env.ALPACA_LIVE_SECRET!,
    paper: false,
  })
}

export async function submitOrder(
  client: AlpacaClient,
  symbol: string,
  qty: number,
  side: 'buy' | 'sell',
  type: 'market' | 'limit',
  limitPrice?: number
): Promise<{ alpacaOrderId: string; symbol: string; status: 'PENDING' }> {
  const order = await client.createOrder({
    symbol,
    qty: String(qty),
    side,
    type,
    time_in_force: 'day',
    ...(type === 'limit' && limitPrice ? { limit_price: String(limitPrice) } : {}),
  })
  return {
    alpacaOrderId: order.id,
    symbol: order.symbol,
    status: 'PENDING',
  }
}

export async function getPositions(client: AlpacaClient, mode: TradingMode): Promise<Position[]> {
  const raw = await client.getPositions()
  const now = Date.now()
  return raw.map((p: Record<string, string>) => ({
    id: `${p.symbol}-${mode}`,
    symbol: p.symbol,
    quantity: parseFloat(p.qty),
    avgCost: parseFloat(p.avg_entry_price),
    currentPrice: parseFloat(p.current_price),
    unrealizedPAndL: parseFloat(p.unrealized_pl),
    mode,
    updatedAt: now,
  }))
}

export async function getAccountCash(client: AlpacaClient): Promise<number> {
  const account = await client.getAccount()
  return parseFloat(account.cash)
}

export async function cancelAllOrders(client: AlpacaClient): Promise<void> {
  await client.cancelAllOrders()
}
```

- [ ] **Step 4: Create `.env.local` template**

```bash
cat > .env.local.example << 'EOF'
# Alpaca — paper trading (safe, no real money)
ALPACA_PAPER_KEY=your_paper_key_here
ALPACA_PAPER_SECRET=your_paper_secret_here

# Alpaca — live trading (real money — leave blank until ready)
ALPACA_LIVE_KEY=
ALPACA_LIVE_SECRET=

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key_here

# Alpha Vantage (free tier)
ALPHA_VANTAGE_KEY=your_alpha_vantage_key_here

# App
TRADING_MODE=paper
EOF
```

- [ ] **Step 5: Run tests — verify pass**

```bash
npx vitest run tests/alpaca.test.ts --reporter=verbose
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/alpaca.ts tests/alpaca.test.ts .env.local.example
git commit -m "feat: Alpaca brokerage wrapper for paper and live trading"
```

---

## Task 6: Market data client

**Files:**
- Create: `lib/market-data.ts`
- Create: `tests/market-data.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/market-data.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { getQuote, getHistoricalBars, getNewsHeadlines } from '@/lib/market-data'

vi.mock('yahoo-finance2', () => ({
  default: {
    quote: vi.fn().mockResolvedValue({
      symbol: 'NVDA',
      regularMarketPrice: 127.40,
      regularMarketChange: 2.90,
      regularMarketChangePercent: 2.33,
      regularMarketVolume: 45000000,
      marketCap: 3100000000000,
      trailingPE: 34.2,
    }),
    historical: vi.fn().mockResolvedValue([
      { date: new Date('2026-04-10'), open: 125, high: 129, low: 124, close: 127.40, volume: 45000000 },
      { date: new Date('2026-04-09'), open: 122, high: 126, low: 121, close: 125, volume: 42000000 },
    ]),
  },
}))

global.fetch = vi.fn().mockResolvedValue({
  json: vi.fn().mockResolvedValue({
    feed: [
      {
        title: 'NVIDIA crushes earnings expectations',
        summary: 'Revenue up 78% year over year driven by AI chip demand.',
        url: 'https://example.com/nvda',
        time_published: '20260414T093000',
        overall_sentiment_label: 'Bullish',
      },
    ],
  }),
}) as unknown as typeof fetch

describe('getQuote', () => {
  it('returns a mapped quote', async () => {
    const quote = await getQuote('NVDA')
    expect(quote.symbol).toBe('NVDA')
    expect(quote.price).toBe(127.40)
    expect(quote.changePct).toBeCloseTo(2.33, 1)
    expect(quote.pe).toBeCloseTo(34.2, 1)
  })
})

describe('getHistoricalBars', () => {
  it('returns OHLCV bars sorted oldest first', async () => {
    const bars = await getHistoricalBars('NVDA', '2026-04-09', '2026-04-10')
    expect(bars).toHaveLength(2)
    expect(bars[0].date).toBe('2026-04-09')
    expect(bars[1].close).toBe(127.40)
  })
})

describe('getNewsHeadlines', () => {
  it('returns mapped news items', async () => {
    process.env.ALPHA_VANTAGE_KEY = 'test'
    const news = await getNewsHeadlines('NVDA')
    expect(news).toHaveLength(1)
    expect(news[0].title).toContain('NVIDIA')
    expect(news[0].sentiment).toBe('positive')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/market-data.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/market-data'"

- [ ] **Step 3: Implement `lib/market-data.ts`**

```typescript
// lib/market-data.ts
import yahooFinance from 'yahoo-finance2'
import type { Quote, OHLCVBar, NewsItem } from '@/types'

export async function getQuote(symbol: string): Promise<Quote> {
  const raw = await yahooFinance.quote(symbol)
  return {
    symbol: raw.symbol,
    price: raw.regularMarketPrice ?? 0,
    change: raw.regularMarketChange ?? 0,
    changePct: raw.regularMarketChangePercent ?? 0,
    volume: raw.regularMarketVolume ?? 0,
    marketCap: raw.marketCap,
    pe: raw.trailingPE,
    timestamp: Date.now(),
  }
}

export async function getHistoricalBars(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<OHLCVBar[]> {
  const raw = await yahooFinance.historical(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
  })
  return raw
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(bar => ({
      date: new Date(bar.date).toISOString().split('T')[0],
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }))
}

export async function getNewsHeadlines(symbol: string): Promise<NewsItem[]> {
  const apiKey = process.env.ALPHA_VANTAGE_KEY
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${symbol}&limit=10&apikey=${apiKey}`
  const res = await fetch(url)
  const data = await res.json() as { feed?: Record<string, string>[] }
  if (!data.feed) return []
  return data.feed.map(item => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    publishedAt: parseAlphaVantageDate(item.time_published),
    sentiment: mapSentiment(item.overall_sentiment_label),
  }))
}

function parseAlphaVantageDate(str: string): number {
  // Format: "20260414T093000"
  const iso = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}T${str.slice(9, 11)}:${str.slice(11, 13)}:${str.slice(13, 15)}Z`
  return new Date(iso).getTime()
}

function mapSentiment(label: string): NewsItem['sentiment'] {
  const l = label?.toLowerCase() ?? ''
  if (l.includes('bull') || l.includes('positive')) return 'positive'
  if (l.includes('bear') || l.includes('negative')) return 'negative'
  return 'neutral'
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/market-data.test.ts --reporter=verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/market-data.ts tests/market-data.test.ts
git commit -m "feat: market data client — Yahoo Finance quotes/history, Alpha Vantage news"
```

---

## Task 7: Base agent (Claude API + memory injection)

**Files:**
- Create: `lib/agents/base-agent.ts`
- Create: `tests/base-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/base-agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  buildSystemPromptWithMemory,
  runAgent,
} from '@/lib/agents/base-agent'

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'NVDA looks strong. BUY recommendation with conviction 8/10.' }],
        usage: { input_tokens: 120, output_tokens: 45 },
      }),
    },
  }))
  return { default: MockAnthropic, Anthropic: MockAnthropic }
})

describe('buildSystemPromptWithMemory', () => {
  it('returns base prompt unchanged when no lessons', () => {
    const base = 'You are a researcher.'
    const result = buildSystemPromptWithMemory(base, [])
    expect(result).toBe(base)
  })

  it('appends lessons section when lessons exist', () => {
    const base = 'You are a researcher.'
    const lessons = ['Watch for high IV before earnings', 'Semis rotate with rates']
    const result = buildSystemPromptWithMemory(base, lessons)
    expect(result).toContain('Past lessons from your trade history')
    expect(result).toContain('Watch for high IV before earnings')
    expect(result).toContain('Semis rotate with rates')
  })
})

describe('runAgent', () => {
  it('calls Claude and returns a response', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const config = {
      id: 'researcher' as const,
      name: 'Alex',
      role: 'Research Analyst',
      systemPrompt: 'You are a research analyst at a hedge fund.',
    }
    const response = await runAgent(
      config,
      [{ role: 'user', content: 'Analyze NVDA' }],
      []
    )
    expect(response.content).toContain('NVDA')
    expect(response.usage.inputTokens).toBe(120)
    expect(response.usage.outputTokens).toBe(45)
  })

  it('injects lessons into the system prompt when provided', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const config = {
      id: 'quant' as const,
      name: 'Sam',
      role: 'Quant Analyst',
      systemPrompt: 'You are a quant analyst.',
    }
    const lessons = ['RSI > 70 on semis often precedes pullback']
    // Should not throw
    const response = await runAgent(
      config,
      [{ role: 'user', content: 'Analyze NVDA technicals' }],
      lessons
    )
    expect(response.content).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/base-agent.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/agents/base-agent'"

- [ ] **Step 3: Implement `lib/agents/base-agent.ts`**

```typescript
// lib/agents/base-agent.ts
import Anthropic from '@anthropic-ai/sdk'
import type { AgentId } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AgentConfig {
  id: AgentId
  name: string
  role: string
  systemPrompt: string
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

export function buildSystemPromptWithMemory(
  basePrompt: string,
  lessons: string[]
): string {
  if (lessons.length === 0) return basePrompt
  const lessonsBlock = lessons.map((l, i) => `${i + 1}. ${l}`).join('\n')
  return `${basePrompt}\n\n---\nPast lessons from your trade history (use these to improve your analysis):\n${lessonsBlock}`
}

export async function runAgent(
  config: AgentConfig,
  messages: AgentMessage[],
  memoryLessons: string[]
): Promise<AgentResponse> {
  const systemPrompt = buildSystemPromptWithMemory(config.systemPrompt, memoryLessons)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const textBlock = response.content.find(b => b.type === 'text')
  const content = textBlock?.type === 'text' ? textBlock.text : ''

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/base-agent.test.ts --reporter=verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/base-agent.ts tests/base-agent.test.ts
git commit -m "feat: base agent with Claude API wrapper and memory injection"
```

---

## Task 8: SSE broadcaster

**Files:**
- Create: `lib/sse.ts`
- Create: `tests/sse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/sse.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { broadcast, subscribe, unsubscribe } from '@/lib/sse'
import type { SSEEvent } from '@/types'

describe('SSE broadcaster', () => {
  it('delivers events to a subscriber', () => {
    const received: SSEEvent[] = []
    const id = subscribe(event => received.push(event))

    const event: SSEEvent = {
      type: 'agent_update',
      agentId: 'researcher',
      payload: { status: 'active', task: 'Scanning NVDA news' },
      timestamp: Date.now(),
    }
    broadcast(event)

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('agent_update')
    expect(received[0].agentId).toBe('researcher')

    unsubscribe(id)
  })

  it('does not deliver to unsubscribed listeners', () => {
    const received: SSEEvent[] = []
    const id = subscribe(event => received.push(event))
    unsubscribe(id)

    broadcast({
      type: 'trade_executed',
      payload: { symbol: 'NVDA' },
      timestamp: Date.now(),
    })

    expect(received).toHaveLength(0)
  })

  it('delivers to multiple subscribers', () => {
    const a: SSEEvent[] = []
    const b: SSEEvent[] = []
    const id1 = subscribe(e => a.push(e))
    const id2 = subscribe(e => b.push(e))

    broadcast({ type: 'kill_switch', payload: {}, timestamp: Date.now() })

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)

    unsubscribe(id1)
    unsubscribe(id2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run tests/sse.test.ts 2>&1 | tail -10
```

Expected: FAIL — "Cannot find module '@/lib/sse'"

- [ ] **Step 3: Implement `lib/sse.ts`**

```typescript
// lib/sse.ts
import type { SSEEvent } from '@/types'
import { randomUUID } from 'crypto'

type Listener = (event: SSEEvent) => void

const listeners = new Map<string, Listener>()

export function subscribe(listener: Listener): string {
  const id = randomUUID()
  listeners.set(id, listener)
  return id
}

export function unsubscribe(id: string): void {
  listeners.delete(id)
}

export function broadcast(event: SSEEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event)
    } catch {
      // Never let one bad listener break others
    }
  }
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run tests/sse.test.ts --reporter=verbose
```

Expected: All 3 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose
```

Expected: All tests across all test files PASS. Count should be 30+ passing tests.

- [ ] **Step 6: Commit**

```bash
git add lib/sse.ts tests/sse.test.ts
git commit -m "feat: SSE broadcaster for real-time agent activity streaming"
```

---

## Verification

After completing all 8 tasks, verify the full foundation:

```bash
# All tests pass
npx vitest run --reporter=verbose

# TypeScript is clean
npx tsc --noEmit

# File structure is correct
ls lib/ lib/agents/ tests/ types/
```

Expected output from `ls`:
```
lib/: alpaca.ts  agents/  db.ts  market-data.ts  safety.ts  sse.ts
lib/agents/: base-agent.ts
tests/: alpaca.test.ts  base-agent.test.ts  db.test.ts  market-data.test.ts  safety.test.ts  sse.test.ts
types/: index.ts
```

Copy `.env.local.example` to `.env.local` and fill in your keys before starting Plan 2:
```bash
cp .env.local.example .env.local
# Edit .env.local — add your Alpaca paper key and Anthropic API key
```

**Plan 2** builds the 6 agents, orchestrator, and API routes on top of this foundation.
**Plan 3** builds the full React dashboard UI.
**Plan 4** adds simulation mode and self-learning.
