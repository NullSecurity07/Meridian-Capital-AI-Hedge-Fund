import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkPositionLimit,
  checkDailyLossLimit,
  checkBudgetLimit,
  activateKillSwitch,
  deactivateKillSwitch,
  isKillSwitchActive,
  calculateStopLossPrice,
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

  it('blocks NaN trade value in position limit', () => {
    const result = checkPositionLimit(NaN, 25000, config)
    expect(result.allowed).toBe(false)
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
    expect(isKillSwitchActive()).toBe(true) // auto-activated
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

  it('allows trade exactly equal to cash', () => {
    const result = checkBudgetLimit(5000, 5000)
    expect(result.allowed).toBe(true)
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

describe('calculateStopLossPrice', () => {
  it('calculates 8% below entry price', () => {
    const stopPrice = calculateStopLossPrice(100, config)
    expect(stopPrice).toBeCloseTo(92, 1)
  })
})
