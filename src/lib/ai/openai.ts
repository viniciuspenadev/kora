// ═══════════════════════════════════════════════════════════════
// Cliente OpenAI — wrapper fino (server-only, singleton)
// ═══════════════════════════════════════════════════════════════
// Não expõe o SDK cru pro resto do código: a engine fala só com
// `runChat`, que devolve um shape estável e neutro. Troca de provider
// no futuro = trocar só este arquivo.

import "server-only"
import OpenAI from "openai"

let _client: OpenAI | null = null

function client(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY ausente")
    _client = new OpenAI({ apiKey })
  }
  return _client
}

export interface ChatToolCall {
  id:        string
  name:      string
  arguments: string   // JSON cru — parsing fica com quem conhece o schema
}

export interface ChatResult {
  text:      string | null
  toolCalls: ChatToolCall[]
  usage:     { inputTokens: number; outputTokens: number }
}

export interface RunChatParams {
  model:       string
  messages:    OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  tools?:      OpenAI.Chat.Completions.ChatCompletionTool[]
  /** Força/restringe a escolha de tool. Ex: "required" obriga a chamar alguma. */
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption
  temperature?: number
  /** Timeout por chamada (ms). Default 30s — evita pendurar o webhook. */
  timeoutMs?:  number
}

/**
 * Uma chamada de chat completion. Lança em erro de rede/API — o caller
 * (run.ts) captura, registra em `ai_runs.error` e não derruba o webhook.
 */
export async function runChat(params: RunChatParams): Promise<ChatResult> {
  const resp = await client().chat.completions.create(
    {
      model:       params.model,
      messages:    params.messages,
      tools:       params.tools,
      tool_choice: params.toolChoice,
      temperature: params.temperature ?? 0.4,
    },
    { timeout: params.timeoutMs ?? 30_000 },
  )

  const choice    = resp.choices[0]
  const message   = choice?.message
  const toolCalls: ChatToolCall[] = []
  for (const tc of message?.tool_calls ?? []) {
    // tool_calls é union (function | custom) no SDK v6 — só nos interessa function.
    if (tc.type !== "function") continue
    toolCalls.push({
      id:        tc.id,
      name:      tc.function.name,
      arguments: tc.function.arguments,
    })
  }

  return {
    text:      message?.content ?? null,
    toolCalls,
    usage: {
      inputTokens:  resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
    },
  }
}
