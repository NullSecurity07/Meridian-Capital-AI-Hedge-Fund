// types/index.ts

export type TradingMode = 'simulation' | 'paper' | 'live'

export type AgentId = 'pm' | 'researcher' | 'quant' | 'risk' | 'macro' | 'trader'

export type TradeAction = 'BUY' | 'SELL'

export type TradeStatus = 'PENDING' | 'FILLED' | 'CANCELLED'

export type Recommendation = 'BUY' | 'SELL' | 'PASS' | 'HOLD'

export type AgentStatus = 'active' | 'thinking' | 'idle'

export type ConvictionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

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
  content: Record<string, unknown> // TODO Plan 2: narrow to discriminated union per reportType
  conviction?: ConvictionLevel
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
  earningsTimestamp?: number  // Unix ms of next earnings date (from Yahoo Finance)
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
  payload: Record<string, unknown> // TODO Plan 2: narrow to discriminated union per event type
  timestamp: number
}

export type SafetyEventType = 'kill_switch' | 'daily_loss_limit' | 'position_limit' | 'stop_loss'

export interface SafetyEvent {
  id: string
  eventType: SafetyEventType
  details: string
  createdAt: number
}
