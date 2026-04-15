// app/api/ping/route.ts
// Keep-alive endpoint for UptimeRobot — prevents Replit from sleeping.
// Add this URL as an HTTP monitor in UptimeRobot with a 5-minute interval.
import { NextResponse } from 'next/server'
import { isOrchestratorRunning } from '@/lib/agents/orchestrator'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    orchestrator: isOrchestratorRunning() ? 'running' : 'idle',
    ts: Date.now(),
  })
}
