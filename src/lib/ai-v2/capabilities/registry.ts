// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — REGISTRO de capacidades (single source)
// ═══════════════════════════════════════════════════════════════
// O builder lê os nós daqui; o agente lê as tools daqui; o runtime
// roda `run`. Um lugar só. Capacidades reais entram a partir da
// Fatia 3 (send_message / ai_router / transfer). Fatia 1 entrega só
// a máquina (define + register + lookups) — registro propositalmente
// vazio, validado por typecheck.

import type {
  Capability, CapabilitySpec, ExecCtx, CapabilityResult, PlaybookCtx,
} from "./types"
import type OpenAI from "openai"

/**
 * Converte uma spec tipada numa Capability "apagada": embrulha
 * parseArgs+execute num único `run(ctx, raw)`. Assim o registro guarda
 * `Capability` uniforme (sem variância de parâmetro) e cada capacidade
 * mantém args fortemente tipados internamente.
 */
export function defineCapability<Args>(spec: CapabilitySpec<Args>): Capability {
  return {
    id:           spec.id,
    name:         spec.name,
    category:     spec.category,
    minPlanLevel: spec.minPlanLevel,
    isNode:       spec.isNode,
    toolSchema:   spec.toolSchema,
    playbook:     spec.playbook,
    run: async (ctx: ExecCtx, rawArgs: unknown): Promise<CapabilityResult> => {
      // parseArgs nunca lança (padrão v1). execute é protegido aqui pra
      // garantir que nenhuma capacidade derrube o turno.
      try {
        return await spec.execute(ctx, spec.parseArgs(rawArgs))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `capability:${spec.id} ${msg}` }
      }
    },
  }
}

// ── O registro ──────────────────────────────────────────────────
const REGISTRY = new Map<string, Capability>()

/** Registra (ou substitui) uma capacidade. Idempotente por id. */
export function register(cap: Capability): void {
  if (REGISTRY.has(cap.id)) {
    console.warn(`[studio/registry] capacidade duplicada sobrescrita: ${cap.id}`)
  }
  REGISTRY.set(cap.id, cap)
}

/** Registra várias de uma vez (conveniência pros barrels por fatia). */
export function registerAll(caps: Capability[]): void {
  for (const c of caps) register(c)
}

export function getCapability(id: string): Capability | null {
  return REGISTRY.get(id) ?? null
}

export function allCapabilities(): Capability[] {
  return [...REGISTRY.values()]
}

/** Capacidades que aparecem como nó no builder (filtradas por plano). */
export function nodeCapabilities(planLevel: number): Capability[] {
  return allCapabilities().filter((c) => c.isNode && c.minPlanLevel <= planLevel)
}

/**
 * Tools oferecidas ao agente num turno: só as capacidades cujos ids
 * o nó concede E que têm toolSchema E liberadas pelo plano. Escopo
 * por-nó = a IA nunca recebe o registro inteiro (princípio de menor
 * privilégio — doc §6).
 */
export function toolsForAgent(
  grantedIds: string[],
  planLevel: number,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
  for (const id of grantedIds) {
    const cap = REGISTRY.get(id)
    if (cap?.toolSchema && cap.minPlanLevel <= planLevel) tools.push(cap.toolSchema)
  }
  return tools
}

/**
 * Studio Engine §Pilar 1 — monta a guidance ("COMO AGIR") das capacidades
 * CONCEDIDAS ao nó: o craft mora na capability, não no prompt do cliente. Cada
 * id concedido (na ordem) contribui seu `playbook(ctx)`; vazios/null são
 * ignorados; dedupe por id (agenda tem 3 caps, 1 só carrega o playbook).
 */
export function assemblePlaybooks(grantedIds: string[], ctx: PlaybookCtx): string {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of grantedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const text = REGISTRY.get(id)?.playbook?.(ctx)?.trim()
    if (text) out.push(text)
  }
  return out.join("\n\n")
}
