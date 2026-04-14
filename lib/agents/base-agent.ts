// lib/agents/base-agent.ts
import Anthropic from '@anthropic-ai/sdk'
import type { AgentId } from '@/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AgentConfig {
  id: AgentId
  name: string
  role: string
  systemPrompt: string
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AgentResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

export function buildSystemPromptWithMemory(
  basePrompt: string,
  lessons: string[]
): string {
  if (lessons.length === 0) return basePrompt
  const lessonsBlock = lessons.map((l, i) => `${i + 1}. ${l}`).join('\n')
  return `${basePrompt}\n\n---\nPast lessons from your trade history (use these to improve your analysis):\n${lessonsBlock}`
}

export async function runAgent(
  config: AgentConfig,
  messages: AgentMessage[],
  memoryLessons: string[]
): Promise<AgentResponse> {
  const systemPrompt = buildSystemPromptWithMemory(config.systemPrompt, memoryLessons)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const textBlock = response.content.find(b => b.type === 'text')
  const content = textBlock?.type === 'text' ? textBlock.text : ''

  return {
    content,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  }
}
