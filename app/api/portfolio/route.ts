// app/api/portfolio/route.ts
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getPortfolio, getPositions } from '@/lib/db'
import { getOrchestratorOptions } from '@/lib/orchestrator-singleton'

export async function GET() {
  const db = getDb()
  const { mode } = getOrchestratorOptions()
  const portfolio = getPortfolio(db, mode)
  const positions = getPositions(db, mode)
  return NextResponse.json({ portfolio, positions, mode })
}
