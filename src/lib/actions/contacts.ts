"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { normalizeWhatsAppPhone } from "@/lib/phone-utils"

// ═══════════════════════════════════════════════════════════════
// Alterar IDENTIDADE do contato (telefone principal / BSUID) — protegido
// ═══════════════════════════════════════════════════════════════
// Identidade = chave de match no WhatsApp (whatsapp_id/bsuid, trava única).
// Camada de proteção: gate de permissão (admin/owner OU supervisor=view_all,
// fail-closed) + validação + detecção de COLISÃO (já é de outro contato →
// não sobrescreve, sinaliza) + log de auditoria em metadata. Doc §2/§7.

export type IdentityResult =
  | { ok: true }
  | { error: string }
  | { collision: { id: string; name: string } }

export async function updateContactIdentity(
  contactId: string,
  input: { phone?: string; bsuid?: string },
): Promise<IdentityResult> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  // 🔒 Gate fail-closed: só admin/owner ou supervisor (view_all).
  if (!(scope.isAdmin || scope.viewAll)) return { error: "Você não tem permissão para alterar a identidade deste contato." }
  const tenantId = scope.tenantId

  const { data: cur } = await supabaseAdmin.from("chat_contacts")
    .select("id, whatsapp_id, phone_number, bsuid, metadata, primary_external_id")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  if (!cur) return { error: "Contato não encontrado" }
  const c = cur as { whatsapp_id: string | null; phone_number: string | null; bsuid: string | null; metadata: Record<string, unknown> | null; primary_external_id: string | null }

  let newJid: string | null | undefined
  let newPhone: string | null | undefined
  let newBsuid: string | null | undefined
  if (input.phone !== undefined) {
    const p = input.phone.trim()
    if (p) { const n = normalizeWhatsAppPhone(p); if (!n) return { error: "Telefone inválido." }; newJid = n.jid; newPhone = n.phone }
    else { newJid = null; newPhone = null }
  }
  if (input.bsuid !== undefined) newBsuid = input.bsuid.trim() || null

  // O contato não pode ficar sem NENHUMA identidade.
  const finalJid   = newJid   !== undefined ? newJid   : c.whatsapp_id
  const finalBsuid = newBsuid !== undefined ? newBsuid : c.bsuid
  if (!finalJid && !finalBsuid) return { error: "O contato precisa de ao menos um telefone ou usuário (BSUID)." }

  // Colisão: o novo valor já pertence a OUTRO contato? → não duplica; sinaliza.
  for (const [col, val] of [["whatsapp_id", newJid], ["bsuid", newBsuid]] as const) {
    if (!val) continue
    const { data: other } = await supabaseAdmin.from("chat_contacts")
      .select("id, custom_name, push_name, phone_number").eq("tenant_id", tenantId).eq(col, val).neq("id", contactId).maybeSingle()
    if (other) {
      const o = other as { id: string; custom_name: string | null; push_name: string | null; phone_number: string | null }
      return { collision: { id: o.id, name: o.custom_name?.trim() || o.push_name?.trim() || o.phone_number || "Contato" } }
    }
  }

  // Auditoria leve (metadata.identity_log).
  const meta = c.metadata ?? {}
  const log = Array.isArray(meta.identity_log) ? (meta.identity_log as unknown[]) : []
  log.push({ at: new Date().toISOString(), by: scope.userId, from: { jid: c.whatsapp_id, bsuid: c.bsuid }, to: { jid: finalJid, bsuid: finalBsuid } })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), metadata: { ...meta, identity_log: log } }
  if (newJid   !== undefined) { patch.whatsapp_id = newJid; patch.phone_number = newPhone }
  if (newBsuid !== undefined) patch.bsuid = newBsuid
  patch.primary_external_id = finalJid ?? (finalBsuid ? `bsuid:${finalBsuid}` : c.primary_external_id)

  const { error } = await supabaseAdmin.from("chat_contacts").update(patch).eq("id", contactId).eq("tenant_id", tenantId)
  if (error) {
    if (error.code === "23505") return { error: "Esse número/usuário já pertence a outro contato." }
    return { error: error.message }
  }
  return { ok: true }
}

// Verificação AO VIVO: já existe um contato com esse telefone/BSUID? (sem criar)
// Escopo do tenant da sessão (só revela contato que o usuário já podia ver). Pra
// o form avisar na hora e não duplicar.
export async function lookupContact(input: {
  phone?: string
  bsuid?: string
}): Promise<{ id: string; name: string } | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  const tenantId = session.user.tenantId

  const jid   = input.phone?.trim() ? (normalizeWhatsAppPhone(input.phone)?.jid ?? null) : null
  const bsuid = input.bsuid?.trim() || null
  if (!jid && !bsuid) return null

  let q = supabaseAdmin.from("chat_contacts")
    .select("id, custom_name, push_name, phone_number")
    .eq("tenant_id", tenantId)
  q = jid ? q.eq("whatsapp_id", jid) : q.eq("bsuid", bsuid as string)
  const { data } = await q.maybeSingle()
  if (!data) return null

  const d = data as { id: string; custom_name: string | null; push_name: string | null; phone_number: string | null }
  return { id: d.id, name: d.custom_name?.trim() || d.push_name?.trim() || d.phone_number || "Contato" }
}

// ═══════════════════════════════════════════════════════════════
// Criação manual de contato (1-a-1) — sobre o resolver canônico
// ═══════════════════════════════════════════════════════════════
// Dedup-safe: passa pela MESMA lógica de identidade do webhook → quando a
// pessoa mandar mensagem, casa no mesmo contato (não duplica).
// F1: telefone OU BSUID. Contato sem WhatsApp (só email) é F5.

export async function createContact(input: {
  name?:  string
  phone?: string
  bsuid?: string
  email?: string
}): Promise<{ id: string; created: boolean } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const tenantId = session.user.tenantId

  const bsuid = input.bsuid?.trim() || null
  const email = input.email?.trim() || null

  let jid: string | null = null
  let phone: string | null = null
  if (input.phone?.trim()) {
    const norm = normalizeWhatsAppPhone(input.phone)
    if (!norm) return { error: "Telefone inválido. Use DDD + número (ex: 11999998888)." }
    jid = norm.jid
    phone = norm.phone
  }

  if (!jid && !bsuid) return { error: "Informe um telefone ou um BSUID." }

  const r = await resolveOrCreateContact(
    tenantId,
    { jid, phone, bsuid, email },
    { customName: input.name?.trim() || null, source: "manual" },
  )
  return r
}
