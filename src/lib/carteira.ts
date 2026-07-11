import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Carteira (dono da conta) — lógica de backend do owner_id
// ═══════════════════════════════════════════════════════════════
// docs/crm-account-owner-design.md §4-6. O dono (owner_id) vive no CONTATO
// (chat_contacts.owner_id) e é DENORMALIZADO nas conversas
// (chat_conversations.owner_id) pra a visibilidade ESCALAR — o filtro vira
// `owner_id = eu` (coluna), em vez de um IN-list de milhares de contact_ids.
// Este módulo é a fonte única que mantém os dois em sincronia + o auto-dono
// gated por Vínculo. Toda escrita de owner_id passa por aqui.

/** Propaga o dono do contato pras conversas dele (a etiqueta de posse = o rastro
 *  que o dono enxerga). Chamado por setContactOwner, auto-dono e transferir cliente. */
export async function syncConversationOwner(
  tenantId: string,
  contactId: string,
  ownerId: string | null,
): Promise<void> {
  await supabaseAdmin
    .from("chat_conversations")
    .update({ owner_id: ownerId })
    .eq("tenant_id", tenantId)
    .eq("contact_id", contactId)
}

/**
 * Auto-dono: o 1º humano que ASSUME o cliente vira o dono da carteira — MAS só quando:
 *   • o Vínculo do tenant é 'carteira' (pool NÃO fabrica dono — "cliente é do time"), E
 *   • o contato ainda NÃO tem dono (nunca sobrescreve — fill-only-empty), E
 *   • o agente é válido (ativo no tenant — não vira dono um id-lixo).
 * Preenche chat_contacts.owner_id + sincroniza as conversas. No-op silencioso fora
 * dessas condições. Retorna true se carimbou. Chamado nos choke points de atribuição.
 */
export async function linkOwnerIfCarteira(
  tenantId: string,
  contactId: string | null,
  agentId: string | null,
): Promise<boolean> {
  if (!contactId || !agentId) return false

  // Vínculo do tenant. Pool não auto-vincula (respeita a filosofia do tenant).
  const { data: cfg } = await supabaseAdmin
    .from("tenant_config").select("handoff_binding").eq("tenant_id", tenantId).maybeSingle()
  const binding = (cfg?.handoff_binding as string | undefined) ?? "carteira"
  if (binding !== "carteira") return false

  // Contato do tenant e SEM dono? (fill-only-empty)
  const { data: contact } = await supabaseAdmin
    .from("chat_contacts").select("id, owner_id")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  if (!contact || (contact as { owner_id: string | null }).owner_id) return false

  // Agente ativo no tenant?
  const { data: m } = await supabaseAdmin
    .from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", agentId).eq("active", true).maybeSingle()
  if (!m) return false

  // Carimba + propaga. Guarda de corrida: `.is('owner_id', null)` — se outra request
  // preencheu no meio, o update não pega nada e a gente aborta (não sobrescreve).
  const { data: updated } = await supabaseAdmin
    .from("chat_contacts")
    .update({ owner_id: agentId, updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", tenantId).is("owner_id", null)
    .select("id")
  if (!updated || updated.length === 0) return false

  await syncConversationOwner(tenantId, contactId, agentId)
  return true
}

/** Variante por CONVERSA — resolve o contact_id da conversa e delega pro auto-dono.
 *  Usada nos choke points de atribuição (send/assign/transfer) sem exigir contact_id
 *  no select de cada um. Best-effort: erro aqui nunca derruba o envio/atribuição. */
export async function linkOwnerOnAssign(
  tenantId: string,
  conversationId: string,
  agentId: string | null,
): Promise<void> {
  try {
    if (!agentId) return
    const { data: conv } = await supabaseAdmin
      .from("chat_conversations").select("contact_id")
      .eq("id", conversationId).eq("tenant_id", tenantId).maybeSingle()
    const contactId = (conv as { contact_id: string | null } | null)?.contact_id ?? null
    await linkOwnerIfCarteira(tenantId, contactId, agentId)
  } catch (e) {
    console.error("[carteira/linkOwnerOnAssign]", e instanceof Error ? e.message : e)
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
