// app/api/stream/route.ts
import { subscribe, unsubscribe } from '@/lib/sse'
import type { SSEEvent } from '@/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const encoder = new TextEncoder()
  let subId: string

  const stream = new ReadableStream({
    start(controller) {
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
