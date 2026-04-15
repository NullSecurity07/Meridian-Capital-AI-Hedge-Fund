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
