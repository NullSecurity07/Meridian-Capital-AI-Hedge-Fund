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
