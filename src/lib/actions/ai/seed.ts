// ═══════════════════════════════════════════════════════════════
// Seed default — chamado quando o módulo `ai_atendente` ativa
// ═══════════════════════════════════════════════════════════════
// NÃO é "use server". Função interna chamada de outras server
// actions (modules-admin.ts) ou de provisionamento.
//
// Idempotente: se ai_config já existe pro tenant, não sobrescreve;
// se trigger catch-all "Geral" já existe, não duplica.

import { supabaseAdmin } from "@/lib/supabase"

export interface SeedResult {
  configCreated:  boolean
  triggerCreated: boolean
}

/**
 * Garante que o tenant tenha o setup mínimo da IA pronto pra ele
 * configurar (ai_config off + 1 trigger catch-all "Geral" inativo).
 * Tudo começa DESLIGADO — cliente liga master switch quando quiser.
 */
export async function seedAIDefaults(tenantId: string): Promise<SeedResult> {
  let configCreated  = false
  let triggerCreated = false

  // 1) ai_config — upsert vazio (insere só se não existir)
  const { data: existingConfig } = await supabaseAdmin
    .from("ai_config")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!existingConfig) {
    const { error } = await supabaseAdmin
      .from("ai_config")
      .insert({
        tenant_id:   tenantId,
        ai_enabled:  false,
        ai_language: "pt-BR",
        ai_model:    "gpt-4.1",
        ai_tone:     "amigavel",
      })
    if (error) throw new Error(`Falha ao criar ai_config: ${error.message}`)
    configCreated = true
  }

  // 2) Trigger catch-all "Geral" — sempre casa, última prioridade.
  //    Tenant pode renomear/editar/deletar depois. Só cria se ainda
  //    não existe nenhum trigger pro tenant (evita duplicar em re-seed).
  const { count } = await supabaseAdmin
    .from("ai_triggers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)

  if ((count ?? 0) === 0) {
    const { error } = await supabaseAdmin
      .from("ai_triggers")
      .insert({
        tenant_id:        tenantId,
        name:             "Geral",
        priority:         9000,  // prioridade alta = avaliada por último
        active:           true,
        conditions:       [],    // sem condições = sempre casa (catch-all)
        context_payload:  ["contact_fields", "conversation_history"],
        instruction:      null,
        action_type:      "respond_only",
        action_target_id: null,
      })
    if (error) throw new Error(`Falha ao criar trigger Geral: ${error.message}`)
    triggerCreated = true
  }

  return { configCreated, triggerCreated }
}
