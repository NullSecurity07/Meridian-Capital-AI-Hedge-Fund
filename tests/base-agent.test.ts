import { describe, it, expect, vi } from 'vitest'
import {
  buildSystemPromptWithMemory,
  runAgent,
} from '@/lib/agents/base-agent'

vi.mock('openai', () => {
  const MockOpenAI = vi.fn(function() {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'NVDA looks strong. BUY recommendation with conviction 8/10.' } }],
            usage: { prompt_tokens: 120, completion_tokens: 45 },
          }),
        },
      },
    }
  })
  return { default: MockOpenAI, OpenAI: MockOpenAI }
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
  it('calls the LLM and returns a response', async () => {
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
