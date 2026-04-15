// lib/agents/trader.ts
import { createAlpacaClient, submitOrder } from '@/lib/alpaca'
import { insertTrade, upsertPortfolio, getPortfolio, upsertPosition, getPositions } from '@/lib/db'
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
  safetyConfig: SafetyConfig,
  force = false // bypass kill switch for emergency stop-loss sells
): Promise<{ success: boolean; tradeId?: string; reason?: string }> {
  if (!force && isKillSwitchActive()) {
    return { success: false, reason: 'Kill switch is active — trading halted' }
  }

  const decision = pmDecision.content as Record<string, unknown>
  const action = decision.decision as string

  if (action !== 'BUY' && action !== 'SELL') {
    return { success: false, reason: `PM decision was ${action} — no trade needed` }
  }

  const portfolio = getPortfolio(db, mode === 'simulation' ? 'simulation' : mode)
  const availableCash = portfolio?.cash ?? safetyConfig.budget
  const totalValue = portfolio?.totalValue ?? safetyConfig.budget

  // For sells, use actual position size rather than PM-suggested size
  let positionSizeUsd: number
  if (action === 'SELL') {
    const positions = getPositions(db, mode)
    const existing = positions.find(p => p.symbol === pmDecision.symbol)
    positionSizeUsd = existing ? existing.quantity * currentPrice : 0
    if (positionSizeUsd <= 0) return { success: false, reason: `No position in ${pmDecision.symbol} to sell` }
  } else {
    positionSizeUsd = typeof decision.position_size_usd === 'number' ? decision.position_size_usd : 0
    if (positionSizeUsd <= 0) return { success: false, reason: 'Position size is zero — no trade' }

    const posCheck = checkPositionLimit(positionSizeUsd, totalValue, safetyConfig)
    if (!posCheck.allowed) return { success: false, reason: posCheck.reason }

    const budgetCheck = checkBudgetLimit(positionSizeUsd, availableCash)
    if (!budgetCheck.allowed) return { success: false, reason: budgetCheck.reason }
  }

  const quantity = action === 'SELL'
    ? (getPositions(db, mode).find(p => p.symbol === pmDecision.symbol)?.quantity ?? 0)
    : Math.floor(positionSizeUsd / currentPrice)

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

    // Update cash
    const newCash = availableCash - (action === 'BUY' ? total : -total)
    upsertPortfolio(db, {
      mode: 'simulation',
      budget: safetyConfig.budget,
      cash: newCash,
      totalValue,
      updatedAt: Date.now(),
    })

    // Track position
    const positions = getPositions(db, mode)
    const existing = positions.find(p => p.symbol === pmDecision.symbol)
    const posId = `simulation-${pmDecision.symbol}`

    if (action === 'BUY') {
      const newQty = (existing?.quantity ?? 0) + quantity
      const newAvgCost = existing
        ? (existing.avgCost * existing.quantity + currentPrice * quantity) / newQty
        : currentPrice
      upsertPosition(db, {
        id: posId,
        symbol: pmDecision.symbol,
        quantity: newQty,
        avgCost: newAvgCost,
        currentPrice,
        unrealizedPAndL: (currentPrice - newAvgCost) * newQty,
        mode: 'simulation',
        updatedAt: Date.now(),
      })
    } else {
      const newQty = Math.max(0, (existing?.quantity ?? 0) - quantity)
      upsertPosition(db, {
        id: posId,
        symbol: pmDecision.symbol,
        quantity: newQty,
        avgCost: existing?.avgCost ?? currentPrice,
        currentPrice,
        unrealizedPAndL: newQty > 0 ? (currentPrice - (existing?.avgCost ?? currentPrice)) * newQty : 0,
        mode: 'simulation',
        updatedAt: Date.now(),
      })
    }

    broadcast({ type: 'trade_executed', agentId: 'trader', payload: { tradeId, symbol: pmDecision.symbol, action, quantity, price: currentPrice, total, mode }, timestamp: Date.now() })
    return { success: true, tradeId }
  }

  // Paper / live — submit to Alpaca
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
