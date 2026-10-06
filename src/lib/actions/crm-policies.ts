"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { hasModule } from "@/lib/modules"
import { getViewerScope } from "@/lib/visibility"
import { revalidatePath } from "next/cache"
import { logAudit } from "@/lib/audit"

// ═══════════════════════════════════════════════════════════════
// Regras do CRM da empresa (tenant_config.crm_policies, jsonb) — gestão + módulo crm.
// ═══════════════════════════════════════════════════════════════
// O jsonb guarda outras chaves (proposal_validity_days…): grava por CAS sobre o valor
// lido, então duas pessoas salvando ao mesmo tempo não apagam a chave uma da outra.
// Quem LÊ para decidir é o servidor (manualItemsAllowed em lib/crm/deal-lines).

export interface CrmItemPolicies { manualItems: boolean }

async function requireAdmin(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const scope = await getViewerScope()
  if (!scope.isAdmin) return { error: "Somente a gestão pode mudar as regras dos itens." }
  if (!(await hasModule(scope.tenantId, "crm"))) return { error: "Módulo CRM não habilitado" }
  return { tenantId: scope.tenantId, userId: scope.userId }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null
}

export async function getCrmItemPolicies(): Promise<CrmItemPolicies | { error: string }> {
  const gate = await requireAdmin()
  if ("error" in gate) return gate
  const { data, error } = await supabaseAdmin.from("tenant_config")
    .select("crm_policies").eq("tenant_id", gate.tenantId).maybeSingle()
  if (error) return { error: "Não foi possível ler a configuração." }
  return { manualItems: asObject((data as { crm_policies?: unknown } | null)?.crm_policies)?.manual_items !== false }
}

/** Liga/desliga o item avulso para a empresa toda (padrão: ligado). */
export async function setManualItemsAllowed(enabled: boolean): Promise<{ error?: string }> {
  if (typeof enabled !== "boolean") return { error: "Valor inválido" }
  const gate = await requireAdmin()
  if ("error" in gate) return gate

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await supabaseAdmin.from("tenant_config")
      .select("crm_policies").eq("tenant_id", gate.tenantId).maybeSingle()
    if (error) return { error: "Não foi possível ler a configuração." }
    const stored = (row as { crm_policies?: unknown } | null)?.crm_policies ?? null
    const current = asObject(stored)
    const before = current?.manual_items !== false
    if (before === enabled) return {}
    const next = { ...(current ?? {}), manual_items: enabled }

    let saved: { data: unknown; error: unknown }
    if (!row) {
      saved = await supabaseAdmin.from("tenant_config")
        .insert({ tenant_id: gate.tenantId, crm_policies: next }).select("tenant_id").maybeSingle()
    } else {
      let q = supabaseAdmin.from("tenant_config").update({ crm_policies: next }).eq("tenant_id", gate.tenantId)
      q = stored === null ? q.is("crm_policies", null) : q.eq("crm_policies", JSON.stringify(stored))
      saved = await q.select("tenant_id").maybeSingle()
    }
    if (saved.data) {
      await logAudit({
        tenantId: gate.tenantId, actorId: gate.userId, action: "crm.policies.manual_items",
        targetType: "tenant", targetId: gate.tenantId, before: { manual_items: before }, after: { manual_items: enabled },
      })
      revalidatePath("/configuracoes/cotacao")
      return {}
    }
    // Perdeu a corrida (alguém gravou entre a leitura e a escrita): lê de novo.
  }
  return { error: "A configuração mudou enquanto salvava. Recarregue a página." }
}
