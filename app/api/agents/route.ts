// app/api/agents/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db-singleton'
import { getOrchestratorOptions, setOrchestratorOptions } from '@/lib/orchestrator-singleton'
import { startOrchestrator, stopOrchestrator, isOrchestratorRunning } from '@/lib/agents/orchestrator'
import { getAgent } from '@/lib/db'
import type { AgentId } from '@/types'

const AGENT_IDS: AgentId[] = ['pm', 'researcher', 'quant', 'risk', 'macro', 'trader']

export async function GET() {
  const db = getDb()
  const agents = AGENT_IDS.map(id => getAgent(db, id)).filter(Boolean)
  return NextResponse.json({
    agents,
    orchestrator: { running: isOrchestratorRunning(), options: getOrchestratorOptions() },
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { action: string; options?: Partial<ReturnType<typeof getOrchestratorOptions>> }
  const db = getDb()

  if (body.action === 'start') {
    if (body.options) setOrchestratorOptions(body.options)
    const opts = getOrchestratorOptions()
    startOrchestrator(db, opts)
    return NextResponse.json({ started: true, options: opts })
  }

  if (body.action === 'stop') {
    stopOrchestrator()
    return NextResponse.json({ stopped: true })
  }

  return NextResponse.json({ error: 'Unknown action. Use "start" or "stop".' }, { status: 400 })
}
