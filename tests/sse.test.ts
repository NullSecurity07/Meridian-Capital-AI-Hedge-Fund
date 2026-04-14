import { describe, it, expect, vi } from 'vitest'
import { broadcast, subscribe, unsubscribe } from '@/lib/sse'
import type { SSEEvent } from '@/types'

describe('SSE broadcaster', () => {
  it('delivers events to a subscriber', () => {
    const received: SSEEvent[] = []
    const id = subscribe(event => received.push(event))

    const event: SSEEvent = {
      type: 'agent_update',
      agentId: 'researcher',
      payload: { status: 'active', task: 'Scanning NVDA news' },
      timestamp: Date.now(),
    }
    broadcast(event)

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('agent_update')
    expect(received[0].agentId).toBe('researcher')

    unsubscribe(id)
  })

  it('does not deliver to unsubscribed listeners', () => {
    const received: SSEEvent[] = []
    const id = subscribe(event => received.push(event))
    unsubscribe(id)

    broadcast({
      type: 'trade_executed',
      payload: { symbol: 'NVDA' },
      timestamp: Date.now(),
    })

    expect(received).toHaveLength(0)
  })

  it('delivers to multiple subscribers', () => {
    const a: SSEEvent[] = []
    const b: SSEEvent[] = []
    const id1 = subscribe(e => a.push(e))
    const id2 = subscribe(e => b.push(e))

    broadcast({ type: 'kill_switch', payload: {}, timestamp: Date.now() })

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)

    unsubscribe(id1)
    unsubscribe(id2)
  })

  it('does not crash if a listener throws', () => {
    const id = subscribe(() => { throw new Error('listener error') })

    expect(() => broadcast({
      type: 'portfolio_update',
      payload: {},
      timestamp: Date.now(),
    })).not.toThrow()

    unsubscribe(id)
  })

  it('returns unique IDs for each subscriber', () => {
    const id1 = subscribe(() => {})
    const id2 = subscribe(() => {})
    expect(id1).not.toBe(id2)
    unsubscribe(id1)
    unsubscribe(id2)
  })
})
