// lib/sse.ts
import type { SSEEvent } from '@/types'
import { randomUUID } from 'crypto'

type Listener = (event: SSEEvent) => void

// Pin to globalThis so HMR / multiple module evaluations in Next.js dev
// all share the same listener registry within the same process.
const g = globalThis as typeof globalThis & { _sseListeners?: Map<string, Listener> }
if (!g._sseListeners) g._sseListeners = new Map()
const listeners = g._sseListeners

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
