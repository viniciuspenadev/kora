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

const COLS = "id, whatsapp_id, phone_number, bsuid, email, push_name, custom_name, primary_external_id, primary_channel"

/** Canal da identidade PRIMÁRIA (granular: whatsapp vs bsuid), derivado do primary_external_id. */
function primaryIdentityChannel(primaryExternalId: string | null, primaryChannel: string | null): string | null {
  if (!primaryExternalId) return null
  if (primaryExternalId.startsWith("bsuid:")) return "bsuid"
  if (primaryExternalId.startsWith("email:")) return "email"
  if (primaryChannel === "instagram") return "instagram"
  if (primaryChannel === "site")      return "site"
  return "whatsapp"   // jid cru
}

/**
 * Dual-write das identidades em `contact_identities` (FASE B). ESPELHA as colunas —
 * roda DEPOIS da escrita autoritativa e é BEST-EFFORT (try/catch, nunca lança) → o
 * comportamento do resolver fica intocado por construção (colunas seguem a verdade).
 * Idempotente (ON CONFLICT no quad). Garante exatamente 1 identidade primária por
 * contato (cobre a convergência bsuid→jid). Doc: docs/omnichannel-contact-design.md §3.3.
 */
export async function syncContactIdentities(
  tenantId: string, contactId: string,
  ids: { whatsapp?: string | null; bsuid?: string | null; email?: string | null; instagram?: string | null; site?: string | null },
  primaryExternalId: string | null, primaryChannel: string | null,
): Promise<void> {
  const rows = [
    ids.whatsapp  ? { channel: "whatsapp",  external_id: ids.whatsapp } : null,
    ids.bsuid     ? { channel: "bsuid",     external_id: ids.bsuid } : null,
    ids.email     ? { channel: "email",     external_id: ids.email.toLowerCase() } : null,
    ids.instagram ? { channel: "instagram", external_id: ids.instagram } : null,
    ids.site      ? { channel: "site",      external_id: ids.site } : null,
  ].filter((r): r is { channel: string; external_id: string } => r != null)
  if (rows.length === 0) return

  const primCh = primaryIdentityChannel(primaryExternalId, primaryChannel)
  try {
    await supabaseAdmin.from("contact_identities").upsert(
      rows.map((r) => ({
        tenant_id: tenantId, contact_id: contactId,
        channel: r.channel, external_id: r.external_id,
        is_primary: r.channel === primCh, updated_at: new Date().toISOString(),
      })),
      { onConflict: "tenant_id,contact_id,channel,external_id", ignoreDuplicates: true },
    )
    // Exatamente 1 primária = a do canal primário (corrige linhas pré-existentes do backfill).
    if (primCh) {
      await supabaseAdmin.from("contact_identities").update({ is_primary: false })
        .eq("tenant_id", tenantId).eq("contact_id", contactId).eq("is_primary", true).neq("channel", primCh)
      await supabaseAdmin.from("contact_identities").update({ is_primary: true })
        .eq("tenant_id", tenantId).eq("contact_id", contactId).eq("channel", primCh).eq("is_primary", false)
    }
  } catch (e) {
    console.error("[identity-sync]", (e as Error).message)
  }
}

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
  // (primary_channel='instagram', primary_external_id=IGSID).
  if (!existing && instagram) {
    const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("primary_channel", "instagram").eq("primary_external_id", instagram).maybeSingle()
    existing = data ?? null
  }

  // Fallback via contact_identities — cobre contatos MESCLADOS (F6): após o merge, a
  // identidade de um canal vira SECUNDÁRIA (sai das colunas-âncora do chat_contacts).
  // Sem isto, a próxima msg desse canal re-criaria um contato separado (re-split do
  // merge). Só chaves ÚNICAS (whatsapp/bsuid/instagram); email é compartilhado (ambíguo).
  if (!existing) {
    const idChecks: { channel: string; ext: string }[] = []
    if (jid)       idChecks.push({ channel: "whatsapp",  ext: jid })
    if (bsuid)     idChecks.push({ channel: "bsuid",     ext: bsuid })
    if (instagram) idChecks.push({ channel: "instagram", ext: instagram })
    for (const c of idChecks) {
      const { data: idRow } = await supabaseAdmin.from("contact_identities")
        .select("contact_id").eq("tenant_id", tenantId).eq("channel", c.channel).eq("external_id", c.ext).maybeSingle()
      if (idRow) {
        const { data } = await supabaseAdmin.from("chat_contacts").select(COLS).eq("tenant_id", tenantId).eq("id", idRow.contact_id as string).maybeSingle()
        if (data) { existing = data; break }
      }
    }
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
    // Dual-write: só quando ENTROU/CONVERGIU identidade (não em touch puro). Re-afirma as
    // identidades de coluna do contato (existente ?? desta chamada) → idempotente + auto-cura gaps.
    if (patch.whatsapp_id || patch.bsuid || patch.email || patch.primary_external_id) {
      const pei = (patch.primary_external_id as string | undefined) ?? (existing.primary_external_id as string | null)
      await syncContactIdentities(tenantId, existing.id as string, {
        whatsapp:  (existing.whatsapp_id as string | null) ?? jid,
        bsuid:     (existing.bsuid as string | null) ?? bsuid,
        email:     (existing.email as string | null) ?? email,
        instagram,
      }, pei, existing.primary_channel as string | null)
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
  // Dual-write das identidades do contato recém-criado (best-effort).
  await syncContactIdentities(tenantId, data.id as string, { whatsapp: jid, bsuid, email, instagram }, primaryExternalId, channel)
  return { id: data.id as string, created: true }
}
