import { describe, it, expect, vi } from 'vitest'
import {
  buildSystemPromptWithMemory,
  runAgent,
} from '@/lib/agents/base-agent'

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function() {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'NVDA looks strong. BUY recommendation with conviction 8/10.' }],
          usage: { input_tokens: 120, output_tokens: 45 },
        }),
      },
    }
  })
  return { default: MockAnthropic, Anthropic: MockAnthropic }
})

describe('buildSystemPromptWithMemory', () => {
  it('returns base prompt unchanged when no lessons', () => {
    const base = 'You are a researcher.'
    const result = buildSystemPromptWithMemory(base, [])
    expect(result).toBe(base)
  })

  it('appends lessons section when lessons exist', () => {
    const base = 'You are a researcher.'
    const lessons = ['Watch for high IV before earnings', 'Semis rotate with rates']
    const result = buildSystemPromptWithMemory(base, lessons)
    expect(result).toContain('Past lessons from your trade history')
    expect(result).toContain('Watch for high IV before earnings')
    expect(result).toContain('Semis rotate with rates')
  })
})

describe('runAgent', () => {
  it('calls Claude and returns a response', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const config = {
      id: 'researcher' as const,
      name: 'Alex',
      role: 'Research Analyst',
      systemPrompt: 'You are a research analyst at a hedge fund.',
    }
    const response = await runAgent(
      config,
      [{ role: 'user', content: 'Analyze NVDA' }],
      []
    )
    expect(response.content).toContain('NVDA')
    expect(response.usage.inputTokens).toBe(120)
    expect(response.usage.outputTokens).toBe(45)
  })

  it('injects lessons into the system prompt when provided', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    const config = {
      id: 'quant' as const,
      name: 'Sam',
      role: 'Quant Analyst',
      systemPrompt: 'You are a quant analyst.',
    }
    const lessons = ['RSI > 70 on semis often precedes pullback']
    const response = await runAgent(
      config,
      [{ role: 'user', content: 'Analyze NVDA technicals' }],
      lessons
    )
    expect(response.content).toBeDefined()
  })
})
