"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope, canManageContacts, seesAllContacts, reachableContactIds } from "@/lib/visibility"
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
  if (!canManageContacts(scope)) return { error: "Você não tem permissão para alterar a identidade deste contato." }
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
  const scope = await getViewerScope()
  if (!scope.tenantId) return null
  const tenantId = scope.tenantId

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
  // Escopo: só revela "já existe" se o contato é ALCANÇÁVEL pelo atendente (mesmo motor
  // de /contatos). Senão retorna null — não vaza existência/nome de contato alheio.
  if (!seesAllContacts(scope)) {
    const reach = await reachableContactIds(scope)
    if (!reach.includes(d.id)) return null
  }
  return { id: d.id, name: d.custom_name?.trim() || d.push_name?.trim() || d.phone_number || "Contato" }
}

// ═══════════════════════════════════════════════════════════════
// Vincular / mesclar contatos (F6) — funde DOIS num só (atômico no banco)
// ═══════════════════════════════════════════════════════════════
// O contato VISTO é o sobrevivente; o escolhido é absorvido (conversas, canais,
// negócios, tags, histórico passam pro sobrevivente). Backfill só-vazio (mantém
// foto/nome). Destrutivo (apaga o absorvido, com snapshot no audit_log) →
// gate fail-closed (admin/owner ou supervisor). Núcleo = função SQL merge_contacts.

/** Busca contatos pra escolher qual absorver (free-text, exclui o atual). */
export async function searchContactsForMerge(
  query: string, excludeId: string,
): Promise<{ id: string; name: string; phone: string | null; pic: string | null }[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const safe = query.replace(/[%,()\\*]/g, " ").trim()   // sanitiza pro filtro PostgREST .or
  if (safe.length < 2) return []
  const { data } = await supabaseAdmin.from("chat_contacts")
    .select("id, custom_name, push_name, phone_number, profile_pic_url")
    .eq("tenant_id", session.user.tenantId).neq("id", excludeId)
    .or(`custom_name.ilike.%${safe}%,push_name.ilike.%${safe}%,phone_number.ilike.%${safe}%,username.ilike.%${safe}%,wp_username.ilike.%${safe}%,ig_username.ilike.%${safe}%,email.ilike.%${safe}%`)
    .order("updated_at", { ascending: false }).limit(8)
  return (data ?? []).map((d) => {
    const r = d as { id: string; custom_name: string | null; push_name: string | null; phone_number: string | null; profile_pic_url: string | null }
    return { id: r.id, name: r.custom_name?.trim() || r.push_name?.trim() || r.phone_number || "Contato", phone: r.phone_number, pic: r.profile_pic_url }
  })
}

/** Atributos dos DOIS contatos pro comparativo do merge (lado a lado + inverter direção). */
export interface MergeSide {
  id: string; name: string; pic: string | null; lifecycle: string | null
  channels: string[]; phone: string | null; handle: string | null
  conversations: number; deals: number; tags: number
}
export async function getMergeComparison(
  aId: string, bId: string,
): Promise<{ a: MergeSide; b: MergeSide } | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  const t = session.user.tenantId

  const { data: rows } = await supabaseAdmin.from("chat_contacts")
    .select("id, custom_name, push_name, phone_number, profile_pic_url, lifecycle_stage, ig_username, wp_username")
    .eq("tenant_id", t).in("id", [aId, bId])
  if (!rows || rows.length !== 2) return null

  const { data: ids } = await supabaseAdmin.from("contact_identities")
    .select("contact_id, channel").eq("tenant_id", t).in("contact_id", [aId, bId]).in("channel", ["whatsapp", "instagram", "site"])
  const ORDER = ["whatsapp", "instagram", "site"]
  const chans = (cid: string) => ORDER.filter((ch) => (ids ?? []).some((i) => i.contact_id === cid && i.channel === ch))

  const head = (table: string, col: string, id: string) =>
    supabaseAdmin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", t).eq(col, id)

  async function side(cid: string): Promise<MergeSide> {
    const r = (rows!.find((x) => x.id === cid)) as Record<string, unknown>
    const [conv, deals, tags] = await Promise.all([
      head("chat_conversations", "contact_id", cid),
      head("tenant_deals", "contact_id", cid),
      supabaseAdmin.from("taggings").select("id", { count: "exact", head: true }).eq("tenant_id", t).eq("taggable_type", "contact").eq("taggable_id", cid),
    ])
    const ig = r.ig_username as string | null, wp = r.wp_username as string | null
    return {
      id: cid,
      name: (r.custom_name as string)?.trim() || (r.push_name as string)?.trim() || (r.phone_number as string) || "Contato",
      pic: (r.profile_pic_url as string | null) ?? null,
      lifecycle: (r.lifecycle_stage as string | null) ?? null,
      channels: chans(cid),
      phone: (r.phone_number as string | null) ?? null,
      handle: ig ? `@${ig}` : wp ? `@${wp}` : null,
      conversations: conv.count ?? 0, deals: deals.count ?? 0, tags: tags.count ?? 0,
    }
  }

  const [a, b] = await Promise.all([side(aId), side(bId)])
  return { a, b }
}

/** Prévia do que será movido do contato a ser absorvido (mostra na confirmação). */
export async function getMergePreview(
  loserId: string,
): Promise<{ conversations: number; channels: number; deals: number; tasks: number; tags: number; appointments: number } | null> {
  const session = await auth()
  if (!session?.user?.tenantId) return null
  const t = session.user.tenantId
  const head = (table: string, col: string) =>
    supabaseAdmin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", t).eq(col, loserId)
  const [conv, ident, deals, tasks, appts, tags] = await Promise.all([
    head("chat_conversations", "contact_id"),
    head("contact_identities", "contact_id"),
    head("tenant_deals", "contact_id"),
    head("tenant_tasks", "contact_id"),
    head("appointments", "contact_id"),
    supabaseAdmin.from("taggings").select("id", { count: "exact", head: true })
      .eq("tenant_id", t).eq("taggable_type", "contact").eq("taggable_id", loserId),
  ])
  return {
    conversations: conv.count ?? 0, channels: ident.count ?? 0, deals: deals.count ?? 0,
    tasks: tasks.count ?? 0, appointments: appts.count ?? 0, tags: tags.count ?? 0,
  }
}

/** Funde `loserId` → `survivorId` (mesmo tenant). Atômico via RPC merge_contacts. */
export async function mergeContacts(
  survivorId: string, loserId: string,
): Promise<{ ok: true; moved?: Record<string, number> } | { error: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  // 🔒 Gate fail-closed: só admin/owner ou supervisor (view_all) — operação destrutiva.
  if (!canManageContacts(scope)) return { error: "Você não tem permissão para vincular contatos." }
  if (survivorId === loserId) return { error: "Selecione dois contatos diferentes." }

  // Defense-in-depth: ambos precisam ser do tenant da sessão (a função SQL revalida).
  const { data: rows } = await supabaseAdmin.from("chat_contacts")
    .select("id").eq("tenant_id", scope.tenantId).in("id", [survivorId, loserId])
  if (!rows || rows.length !== 2) return { error: "Contato não encontrado neste workspace." }

  const { data, error } = await supabaseAdmin.rpc("merge_contacts", {
    p_survivor: survivorId, p_loser: loserId, p_tenant: scope.tenantId,
  })
  if (error) return { error: error.message }

  revalidatePath("/contatos")
  revalidatePath(`/contatos/${survivorId}`)
  return { ok: true, moved: (data as { moved?: Record<string, number> } | null)?.moved }
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
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  const tenantId = scope.tenantId

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

  // Fail-closed: se o número já pertence a um contato FORA do alcance do atendente,
  // não revela quem é nem duplica — devolve neutro (mesmo motor de /contatos).
  if (!seesAllContacts(scope)) {
    let ex = supabaseAdmin.from("chat_contacts").select("id").eq("tenant_id", tenantId)
    ex = jid ? ex.eq("whatsapp_id", jid) : ex.eq("bsuid", bsuid as string)
    const { data: existing } = await ex.maybeSingle()
    if (existing && !(await reachableContactIds(scope)).includes((existing as { id: string }).id)) {
      return { error: "Esse número já está cadastrado na empresa. Peça a um supervisor para liberar o acesso." }
    }
  }

  const r = await resolveOrCreateContact(
    tenantId,
    { jid, phone, bsuid, email },
    { customName: input.name?.trim() || null, source: "manual" },
  )
  return r
}

/**
 * Define/transfere o DONO da conta (carteira) de um contato — Gerenciar-contatos/admin (F1).
 * owner_id = null tira o dono (volta pro pool). Anti-IDOR: contato do tenant + dono = atendente ativo.
 */
export async function setContactOwner(contactId: string, ownerId: string | null): Promise<{ error?: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  if (!canManageContacts(scope)) return { error: "Só quem gerencia contatos pode definir o responsável." }

  const { data: c } = await supabaseAdmin.from("chat_contacts").select("id")
    .eq("id", contactId).eq("tenant_id", scope.tenantId).maybeSingle()
  if (!c) return { error: "Contato inválido" }

  if (ownerId) {
    const { data: m } = await supabaseAdmin.from("tenant_users").select("user_id")
      .eq("tenant_id", scope.tenantId).eq("user_id", ownerId).eq("active", true).maybeSingle()
    if (!m) return { error: "Responsável inválido" }
  }

  const { error } = await supabaseAdmin.from("chat_contacts")
    .update({ owner_id: ownerId, updated_at: new Date().toISOString() })
    .eq("id", contactId).eq("tenant_id", scope.tenantId)
  if (error) return { error: error.message }

  revalidatePath(`/contatos/${contactId}`)
  return {}
}
