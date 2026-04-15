// lib/agents/trader.ts
import { createAlpacaClient, submitOrder } from '@/lib/alpaca'
import { insertTrade, upsertPortfolio, getPortfolio, upsertPosition, getPositions, getLastBuyTrade, insertAgentMemory } from '@/lib/db'
import { checkPositionLimit, checkBudgetLimit, isKillSwitchActive } from '@/lib/safety'
import { broadcast } from '@/lib/sse'
import type { AgentId, AgentReport, SafetyConfig, TradingMode } from '@/types'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

// Minimum hold time before allowing a non-forced SELL.
// Prevents the agents from thrashing positions on short-term noise.
const MIN_HOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

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
    // Enforce minimum hold time — prevents agents flip-flopping on noise.
    // force=true (stop-loss emergency) bypasses this check intentionally.
    if (!force) {
      const lastBuy = getLastBuyTrade(db, pmDecision.symbol, mode)
      if (lastBuy) {
        const heldMs = Date.now() - lastBuy.createdAt
        if (heldMs < MIN_HOLD_MS) {
          const heldHours = (heldMs / (1000 * 60 * 60)).toFixed(1)
          return { success: false, reason: `Minimum hold not met — bought ${heldHours}h ago (min 24h)` }
        }
      }
    }

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

      // ── Self-learning: write a closed-trade lesson for researcher + pm ──────
      // This is the feedback loop that makes agents improve over time.
      // The lesson is injected into the next analysis of this symbol via getAgentMemoryLessons().
      if (existing) {
        const pAndL = (currentPrice - existing.avgCost) * quantity
        const pAndLPct = ((currentPrice - existing.avgCost) / existing.avgCost * 100).toFixed(1)
        const won = pAndL > 0
        const outcomeStr = `SOLD at $${currentPrice.toFixed(2)} — P&L: ${pAndL >= 0 ? '+' : ''}$${pAndL.toFixed(2)} (${pAndLPct}%)`
        const lesson = won
          ? `${pmDecision.symbol}: Bought $${existing.avgCost.toFixed(2)}, sold $${currentPrice.toFixed(2)}, gained ${pAndLPct}%. Thesis worked — look for similar setups.`
          : `${pmDecision.symbol}: Bought $${existing.avgCost.toFixed(2)}, sold $${currentPrice.toFixed(2)}, lost ${pAndLPct}%. Avoid similar conditions or tighten stop loss next time.`

        for (const agentId of ['researcher', 'pm'] as AgentId[]) {
          insertAgentMemory(db, {
            id: randomUUID(),
            agentId,
            tradeId,
            symbol: pmDecision.symbol,
            prediction: `BUY at $${existing.avgCost.toFixed(2)}`,
            actualOutcome: outcomeStr,
            pAndL,
            lesson,
            createdAt: Date.now(),
          })
        }
      }
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
