"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { normalizeWhatsAppPhone } from "@/lib/phone-utils"
import { getViewerScope, canManageContacts } from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Importar contatos (F4) — prévia anti-duplicado + commit dedup-safe + registro
// ═══════════════════════════════════════════════════════════════
// Commit passa pelo RESOLVER CANÔNICO → nunca duplica. Cada import vira um
// registro (contact_imports) + vínculo por contato (contact_import_items).

export interface ImportRow { name?: string; phone?: string; email?: string }
export type RowStatus = "new" | "existing" | "invalid"
export interface PreviewRow { name: string; phone: string; email: string; status: RowStatus; reason?: string }
export interface ImportPreview {
  summary: { total: number; novos: number; existentes: number; invalidos: number }
  rows: PreviewRow[]
}

const MAX_ROWS = 500

export async function previewImport(rows: ImportRow[]): Promise<ImportPreview | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const scope = await getViewerScope()
  if (!canManageContacts(scope)) return { error: "Só quem gerencia contatos pode importar." }
  if (rows.length === 0) return { error: "Nenhuma linha pra importar." }
  if (rows.length > MAX_ROWS) return { error: `Máximo ${MAX_ROWS} contatos por vez (lotes maiores em breve).` }
  const tenantId = session.user.tenantId

  const norm = rows.map((r) => {
    const n = normalizeWhatsAppPhone(r.phone)
    return { name: (r.name ?? "").trim(), email: (r.email ?? "").trim(), rawPhone: (r.phone ?? "").trim(), jid: n?.jid ?? null, phone: n?.phone ?? "" }
  })

  const validJids = [...new Set(norm.filter((x) => x.jid).map((x) => x.jid as string))]
  const existing = new Set<string>()
  for (let i = 0; i < validJids.length; i += 300) {
    const { data } = await supabaseAdmin.from("chat_contacts").select("whatsapp_id").eq("tenant_id", tenantId).in("whatsapp_id", validJids.slice(i, i + 300))
    for (const r of (data ?? []) as { whatsapp_id: string }[]) existing.add(r.whatsapp_id)
  }

  let novos = 0, existentes = 0, invalidos = 0
  const out: PreviewRow[] = norm.map((x) => {
    if (!x.jid) { invalidos++; return { name: x.name, phone: x.rawPhone, email: x.email, status: "invalid", reason: "Telefone inválido" } }
    const status: RowStatus = existing.has(x.jid) ? "existing" : "new"
    status === "existing" ? existentes++ : novos++
    return { name: x.name, phone: x.phone, email: x.email, status }
  })
  return { summary: { total: rows.length, novos, existentes, invalidos }, rows: out }
}

export async function commitImport(input: {
  rows: ImportRow[]
  tagId?:   string | null
  consent?: boolean
  /** Declaração do cliente: esta base autorizou receber MARKETING (habilita campanhas). */
  marketingConsent?: boolean
  source?:  "paste" | "csv"
}): Promise<{ importId: string; criados: number; atualizados: number; invalidos: number } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const scope = await getViewerScope()
  if (!canManageContacts(scope)) return { error: "Só quem gerencia contatos pode importar." }
  if (input.rows.length > MAX_ROWS) return { error: `Máximo ${MAX_ROWS} contatos por vez.` }
  const tenantId = session.user.tenantId
  const now = new Date().toISOString()
  // Marketing implica contatável; a origem carimba QUEM declarou (auditoria/LGPD).
  const wantMarketing = !!input.marketingConsent
  const wantConsent   = wantMarketing || !!input.consent
  const consentSource = `import — declarado por ${session.user.name ?? session.user.email ?? "gestor"}${wantMarketing ? " (marketing)" : ""}`

  // Valida a tag ao tenant (anti cross-tenant ref).
  let validTagId: string | null = null
  if (input.tagId) {
    const { data: tg } = await supabaseAdmin.from("tags").select("id").eq("id", input.tagId).eq("tenant_id", tenantId).maybeSingle()
    validTagId = tg ? input.tagId : null
  }

  let criados = 0, atualizados = 0, invalidos = 0
  const items: { contact_id: string; status: "created" | "updated" }[] = []
  for (const r of input.rows) {
    const n = normalizeWhatsAppPhone(r.phone)
    if (!n) { invalidos++; continue }
    try {
      const res = await resolveOrCreateContact(tenantId, { jid: n.jid, phone: n.phone, email: r.email?.trim() || null }, { customName: r.name?.trim() || null, source: "import" })
      res.created ? criados++ : atualizados++
      items.push({ contact_id: res.id, status: res.created ? "created" : "updated" })
      if (validTagId) {
        await supabaseAdmin.from("taggings").insert({ tenant_id: tenantId, tag_id: validTagId, taggable_type: "contact", taggable_id: res.id }).then(() => {}, () => {})
      }
      if (wantConsent) {
        await supabaseAdmin.from("chat_contacts").update({
          consent_opt_in: true, consent_at: now, consent_source: consentSource,
          ...(wantMarketing ? { marketing_opt_in: true } : {}),
          updated_at: now,
        }).eq("id", res.id).eq("tenant_id", tenantId)
      }
    } catch (e) {
      console.error("[import] linha falhou:", e instanceof Error ? e.message : e)
      invalidos++
    }
  }

  // Registro do import + itens (vínculo por contato).
  const { data: imp, error: impErr } = await supabaseAdmin.from("contact_imports").insert({
    tenant_id: tenantId, created_by: session.user.id, source: input.source ?? "paste",
    total: input.rows.length, created: criados, updated: atualizados, invalid: invalidos,
    tag_id: input.tagId ?? null, consent: !!input.consent,
  }).select("id").single()
  const importId = (imp as { id: string } | null)?.id ?? ""
  if (impErr) console.error("[import] registro falhou:", impErr.message)
  if (importId && items.length) {
    const rows = items.map((it) => ({ import_id: importId, contact_id: it.contact_id, tenant_id: tenantId, status: it.status }))
    for (let i = 0; i < rows.length; i += 500) await supabaseAdmin.from("contact_import_items").insert(rows.slice(i, i + 500)).then(() => {}, () => {})
  }
  return { importId, criados, atualizados, invalidos }
}

export interface ImportRecord {
  id: string; source: string; total: number; created: number; updated: number; invalid: number
  consent: boolean; created_at: string; tag_name: string | null; by_name: string | null
}

/** Histórico de importações do tenant. */
export async function listImports(): Promise<ImportRecord[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const tenantId = session.user.tenantId
  const { data } = await supabaseAdmin.from("contact_imports")
    .select("id, source, total, created, updated, invalid, consent, created_at, tag_id, created_by")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50)
  const imps = (data ?? []) as Record<string, unknown>[]
  const tagIds = [...new Set(imps.map((i) => i.tag_id).filter(Boolean) as string[])]
  const userIds = [...new Set(imps.map((i) => i.created_by).filter(Boolean) as string[])]
  const tagMap = new Map<string, string>(), userMap = new Map<string, string>()
  if (tagIds.length) { const { data: t } = await supabaseAdmin.from("tags").select("id, name").in("id", tagIds); for (const x of (t ?? []) as { id: string; name: string }[]) tagMap.set(x.id, x.name) }
  if (userIds.length) { const { data: u } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds); for (const x of (u ?? []) as { id: string; full_name: string }[]) userMap.set(x.id, x.full_name) }
  return imps.map((i) => ({
    id: i.id as string, source: i.source as string, total: i.total as number, created: i.created as number,
    updated: i.updated as number, invalid: i.invalid as number, consent: i.consent as boolean, created_at: i.created_at as string,
    tag_name: i.tag_id ? (tagMap.get(i.tag_id as string) ?? null) : null,
    by_name: i.created_by ? (userMap.get(i.created_by as string) ?? null) : null,
  }))
}

export interface ImportContact { id: string; name: string; phone: string | null; status: string }

/** Contatos de UMA importação (pra "ver os contatos deste import"). */
export async function getImportContacts(importId: string): Promise<{ record: ImportRecord | null; contacts: ImportContact[] }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { record: null, contacts: [] }
  const tenantId = session.user.tenantId
  const { data: items } = await supabaseAdmin.from("contact_import_items")
    .select("contact_id, status, chat_contacts ( id, custom_name, push_name, phone_number )")
    .eq("import_id", importId).eq("tenant_id", tenantId).limit(MAX_ROWS)
  const contacts: ImportContact[] = ((items ?? []) as Record<string, unknown>[]).map((it) => {
    const c = it.chat_contacts as { id: string; custom_name: string | null; push_name: string | null; phone_number: string | null } | null
    return { id: c?.id ?? (it.contact_id as string), name: c?.custom_name?.trim() || c?.push_name?.trim() || "Contato", phone: c?.phone_number ?? null, status: it.status as string }
  })
  const [rec] = await listImports().then((l) => l.filter((r) => r.id === importId))
  return { record: rec ?? null, contacts }
}
