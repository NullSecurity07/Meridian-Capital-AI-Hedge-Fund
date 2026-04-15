// lib/db.ts
import Database from 'better-sqlite3'
import type {
  Trade, AgentReport, AgentMemoryEntry,
  Portfolio, Position, AgentId, TradingMode, SafetyEvent, Agent
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

    CREATE TABLE IF NOT EXISTS benchmarks (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      current_price REAL NOT NULL,
      baseline_price REAL NOT NULL,
      change_pct REAL NOT NULL,
      return_since_baseline REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

export function insertTrade(
  db: Database.Database,
  trade: Omit<Trade, 'alpacaOrderId' | 'closedAt' | 'closePrice' | 'pAndL'> & Partial<Pick<Trade, 'alpacaOrderId'>>
): void {
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

export function getLatestReportsBySymbol(db: Database.Database, symbol: string, limit = 20): AgentReport[] {
  const rows = db.prepare(`
    SELECT * FROM agent_reports WHERE symbol = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(symbol, limit) as Record<string, unknown>[]
  return rows.map(r => ({
    id: r.id as string,
    agentId: r.agent_id as AgentId,
    symbol: r.symbol as string,
    reportType: r.report_type as AgentReport['reportType'],
    content: JSON.parse(r.content as string),
    conviction: r.conviction as import('@/types').ConvictionLevel | undefined,
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

export function getAgent(db: Database.Database, agentId: AgentId): Agent | undefined {
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

export interface BenchmarkRow {
  symbol: string; name: string
  currentPrice: number; baselinePrice: number
  changePct: number; returnSinceBaseline: number
  updatedAt: number
}

export function upsertBenchmark(db: Database.Database, b: BenchmarkRow): void {
  // Only set baselinePrice on first insert; preserve it on subsequent updates
  db.prepare(`
    INSERT INTO benchmarks (symbol, name, current_price, baseline_price, change_pct, return_since_baseline, updated_at)
    VALUES (@symbol, @name, @currentPrice, @baselinePrice, @changePct, @returnSinceBaseline, @updatedAt)
    ON CONFLICT(symbol) DO UPDATE SET
      name = @name,
      current_price = @currentPrice,
      change_pct = @changePct,
      return_since_baseline = (current_price - baseline_price) / baseline_price,
      updated_at = @updatedAt
  `).run(b)
}

export function getBenchmarks(db: Database.Database): BenchmarkRow[] {
  const rows = db.prepare('SELECT * FROM benchmarks ORDER BY symbol').all() as Record<string, unknown>[]
  return rows.map(r => ({
    symbol: r.symbol as string,
    name: r.name as string,
    currentPrice: r.current_price as number,
    baselinePrice: r.baseline_price as number,
    changePct: r.change_pct as number,
    returnSinceBaseline: r.return_since_baseline as number,
    updatedAt: r.updated_at as number,
  }))
}

export function logSafetyEvent(db: Database.Database, event: SafetyEvent): void {
  db.prepare(`
    INSERT INTO safety_events (id, event_type, details, created_at)
    VALUES (@id, @eventType, @details, @createdAt)
  `).run(event)
}
