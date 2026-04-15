// app/api/stream/route.ts
import { subscribe, unsubscribe } from '@/lib/sse'
import { isOrchestratorRunning, startOrchestrator } from '@/lib/agents/orchestrator'
import { DEFAULT_OPTIONS } from '@/lib/orchestrator-singleton'
import { getDb } from '@/lib/db-singleton'
import type { SSEEvent, TradingMode } from '@/types'

export const dynamic = 'force-dynamic'

// Fallback: if instrumentation.ts didn't fire (Replit cold-start edge case),
// kick off the orchestrator the first time a client connects to the stream.
function ensureOrchestratorRunning() {
  if (!isOrchestratorRunning()) {
    try {
      const mode = (process.env.TRADING_MODE ?? 'paper') as TradingMode
      startOrchestrator(getDb(), { ...DEFAULT_OPTIONS, mode })
      console.info('[Stream] Fallback auto-start: orchestrator launched on first SSE connection')
    } catch (err) {
      console.error('[Stream] Fallback auto-start failed:', err)
    }
  }
}

export async function GET() {
  const encoder = new TextEncoder()
  let subId: string

  const stream = new ReadableStream({
    start(controller) {
      // Ensure orchestrator is running (primary: instrumentation.ts, fallback: here)
      ensureOrchestratorRunning()

      // Send a heartbeat immediately to confirm connection
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))

      subId = subscribe((event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          // Controller may be closed if client disconnected
        }
      })

      // Heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('data: {"type":"heartbeat"}\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30000)
    },
    cancel() {
      unsubscribe(subId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
