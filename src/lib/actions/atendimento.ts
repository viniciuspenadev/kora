"use server"

// ═══════════════════════════════════════════════════════════════
// Política de Atendimento — server actions (docs/politica-atendimento.md)
// ═══════════════════════════════════════════════════════════════
// Lê/grava a política em tenant_config (1 linha por tenant). Owner/admin.
//
// VÍNCULO controla só o carimbo pelo atendimento. Studio decide destinos;
// sem destino explícito o núcleo prefere responsável elegível ou fila.
// reopen_to_ai/reopen_flow_id ficam no banco por compatibilidade, sem uso aqui.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

export type HandoffBinding   = "carteira" | "pool"
/**
 * O que a rede de segurança faz quando o cliente está esperando.
 *
 * 🔴 Era um 3-way ("notify" | "redistribute" | "ai"). Decisão do dono (2026-08-26):
 *    sobra só AVISAR. "Devolver pra IA" saiu porque não respondia ninguém — só religava
 *    uma marca que rearmava pro próximo inbound, que podia nunca vir, e ainda escrevia
 *    na trilha que "a IA reassumiu". "Redistribuir" saiu junto com o motor de
 *    distribuição; volta quando existir um motor funcional pra isso.
 */
export type InactivityAction = "notify"

export interface AtendimentoPolicy {
  handoff_binding:    HandoffBinding
  inactivity_enabled: boolean
  inactivity_hours:   number
  inactivity_action:  InactivityAction
  /** Meta de 1ª resposta em minutos (null = sem meta). Base do "% no prazo" dos relatórios. */
  sla_first_response_minutes?: number | null
}

const BINDINGS = new Set<HandoffBinding>(["carteira", "pool"])
const ACTIONS  = new Set<InactivityAction>(["notify"])

export async function updateAtendimentoPolicy(input: AtendimentoPolicy): Promise<{ error?: string }> {
  const session = await auth()
  if (!session) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }

  const tenantId = session.user.tenantId
  const binding: HandoffBinding = BINDINGS.has(input.handoff_binding) ? input.handoff_binding : "carteira"

  // Valor legado no banco (reassign/pool/ai/redistribute) cai aqui e vira "notify".
  const action: InactivityAction = ACTIONS.has(input.inactivity_action) ? input.inactivity_action : "notify"
  const hours = Math.min(168, Math.max(1, Math.round(Number(input.inactivity_hours) || 4)))

  // SLA: null = sem meta; senão clampa 1..1440 min (24h).
  const slaRaw = input.sla_first_response_minutes
  const sla = slaRaw == null ? null : Math.min(1440, Math.max(1, Math.round(Number(slaRaw) || 15)))

  const { data, error } = await supabaseAdmin
    .from("tenant_config")
    .upsert({
      tenant_id: tenantId,
      handoff_binding:    binding,
      inactivity_enabled: !!input.inactivity_enabled,
      inactivity_hours:   hours,
      inactivity_action:  action,
      sla_first_response_minutes: sla,
    }, { onConflict: "tenant_id" })
    .select("tenant_id")

  if (error) return { error: error.message }
  if (!data?.length) return { error: "Não foi possível salvar a regra de atendimento." }
  revalidatePath("/configuracoes/atendimento")
  return {}
}

