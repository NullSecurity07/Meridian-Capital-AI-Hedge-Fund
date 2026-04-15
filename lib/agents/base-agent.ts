// lib/agents/base-agent.ts
// Uses free LLM providers via OpenAI-compatible API:
//   - Groq free tier (set GROQ_API_KEY) — cloud, no GPU needed
//   - Ollama (default) — fully local, no account, no rate limits
//     Install: https://ollama.com  then  ollama pull qwen2.5:7b
import OpenAI from 'openai'
import type { AgentId } from '@/types'

function createLLMClient(): OpenAI {
  if (process.env.GROQ_API_KEY) {
    return new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  }
  // Ollama: no API key needed — 'ollama' is a required non-empty placeholder
  return new OpenAI({
    apiKey: 'ollama',
    baseURL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
  })
}

function getDefaultModel(): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL
  if (process.env.GROQ_API_KEY) return 'llama-3.3-70b-versatile'
  return 'qwen2.5:7b'
}

const client = createLLMClient()
const MODEL = getDefaultModel()

export interface AgentConfig {
  id: AgentId
  name: string
  role: string
  systemPrompt: string
  maxTokens?: number
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

  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: config.maxTokens ?? 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ],
  })

  const text = response.choices[0]?.message?.content ?? ''
  if (!text) {
    console.warn(`[${config.id}] runAgent: empty response from model`)
  }

  return {
    content: text,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  }
}
