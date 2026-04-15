// app/api/benchmarks/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getBenchmarks } from '@/lib/db'
import { refreshBenchmarks } from '@/lib/benchmarks'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'

export const dynamic = 'force-dynamic'

export async function GET() {
  const db = getDb()
  const { safetyConfig, mode } = getOrchestratorOptions()

  // Get stored benchmarks (cheap — just a DB read)
  let benchmarks = getBenchmarks(db)

  // If no benchmarks yet (first call), fetch them now
  if (benchmarks.length === 0) {
    benchmarks = await refreshBenchmarks(db)
  }

  // Compute portfolio return for comparison
  const { getPortfolio } = await import('@/lib/db')
  const portfolio = getPortfolio(db, mode)
  const currentValue = portfolio?.totalValue ?? safetyConfig.budget
  const portfolioReturn = (currentValue - safetyConfig.budget) / safetyConfig.budget

  return NextResponse.json({
    portfolio: {
      name: 'Meridian Capital',
      returnSinceBaseline: portfolioReturn,
      currentValue,
      budget: safetyConfig.budget,
    },
    benchmarks,
    lastUpdated: benchmarks[0]?.updatedAt ?? null,
  })
}

// POST /api/benchmarks — force a fresh fetch
export async function POST() {
  const db = getDb()
  const benchmarks = await refreshBenchmarks(db)
  return NextResponse.json({ refreshed: true, benchmarks })
}
