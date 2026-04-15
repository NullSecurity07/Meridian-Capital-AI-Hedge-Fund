// app/api/trading/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'
import { analyzeSymbol } from '@/lib/agents/orchestrator'

export async function POST(req: NextRequest) {
  const { symbol } = await req.json() as { symbol: string }
  if (!symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  const db = getDb()
  const { mode, safetyConfig } = getOrchestratorOptions()

  // Run analysis in background — respond immediately, results stream via SSE
  analyzeSymbol(symbol.toUpperCase(), db, mode, safetyConfig).catch(err =>
    console.error(`[analyze route] Error on ${symbol}:`, err)
  )

  return NextResponse.json({ started: true, symbol: symbol.toUpperCase(), mode })
}
