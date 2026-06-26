import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Identidade de contato — RESOLVER CANÔNICO (fonte única)
// ═══════════════════════════════════════════════════════════════
// Acha-ou-cria um contato fazendo MERGE por qualquer chave de identidade
// (jid → bsuid → email). Backfill só do que falta; nunca apaga dado bom.
// TODA porta de criação passa por aqui (webhooks, manual, import) pra NUNCA
// fragmentar/duplicar contato. Doc: docs/contacts-cadastro-design.md §2.
//
// SEGURANÇA: tenantId sempre de session (nunca input do cliente); toda query
// com .eq('tenant_id'); corrida (23505) re-acha pela chave que colidiu.

export interface ContactKeys {
  jid?:       string | null   // whatsapp_id (telefone → <país+ddd+num>@s.whatsapp.net)
  bsuid?:     string | null   // identificador opaco do Meta Cloud
  phone?:     string | null   // dígitos com país (caller já normalizou)
  email?:     string | null
  instagram?: string | null   // IGSID — identidade via (primary_channel='instagram', primary_external_id=IGSID)
}

export interface ContactAttrs {
  pushName?:       string | null   // nome do WhatsApp (latest wins quando vier)
  customName?:     string | null   // nome digitado (cadastro manual)
  username?:       string | null   // @handle do WhatsApp — DISPLAY/mutável (latest wins), NÃO é chave
  source?:         string | null   // só na CRIAÇÃO; OMITIDO se undefined (deixa o default 'whatsapp_inbound')
  primaryChannel?: string | null
  /** Sempre carimba updated_at no merge (mesmo no-op) — paridade com o upsert dos webhooks (ordena /contatos). */
  touch?:          boolean
}

const COLS = "id, whatsapp_id, phone_number, bsuid, email, push_name, custom_name, primary_external_id"

export async function resolveOrCreateContact(
  tenantId: string,
  keys: ContactKeys,
  attrs: ContactAttrs = {},
): Promise<{ id: string; created: boolean }> {
  const jid       = keys.jid   ?? null
  const bsuid     = keys.bsuid ?? null
  const phone     = keys.phone ?? null
  const email     = keys.email ?? null
  const instagram = keys.instagram ?? null

  // 1) Acha pela 1ª chave que casar — ordem jid → bsuid → email → instagram.
  let existing: Record<string, unknown> | null = null
  if (jid) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("whatsapp_id", jid).maybeSingle()
    existing = data ?? null
  }
  if (!existing && bsuid) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("bsuid", bsuid).maybeSingle()
    existing = data ?? null
  }
  if (!existing && email) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("email", email).maybeSingle()
    existing = data ?? null
  }
  // Instagram: identidade sem chave comum com WhatsApp (IGSID) → casa por
  // (primary_channel='instagram', primary_external_id=IGSID). Unir com um contato
  // WhatsApp da mesma pessoa = merge/contact_identities (fase futura), não aqui.
  if (!existing && instagram) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("primary_channel", "instagram").eq("primary_external_id", instagram).maybeSingle()
    existing = data ?? null
  }

  // 2) MERGE — backfill só o que falta; nunca apaga dado bom.
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (jid   && !existing.whatsapp_id)  patch.whatsapp_id  = jid
    if (bsuid && !existing.bsuid)        patch.bsuid        = bsuid
    if (phone && !existing.phone_number) patch.phone_number = phone
    if (email && !existing.email)        patch.email        = email
    if (attrs.pushName)                  patch.push_name    = attrs.pushName              // latest do WhatsApp
    if (attrs.username)                  patch.username     = attrs.username              // @handle latest (mutável)
    if (attrs.customName && !existing.custom_name) patch.custom_name = attrs.customName   // não sobrescreve o que humano definiu
    // primary_external_id converge pro jid quando o telefone aparece (era "bsuid:…").
    if (jid && String(existing.primary_external_id ?? "").startsWith("bsuid:")) patch.primary_external_id = jid
    if (attrs.touch || Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await supabaseAdmin.from("chat_contacts").update(patch).eq("id", existing.id as string).eq("tenant_id", tenantId)
    }
    return { id: existing.id as string, created: false }
  }

  // 3) Cria. primary_external_id = jid ?? bsuid:<…> ?? email:<…> ?? IGSID.
  const primaryExternalId = jid ?? (bsuid ? `bsuid:${bsuid}` : (email ? `email:${email}` : (instagram ?? null)))
  const channel = attrs.primaryChannel ?? ((jid || phone || bsuid) ? "whatsapp" : email ? "email" : instagram ? "instagram" : "none")
  const insertObj: Record<string, unknown> = {
    tenant_id:           tenantId,
    whatsapp_id:         jid,
    phone_number:        phone,
    bsuid,
    email,
    push_name:           attrs.pushName ?? null,
    primary_channel:     channel,
    primary_external_id: primaryExternalId,
    updated_at:          new Date().toISOString(),
  }
  // OMITIDOS quando não informados → deixa o DEFAULT da coluna (source='whatsapp_inbound').
  // Paridade: os webhooks nunca setavam source/custom_name. Manual passa explícito.
  if (attrs.source !== undefined)     insertObj.source      = attrs.source
  if (attrs.customName !== undefined) insertObj.custom_name = attrs.customName
  if (attrs.username !== undefined)   insertObj.username    = attrs.username
  const { data, error } = await supabaseAdmin.from("chat_contacts").insert(insertObj).select("id").single()

  // Corrida: outro request criou o mesmo contato no meio → re-acha pela chave que colidiu.
  if (error?.code === "23505") {
    if (jid) {
      const { data: r } = await supabaseAdmin.from("chat_contacts").select("id").eq("tenant_id", tenantId).eq("whatsapp_id", jid).maybeSingle()
      if (r) return { id: r.id as string, created: false }
    }
    if (bsuid) {
      const { data: r } = await supabaseAdmin.from("chat_contacts").select("id").eq("tenant_id", tenantId).eq("bsuid", bsuid).maybeSingle()
      if (r) return { id: r.id as string, created: false }
    }
    if (instagram) {
      const { data: r } = await supabaseAdmin.from("chat_contacts").select("id").eq("tenant_id", tenantId).eq("primary_channel", "instagram").eq("primary_external_id", instagram).maybeSingle()
      if (r) return { id: r.id as string, created: false }
    }
  }
  if (error || !data) throw new Error(`resolveOrCreateContact: ${error?.message}`)
  return { id: data.id as string, created: true }
}
