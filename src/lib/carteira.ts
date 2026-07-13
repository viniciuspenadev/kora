import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Carteira (dono da conta) — owner_id vive SÓ no CONTATO
// ═══════════════════════════════════════════════════════════════
// docs/crm-account-owner-design.md. Regra: o dono (chat_contacts.owner_id) é setado
// quando o vendedor abre o PRIMEIRO negócio do contato (claim comercial). A CONVERSA
// NÃO carrega owner_id — o chat é só atendimento (assigned_to). O dono é derivado do
// contato onde precisa (linha "Dono" na ficha, route-by-owner no retorno, reachable).

/**
 * Auto-dono: quando o vendedor abre o 1º negócio do contato, ele vira o dono (carteira).
 *   • fill-only-empty — negócio seguinte NÃO troca o dono (guarda de corrida via `.is`).
 *   • ungated — abrir negócio é claim COMERCIAL, independe do Vínculo do atendimento.
 *   • só no CONTATO — a conversa não é tocada.
 * No-op silencioso se contato/agente inválidos. Best-effort (não derruba a criação do negócio).
 */
export async function linkOwnerOnDeal(
  tenantId: string,
  contactId: string | null,
  userId: string | null,
): Promise<void> {
  try {
    if (!contactId || !userId) return
    // Agente ativo no tenant? (não vira dono um id-lixo)
    const { data: m } = await supabaseAdmin
      .from("tenant_users").select("user_id")
      .eq("tenant_id", tenantId).eq("user_id", userId).eq("active", true).maybeSingle()
    if (!m) return
    // fill-only-empty: `.is('owner_id', null)` só preenche o vazio; se já tem dono, no-op.
    await supabaseAdmin
      .from("chat_contacts")
      .update({ owner_id: userId, updated_at: new Date().toISOString() })
      .eq("id", contactId).eq("tenant_id", tenantId).is("owner_id", null)
  } catch (e) {
    console.error("[carteira/linkOwnerOnDeal]", e instanceof Error ? e.message : e)
  }
}

/** Resolve o dono da carteira de um contato (pro route-by-owner do retorno). */
export async function carteiraOwner(tenantId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const { data } = await supabaseAdmin
    .from("chat_contacts").select("owner_id")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  return (data as { owner_id: string | null } | null)?.owner_id ?? null
}
