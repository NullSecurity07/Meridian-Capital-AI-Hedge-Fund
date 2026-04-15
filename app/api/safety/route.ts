// app/api/safety/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { isKillSwitchActive, activateKillSwitch, deactivateKillSwitch } from '@/lib/safety'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'
import { getDailyBaseline } from '@/lib/agents/orchestrator'
import { getDb } from '@/lib/db-singleton'
import { getPortfolio } from '@/lib/db'

export async function GET() {
  const { safetyConfig, mode } = getOrchestratorOptions()
  const db = getDb()
  const portfolio = getPortfolio(db, mode)
  const currentValue = portfolio?.totalValue ?? safetyConfig.budget
  const baseline = getDailyBaseline() ?? currentValue
  const dailyLossPct = baseline > 0 ? Math.max(0, (baseline - currentValue) / baseline) : 0

  return NextResponse.json({
    killSwitchActive: isKillSwitchActive(),
    dailyLossPct,
    dailyLossLimitPct: safetyConfig.dailyLossLimitPct,
    maxPositionPct: safetyConfig.maxPositionPct,
    stopLossPct: safetyConfig.stopLossPct,
    budget: safetyConfig.budget,
  })
}

export async function POST(req: NextRequest) {
  const { action, reason } = await req.json() as { action: 'activate' | 'deactivate'; reason?: string }
  if (action === 'activate') {
    activateKillSwitch(reason ?? 'Manual activation via dashboard')
    return NextResponse.json({ killSwitchActive: true })
  }
  if (action === 'deactivate') {
    deactivateKillSwitch(reason ?? 'Manual deactivation via dashboard')
    return NextResponse.json({ killSwitchActive: false })
  }
  return NextResponse.json({ error: 'action must be "activate" or "deactivate"' }, { status: 400 })
}
