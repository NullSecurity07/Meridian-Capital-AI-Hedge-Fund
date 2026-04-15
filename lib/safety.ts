import type { SafetyConfig } from '@/types'

// Pin to globalThis so Next.js HMR never silently resets the kill switch
const g = globalThis as typeof globalThis & { _killSwitchActive?: boolean }
if (g._killSwitchActive === undefined) g._killSwitchActive = false

export function isKillSwitchActive(): boolean {
  return g._killSwitchActive!
}

export function activateKillSwitch(reason: string): void {
  g._killSwitchActive = true
  console.error(`[KILL SWITCH ACTIVATED] ${reason}`)
}

export function deactivateKillSwitch(reason = 'Manual deactivation'): void {
  g._killSwitchActive = false
  console.info(`[KILL SWITCH DEACTIVATED] ${reason}`)
}

export function checkPositionLimit(
  proposedTradeValue: number,
  totalPortfolioValue: number,
  config: SafetyConfig
): { allowed: boolean; reason?: string } {
  if (!isFinite(proposedTradeValue) || !isFinite(totalPortfolioValue) || totalPortfolioValue <= 0) {
    return { allowed: false, reason: 'Invalid input: values must be finite positive numbers' }
  }
  const maxAllowed = totalPortfolioValue * config.maxPositionPct
  if (proposedTradeValue > maxAllowed) {
    return {
      allowed: false,
      reason: `Position value $${proposedTradeValue.toFixed(2)} exceeds max ${(config.maxPositionPct * 100).toFixed(0)}% of portfolio ($${maxAllowed.toFixed(2)})`,
    }
  }
  return { allowed: true }
}

export function checkDailyLossLimit(
  startOfDayValue: number,
  currentValue: number,
  config: SafetyConfig
): { triggered: boolean; reason?: string } {
  if (startOfDayValue <= 0) return { triggered: false }
  const lossPct = (startOfDayValue - currentValue) / startOfDayValue
  if (lossPct >= config.dailyLossLimitPct) {
    const reason = `Daily loss of ${(lossPct * 100).toFixed(1)}% exceeds ${(config.dailyLossLimitPct * 100).toFixed(0)}% limit. Kill switch activated.`
    activateKillSwitch(reason)
    return { triggered: true, reason }
  }
  return { triggered: false }
}

export function checkBudgetLimit(
  proposedTradeValue: number,
  availableCash: number
): { allowed: boolean; reason?: string } {
  if (!isFinite(proposedTradeValue) || !isFinite(availableCash) || availableCash < 0) {
    return { allowed: false, reason: 'Invalid input: values must be finite non-negative numbers' }
  }
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
