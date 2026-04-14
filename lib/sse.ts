// lib/sse.ts
import type { SSEEvent } from '@/types'
import { randomUUID } from 'crypto'

type Listener = (event: SSEEvent) => void

const listeners = new Map<string, Listener>()

export function subscribe(listener: Listener): string {
  const id = randomUUID()
  listeners.set(id, listener)
  return id
}

export function unsubscribe(id: string): void {
  listeners.delete(id)
}

export function broadcast(event: SSEEvent): void {
  for (const listener of listeners.values()) {
    try {
      listener(event)
    } catch (err) {
      // Never let one bad listener break others — but log for observability
      console.error('[SSE broadcast error]', err)
    }
  }
}
