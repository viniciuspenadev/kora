// ═══════════════════════════════════════════════════════════════
// Ledger de uso de IA — TODO gasto vira 1 linha em studio_runs
// ═══════════════════════════════════════════════════════════════
// studio_runs é o ledger único (tenant_id + kind text + model + tokens +
// cost_usd + created_at, indexado por tenant). Turno do agente já grava via
// persistStudioRun; os DEMAIS pontos de gasto (router, dossiê, aiParse,
// transcrição…) gravam por aqui — cada um com seu `kind`, agregável no
// God Mode e no uso do tenant.
//
// `runChatMetered` = runChat + medição automática: helpers que fazem UMA
// chamada LLM usam ele e nunca esquecem de medir. Gravação fire-and-forget:
// medição NUNCA bloqueia nem derruba o turno.

import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { runChat, type RunChatParams, type ChatResult } from "./openai"
import { costOfTokens } from "./pricing"

/** Identidade do gasto: quem gastou, em qual conversa, fazendo o quê. */
export interface UsageMeter {
  tenantId:       string
  conversationId: string
  /** 'router' | 'dossier' | 'ai_parse' | 'transcription' | … (agregável). */
  kind:           string
  flowId?:        string | null
  nodeId?:        string | null
}

export function recordAiUsage(meter: UsageMeter, args: {
  model:        string
  inputTokens:  number
  outputTokens: number
  /** Custo já calculado (ex: transcrição por token de áudio). Ausente → tabela de chat. */
  costUsd?:     number | null
  durationMs?:  number
  error?:       string | null
}): void {
  supabaseAdmin.from("studio_runs").insert({
    tenant_id:       meter.tenantId,
    conversation_id: meter.conversationId,
    flow_id:         meter.flowId ?? null,
    node_id:         meter.nodeId ?? null,
    kind:            meter.kind,
    model:           args.model,
    input_tokens:    args.inputTokens,
    output_tokens:   args.outputTokens,
    cost_usd:        args.costUsd !== undefined ? args.costUsd : costOfTokens(args.model, args.inputTokens, args.outputTokens),
    duration_ms:     args.durationMs ?? null,
    error:           args.error ?? null,
  }).then(
    ({ error }) => { if (error) console.error("[ai-usage] insert falhou:", error.message) },
    (e: unknown) => console.error("[ai-usage]", (e as Error)?.message ?? e),
  )
}

/** runChat com medição automática no ledger. */
export async function runChatMetered(meter: UsageMeter, params: RunChatParams): Promise<ChatResult> {
  const t0 = Date.now()
  const res = await runChat(params)
  recordAiUsage(meter, {
    model:        params.model,
    inputTokens:  res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    durationMs:   Date.now() - t0,
  })
  return res
}
