"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { rateLimit } from "@/lib/rate-limit"
import { docCode, type DocumentStatus } from "@/lib/commercial/documents"

// ─────────────────────────────────────────────────────────────────────────────
// Empresa-cliente (PJ) — entidade tenant_companies (F2). Ver docs/crm-companies-entity-design.md.
// database-rules: SÓ supabaseAdmin · escopo de tenant SEMPRE · allow-list de colunas (anti
// mass-assignment §2) · a tabela é fail-closed (REVOKE, RLS tenant_isolation).
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanyInput {
  name?:         string
  legal_name?:   string | null
  doc_id?:       string | null   // CNPJ (guardado em dígitos)
  email?:        string | null
  phone?:        string | null
  site?:         string | null
  address_cep?:  string | null
  address_street?: string | null
  address_number?: string | null
  address_complement?: string | null
  address_district?: string | null
  address_city?: string | null
  address_state?: string | null
  price_table_id?: string | null
  owner_id?:     string | null
  notes?:        string | null
  // Fiscais reservados (fundação NF-e — nullable, sem motor)
  ie?:           string | null
  ie_indicador?: string | null
  im?:           string | null
  tax_regime?:   string | null
  municipio_ibge?: string | null
  // Cadastro completo — dados de NEGÓCIO da Receita (nunca QSA/sócios/PII)
  registration_status?: string | null   // situação cadastral (Ativa/Baixada/…)
  opening_date?:        string | null   // 'YYYY-MM-DD'
  legal_nature?:        string | null
  company_size?:        string | null
  cnae_main?:           string | null
  cnae_main_label?:     string | null
  cnae_secondary?:      { code: string; label: string }[] | null
  share_capital?:       number | null
  segment?:             string | null
  billing_email?:       string | null
}

export interface Company extends CompanyInput {
  id: string
  archived_at: string | null   // null = ativa (arquivar sem apagar); nunca vem pelo input
  created_at: string
  updated_at: string
}

/** Allow-list explícita (§2 — NUNCA espalhar objeto do cliente: reescreveria tenant_id/id). */
function pickCompanyColumns(input: CompanyInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : null)
  if (input.name              !== undefined) out.name              = typeof input.name === "string" ? input.name.trim() : null
  if (input.legal_name        !== undefined) out.legal_name        = str(input.legal_name)
  if (input.doc_id            !== undefined) out.doc_id            = input.doc_id ? String(input.doc_id).replace(/\D/g, "") || null : null
  if (input.email             !== undefined) out.email             = str(input.email)?.toLowerCase() ?? null
  if (input.phone             !== undefined) out.phone             = str(input.phone)
  if (input.site              !== undefined) out.site              = str(input.site)
  if (input.address_cep        !== undefined) out.address_cep        = input.address_cep ? String(input.address_cep).replace(/\D/g, "") || null : null
  if (input.address_street     !== undefined) out.address_street     = str(input.address_street)
  if (input.address_number     !== undefined) out.address_number     = str(input.address_number)
  if (input.address_complement !== undefined) out.address_complement = str(input.address_complement)
  if (input.address_district   !== undefined) out.address_district   = str(input.address_district)
  if (input.address_city       !== undefined) out.address_city       = str(input.address_city)
  if (input.address_state      !== undefined) out.address_state      = str(input.address_state)?.toUpperCase().slice(0, 2) ?? null
  if (input.price_table_id    !== undefined) out.price_table_id    = input.price_table_id || null
  if (input.owner_id          !== undefined) out.owner_id          = input.owner_id || null
  if (input.notes             !== undefined) out.notes             = str(input.notes)
  if (input.ie                !== undefined) out.ie                = str(input.ie)
  if (input.ie_indicador      !== undefined) out.ie_indicador      = ["1", "2", "9"].includes(String(input.ie_indicador)) ? String(input.ie_indicador) : null
  if (input.im                !== undefined) out.im                = str(input.im)
  if (input.tax_regime        !== undefined) out.tax_regime        = str(input.tax_regime)
  if (input.municipio_ibge    !== undefined) out.municipio_ibge    = input.municipio_ibge ? String(input.municipio_ibge).replace(/\D/g, "") || null : null
  // Cadastro completo (dados de negócio — nunca QSA/sócios).
  if (input.registration_status !== undefined) out.registration_status = str(input.registration_status)
  if (input.opening_date        !== undefined) {
    const v = str(input.opening_date)
    out.opening_date = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
  }
  if (input.legal_nature      !== undefined) out.legal_nature      = str(input.legal_nature)
  if (input.company_size      !== undefined) out.company_size      = str(input.company_size)
  if (input.cnae_main         !== undefined) out.cnae_main         = str(input.cnae_main)
  if (input.cnae_main_label   !== undefined) out.cnae_main_label   = str(input.cnae_main_label)
  if (input.cnae_secondary    !== undefined) {
    out.cnae_secondary = Array.isArray(input.cnae_secondary)
      ? input.cnae_secondary
          .map((x) => (x && typeof x === "object"
            ? { code: str((x as { code?: unknown }).code) ?? "", label: str((x as { label?: unknown }).label) ?? "" }
            : null))
          .filter((x): x is { code: string; label: string } => x !== null && (x.code !== "" || x.label !== ""))
      : null
  }
  if (input.share_capital     !== undefined) out.share_capital     = typeof input.share_capital === "number" && Number.isFinite(input.share_capital) ? input.share_capital : null
  if (input.segment           !== undefined) out.segment           = str(input.segment)
  if (input.billing_email     !== undefined) out.billing_email     = str(input.billing_email)?.toLowerCase() ?? null
  return out
}

const COMPANY_COLS = "id, name, legal_name, doc_id, email, phone, site, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, address_country, price_table_id, owner_id, notes, ie, ie_indicador, im, tax_regime, municipio_ibge, registration_status, opening_date, legal_nature, company_size, cnae_main, cnae_main_label, cnae_secondary, share_capital, segment, billing_email, archived_at, custom_fields, created_at, updated_at"

/**
 * Find-or-create de empresa (helper interno — espelha resolveOrCreateContact). Dedup por
 * CNPJ (dígitos) dentro do tenant; sem CNPJ = cria nova (nome não é chave). Backfill só o
 * que falta, nunca apaga. NÃO gateia (chamado por actions já gateadas / orquestração do wizard).
 */
export async function resolveOrCreateCompany(
  tenantId: string, input: CompanyInput, createdBy: string | null = null,
): Promise<{ id: string; created: boolean } | { error: string }> {
  const cols = pickCompanyColumns(input)
  if (!cols.name) return { error: "Informe o nome da empresa." }
  const docId = (cols.doc_id as string | null) ?? null

  // 1) Acha por CNPJ (única chave confiável de dedup).
  if (docId) {
    const { data: ex } = await supabaseAdmin.from("tenant_companies")
      .select(COMPANY_COLS).eq("tenant_id", tenantId).eq("doc_id", docId).maybeSingle()
    if (ex) {
      const row = ex as Record<string, unknown>
      // Backfill só o que está vazio hoje (nunca sobrescreve dado bom).
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(cols)) {
        if (k === "name" || k === "doc_id") continue
        if (v != null && (row[k] == null || row[k] === "")) patch[k] = v
      }
      if (Object.keys(patch).length) {
        patch.updated_at = new Date().toISOString()
        await supabaseAdmin.from("tenant_companies").update(patch).eq("id", row.id as string).eq("tenant_id", tenantId)
      }
      return { id: row.id as string, created: false }
    }
  }

  // 2) Cria.
  const { data, error } = await supabaseAdmin.from("tenant_companies")
    .insert({ ...cols, tenant_id: tenantId, created_by: createdBy })
    .select("id").single()
  if (error || !data) return { error: error?.message ?? "Falha ao criar empresa." }
  return { id: (data as { id: string }).id, created: true }
}

/** Cria/vincula empresa (server action pro wizard/ficha). Gate: módulo CRM + tenant. */
export async function createCompany(input: CompanyInput): Promise<{ id: string; created: boolean } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  return resolveOrCreateCompany(session.user.tenantId, input, session.user.id)
}

/** Lê uma empresa (escopo de tenant). */
export async function getCompany(companyId: string): Promise<Company | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const { data } = await supabaseAdmin.from("tenant_companies")
    .select(COMPANY_COLS).eq("id", companyId).eq("tenant_id", session.user.tenantId).maybeSingle()
  if (!data) return { error: "Empresa não encontrada" }
  return data as unknown as Company
}

/** Atualiza uma empresa (allow-list de colunas; gate gerenciar-contatos). */
export async function updateCompany(companyId: string, input: CompanyInput): Promise<{ error?: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  if (!canManageContacts(scope)) return { error: "Sem permissão para editar a empresa." }
  const cols = pickCompanyColumns(input)
  if (Object.keys(cols).length === 0) return {}
  cols.updated_at = new Date().toISOString()
  const { error } = await supabaseAdmin.from("tenant_companies")
    .update(cols).eq("id", companyId).eq("tenant_id", scope.tenantId)
  return error ? { error: error.message } : {}
}

/**
 * Arquiva/desarquiva uma empresa (soft — nunca apaga; preserva vínculos contato/deal).
 * `archived=true` grava archived_at=now; `false` limpa (volta a listar). Gate gerenciar-contatos.
 */
export async function archiveCompany(companyId: string, archived: boolean): Promise<{ error?: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  if (!canManageContacts(scope)) return { error: "Sem permissão para arquivar a empresa." }
  const { error } = await supabaseAdmin.from("tenant_companies")
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("id", companyId).eq("tenant_id", scope.tenantId)
  return error ? { error: error.message } : {}
}

export interface CompanyLite { id: string; name: string; legal_name: string | null; doc_id: string | null; city: string | null; archived_at: string | null }

/** Busca empresas por nome/CNPJ (escopo de tenant, rate-limited). Pro picker "Empresa".
 *  Inclui arquivadas (o resolvedor mostra badge + reativa ao abrir — evita fork de duplicata). */
export async function searchCompanies(query: string): Promise<CompanyLite[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const rl = rateLimit(`search:companies:${session.user.id}`, 30, 60_000)
  if (!rl.ok) return []
  const q = query.trim()
  if (q.length < 2) return []
  const digits = q.replace(/\D/g, "")
  const like = `%${q}%`
  let sel = supabaseAdmin.from("tenant_companies")
    .select("id, name, legal_name, doc_id, address_city, archived_at").eq("tenant_id", session.user.tenantId)
  sel = digits.length >= 3
    ? sel.or(`name.ilike.${like},legal_name.ilike.${like},doc_id.ilike.%${digits}%`)
    : sel.or(`name.ilike.${like},legal_name.ilike.${like}`)
  const { data } = await sel.order("name", { ascending: true }).limit(20)
  return ((data ?? []) as { id: string; name: string; legal_name: string | null; doc_id: string | null; address_city: string | null; archived_at: string | null }[])
    .map((c) => ({ id: c.id, name: c.name, legal_name: c.legal_name, doc_id: c.doc_id, city: c.address_city, archived_at: c.archived_at }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista paginada de empresas + ficha (overview). Padrão canônico: cursor keyset
// (name, id) ASC + contadores em LOTE (sem N+1). Gate: módulo CRM + tenant.
// ─────────────────────────────────────────────────────────────────────────────

/** Escapa valor pra filtro PostgREST entre aspas — nomes têm vírgula/parênteses que
 *  quebram o or()-string. SÓ pra comparação exata (gt/eq); ilike usa termo saneado. */
function pgLit(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export interface CompanyListItem {
  id:            string
  name:          string
  legal_name:    string | null
  doc_id:        string | null
  city:          string | null
  contactCount:  number
  openDealCount: number
  openValue:     number   // soma de estimated_value dos negócios ABERTOS da empresa
}

export interface CompaniesCursor { name: string; id: string }

export interface CompaniesPage {
  items:      CompanyListItem[]
  nextCursor: CompaniesCursor | null
  hasMore:    boolean
}

/**
 * Lista paginada de empresas (cursor keyset por (name, id) ASC). `query` (≥2 chars)
 * filtra ILIKE em name/legal_name + doc_id por dígitos. Contadores por empresa
 * (contatos · negócios abertos · valor em aberto) resolvidos em LOTE pra a página.
 */
export async function getCompanies(
  opts: { query?: string; cursor?: CompaniesCursor | null; limit?: number } = {},
): Promise<CompaniesPage> {
  const empty: CompaniesPage = { items: [], nextCursor: null, hasMore: false }
  const session = await auth()
  if (!session?.user?.tenantId) return empty
  try { await requireModule("crm") } catch { return empty }
  const tenantId = session.user.tenantId
  const limit  = Math.min(Math.max(opts.limit ?? 30, 1), 100)
  const cursor = opts.cursor ?? null

  let q = supabaseAdmin.from("tenant_companies")
    .select("id, name, legal_name, doc_id, address_city")
    .eq("tenant_id", tenantId)
    .is("archived_at", null)   // arquivadas ficam fora da lista por padrão (soft-archive)

  const raw = (opts.query ?? "").trim()
  if (raw.length >= 2) {
    // Saneia chars que quebram o or()-string do PostgREST (vírgula/parênteses/backslash/wildcards).
    const term   = raw.replace(/[,()\\%*]/g, " ").trim()
    const digits = raw.replace(/\D/g, "")
    const like   = `%${term}%`
    if (term && digits.length >= 3) {
      q = q.or(`name.ilike.${like},legal_name.ilike.${like},doc_id.ilike.%${digits}%`)
    } else if (term) {
      q = q.or(`name.ilike.${like},legal_name.ilike.${like}`)
    } else if (digits.length >= 3) {
      q = q.ilike("doc_id", `%${digits}%`)
    }
  }

  // Keyset (name, id) ASC — tie-break por id pra ordem estável (name é NOT NULL).
  if (cursor) {
    q = q.or(`name.gt.${pgLit(cursor.name)},and(name.eq.${pgLit(cursor.name)},id.gt.${cursor.id})`)
  }

  q = q.order("name", { ascending: true }).order("id", { ascending: true }).limit(limit + 1)

  const { data, error } = await q
  if (error) return empty
  const rows = (data ?? []) as { id: string; name: string; legal_name: string | null; doc_id: string | null; address_city: string | null }[]
  const hasMore = rows.length > limit
  const page    = hasMore ? rows.slice(0, limit) : rows

  // Contadores em LOTE (evita N+1): contatos + negócios abertos das empresas da página.
  const ids = page.map((c) => c.id)
  const contactCount  = new Map<string, number>()
  const openDealCount = new Map<string, number>()
  const openValue     = new Map<string, number>()
  if (ids.length) {
    const [{ data: contacts }, { data: deals }] = await Promise.all([
      supabaseAdmin.from("chat_contacts").select("company_id")
        .eq("tenant_id", tenantId).in("company_id", ids).limit(10000),
      supabaseAdmin.from("tenant_deals").select("company_id, estimated_value")
        .eq("tenant_id", tenantId).eq("status", "open").in("company_id", ids).limit(10000),
    ])
    for (const r of (contacts ?? []) as { company_id: string | null }[]) {
      if (r.company_id) contactCount.set(r.company_id, (contactCount.get(r.company_id) ?? 0) + 1)
    }
    for (const r of (deals ?? []) as { company_id: string | null; estimated_value: number | null }[]) {
      if (!r.company_id) continue
      openDealCount.set(r.company_id, (openDealCount.get(r.company_id) ?? 0) + 1)
      openValue.set(r.company_id, (openValue.get(r.company_id) ?? 0) + Number(r.estimated_value ?? 0))
    }
  }

  const items: CompanyListItem[] = page.map((c) => ({
    id:            c.id,
    name:          c.name,
    legal_name:    c.legal_name,
    doc_id:        c.doc_id,
    city:          c.address_city,
    contactCount:  contactCount.get(c.id) ?? 0,
    openDealCount: openDealCount.get(c.id) ?? 0,
    openValue:     openValue.get(c.id) ?? 0,
  }))

  const last = page[page.length - 1]
  const nextCursor: CompaniesCursor | null = hasMore && last ? { name: last.name, id: last.id } : null
  return { items, nextCursor, hasMore }
}

export interface CompanyRosterItem {
  id: string; name: string; legal_name: string | null; doc_id: string | null; city: string | null
  segment: string | null; registration_status: string | null
  owner_id: string | null; owner_name: string | null; archived_at: string | null
  contactCount: number; openDealCount: number; openValue: number; wonCount: number; wonValue: number
}

/**
 * Roster ENRIQUECIDO da lista de empresas — carga única (cap 500, INCLUI arquivadas p/ a
 * aba) com Situação·Segmento·Responsável + contadores em LOTE. Busca/abas/segmento filtram
 * client-side (instantâneo), espelhando o padrão do /contatos. Escopo tenant-wide (F2).
 */
export async function getCompaniesRoster(): Promise<CompanyRosterItem[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  try { await requireModule("crm") } catch { return [] }
  const t = session.user.tenantId

  const { data } = await supabaseAdmin.from("tenant_companies")
    .select("id, name, legal_name, doc_id, address_city, segment, registration_status, owner_id, archived_at")
    .eq("tenant_id", t).order("name", { ascending: true }).limit(500)
  const rows = (data ?? []) as {
    id: string; name: string; legal_name: string | null; doc_id: string | null; address_city: string | null
    segment: string | null; registration_status: string | null; owner_id: string | null; archived_at: string | null
  }[]
  if (!rows.length) return []

  const ids      = rows.map((c) => c.id)
  const ownerIds = Array.from(new Set(rows.map((c) => c.owner_id).filter(Boolean))) as string[]
  const contactCount = new Map<string, number>(), ownerName = new Map<string, string>()
  const openDealCount = new Map<string, number>(), openValue = new Map<string, number>()
  const wonCount = new Map<string, number>(), wonValue = new Map<string, number>()
  const [{ data: contacts }, { data: deals }, { data: owners }] = await Promise.all([
    supabaseAdmin.from("chat_contacts").select("company_id").eq("tenant_id", t).in("company_id", ids).limit(10000),
    supabaseAdmin.from("tenant_deals").select("company_id, status, estimated_value").eq("tenant_id", t).in("status", ["open", "won"]).in("company_id", ids).limit(10000),
    ownerIds.length ? supabaseAdmin.from("profiles").select("id, full_name").in("id", ownerIds) : Promise.resolve({ data: [] as unknown[] }),
  ])
  for (const r of (contacts ?? []) as { company_id: string | null }[]) if (r.company_id) contactCount.set(r.company_id, (contactCount.get(r.company_id) ?? 0) + 1)
  for (const r of (deals ?? []) as { company_id: string | null; status: string; estimated_value: number | null }[]) {
    if (!r.company_id) continue
    const v = Number(r.estimated_value ?? 0)
    if (r.status === "open") { openDealCount.set(r.company_id, (openDealCount.get(r.company_id) ?? 0) + 1); openValue.set(r.company_id, (openValue.get(r.company_id) ?? 0) + v) }
    else if (r.status === "won") { wonCount.set(r.company_id, (wonCount.get(r.company_id) ?? 0) + 1); wonValue.set(r.company_id, (wonValue.get(r.company_id) ?? 0) + v) }
  }
  for (const p of (owners ?? []) as { id: string; full_name: string | null }[]) ownerName.set(p.id, p.full_name ?? "—")

  return rows.map((c) => ({
    id: c.id, name: c.name, legal_name: c.legal_name, doc_id: c.doc_id, city: c.address_city,
    segment: c.segment, registration_status: c.registration_status,
    owner_id: c.owner_id, owner_name: c.owner_id ? (ownerName.get(c.owner_id) ?? null) : null,
    archived_at: c.archived_at,
    contactCount:  contactCount.get(c.id) ?? 0,
    openDealCount: openDealCount.get(c.id) ?? 0,
    openValue:     openValue.get(c.id) ?? 0,
    wonCount:      wonCount.get(c.id) ?? 0,
    wonValue:      wonValue.get(c.id) ?? 0,
  }))
}

export interface CompanyContactLite {
  id:              string
  name:            string
  phone_number:    string | null
  profile_pic_url: string | null
  lifecycle_stage: string | null
}

export interface CompanyDealLite {
  id:              string
  name:            string | null
  status:          string
  estimated_value: number | null
  stage:           string | null
  updated_at:      string | null
}

export interface CompanyOverview {
  company:  Company
  contacts: CompanyContactLite[]
  deals:    CompanyDealLite[]
  kpis: {
    contactCount:  number
    openDealCount: number
    openValue:     number   // soma estimated_value dos abertos
    wonValue:      number   // soma estimated_value dos ganhos
  }
}

/**
 * Ficha da empresa: dados + contatos vinculados + negócios da empresa + KPIs.
 * Negócios/agregados usam o CARIMBO `tenant_deals.company_id` (derive-at-read fica
 * pro cartão do negócio individual). Gate: módulo CRM + tenant.
 */
export async function getCompanyOverview(companyId: string): Promise<CompanyOverview | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const tenantId = session.user.tenantId

  const { data: companyRow } = await supabaseAdmin.from("tenant_companies")
    .select(COMPANY_COLS).eq("id", companyId).eq("tenant_id", tenantId).maybeSingle()
  if (!companyRow) return { error: "Empresa não encontrada" }

  const [{ data: contactRows }, { data: dealRows }, { count: contactCount }, { data: aggRows }] = await Promise.all([
    supabaseAdmin.from("chat_contacts")
      .select("id, custom_name, push_name, phone_number, profile_pic_url, lifecycle_stage")
      .eq("tenant_id", tenantId).eq("company_id", companyId)
      .order("custom_name", { ascending: true, nullsFirst: false }).limit(200),
    supabaseAdmin.from("tenant_deals")
      .select("id, name, status, estimated_value, updated_at, deal_pipeline_stages ( name )")
      .eq("tenant_id", tenantId).eq("company_id", companyId)
      .order("updated_at", { ascending: false }).limit(20),
    supabaseAdmin.from("chat_contacts")
      .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("company_id", companyId),
    supabaseAdmin.from("tenant_deals")
      .select("status, estimated_value").eq("tenant_id", tenantId).eq("company_id", companyId)
      .in("status", ["open", "won"]).limit(5000),
  ])

  const contacts: CompanyContactLite[] = ((contactRows ?? []) as Record<string, unknown>[]).map((c) => ({
    id:              c.id as string,
    name:            (c.custom_name as string | null)?.trim() || (c.push_name as string | null)?.trim() || "Sem nome",
    phone_number:    (c.phone_number as string | null) ?? null,
    profile_pic_url: (c.profile_pic_url as string | null) ?? null,
    lifecycle_stage: (c.lifecycle_stage as string | null) ?? null,
  }))

  const deals: CompanyDealLite[] = ((dealRows ?? []) as Record<string, unknown>[]).map((d) => ({
    id:              d.id as string,
    name:            (d.name as string | null) ?? null,
    status:          d.status as string,
    estimated_value: (d.estimated_value as number | null) ?? null,
    stage:           (d.deal_pipeline_stages as { name: string | null } | null)?.name ?? null,
    updated_at:      (d.updated_at as string | null) ?? null,
  }))

  let openDealCount = 0, openValue = 0, wonValue = 0
  for (const r of (aggRows ?? []) as { status: string; estimated_value: number | null }[]) {
    const v = Number(r.estimated_value ?? 0)
    if (r.status === "open") { openDealCount += 1; openValue += v }
    else if (r.status === "won") { wonValue += v }
  }

  return {
    company:  companyRow as unknown as Company,
    contacts,
    deals,
    kpis: { contactCount: contactCount ?? 0, openDealCount, openValue, wonValue },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COCKPIT da conta (Visão geral da ficha) — agrega negócios/propostas/atividade da
// empresa. Escopo de CONTA (tenant): a ficha mostra o panorama completo da conta
// (consistente com getCompanyOverview). Gate: módulo CRM + tenant. Zero migration.
// ─────────────────────────────────────────────────────────────────────────────

export interface CockpitDeal {
  id: string; name: string | null; status: string; estimated_value: number | null
  stage: string | null; stage_color: string | null; expected_close_date: string | null; updated_at: string | null
  // enriquecimento p/ a linha rica (espelha DealRowLine do /negocios/painel)
  contact_name: string | null; contact_pic: string | null
  responsible: string | null; responsible_id: string | null
  items: { name: string }[]
  stageIndex: number; stageCount: number   // posição da etapa no funil do próprio negócio (barra segmentada)
  created_at: string | null; stage_entered_at: string | null
  won_at: string | null; lost_at: string | null; lost_reason: string | null
}
export interface CompanyProposalLite {
  id: string; code: string; dealId: string | null; dealName: string | null
  status: DocumentStatus; value: number; validUntil: string | null
}
// Espelha o subconjunto de DealEventView que a timeline compartilhada (deal-timeline.tsx)
// renderiza — MESMOS ícones/labels/infos do detalhe de negócio. Etapas e autor já vêm
// como NOMES resolvidos; dealName dá o contexto (a timeline da empresa cruza vários negócios).
export interface CockpitEvent {
  id: string; type: string; at: string; by: string | null
  from_stage: string | null; to_stage: string | null
  note: string | null; reason: string | null
  change: { label: string; from: string | null; to: string | null } | null
  dealName: string | null
}
export interface CompanyCockpit {
  company: Company
  responsavel: { id: string; name: string } | null
  kpis: {
    pipelineValue: number; pipelineCount: number
    proposalsOpenValue: number; proposalsOpenCount: number
    lastInteraction: { at: string; channel: string | null } | null
    nextActivity: { at: string | null; title: string } | null
    wonValue: number; wonCount: number
  }
  deals: CockpitDeal[]
  proposals: CompanyProposalLite[]
  contacts: CompanyContactLite[]
  timeline: CockpitEvent[]
}

const OPEN_PROPOSAL: DocumentStatus[] = ["sent", "active"]   // aguardando resposta

export async function getCompanyCockpit(companyId: string): Promise<CompanyCockpit | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  const t = session.user.tenantId

  const { data: companyRow } = await supabaseAdmin.from("tenant_companies")
    .select(COMPANY_COLS).eq("id", companyId).eq("tenant_id", t).maybeSingle()
  if (!companyRow) return { error: "Empresa não encontrada" }
  const company = companyRow as unknown as Company

  // Base: negócios da empresa + contatos vinculados.
  const [{ data: dealRows }, { data: contactRows }] = await Promise.all([
    supabaseAdmin.from("tenant_deals")
      .select("id, name, status, estimated_value, expected_close_date, updated_at, stage_id, pipeline_id, stage_entered_at, created_at, won_at, lost_at, lost_reason, assigned_to, deal_pipeline_stages ( name, color ), chat_contacts ( push_name, custom_name, profile_pic_url )")
      .eq("tenant_id", t).eq("company_id", companyId).order("updated_at", { ascending: false }).limit(200),
    supabaseAdmin.from("chat_contacts")
      .select("id, custom_name, push_name, phone_number, profile_pic_url, lifecycle_stage")
      .eq("tenant_id", t).eq("company_id", companyId).order("custom_name", { ascending: true, nullsFirst: false }).limit(200),
  ])
  const dealRaw = (dealRows ?? []) as Record<string, unknown>[]
  const dealIds = dealRaw.map((d) => d.id as string)
  const pipelineIds    = Array.from(new Set(dealRaw.map((d) => d.pipeline_id).filter(Boolean))) as string[]
  const responsibleIds = Array.from(new Set(dealRaw.map((d) => d.assigned_to).filter(Boolean))) as string[]

  // Enriquecimento da linha rica (produto · barra de etapas · responsável) — em lote.
  const [{ data: itemRows }, { data: pstageRows }, { data: respRows }] = await Promise.all([
    dealIds.length      ? supabaseAdmin.from("tenant_deal_items").select("deal_id, name").eq("tenant_id", t).in("deal_id", dealIds) : Promise.resolve({ data: [] as unknown[] }),
    pipelineIds.length  ? supabaseAdmin.from("deal_pipeline_stages").select("id, pipeline_id, position").eq("tenant_id", t).in("pipeline_id", pipelineIds).order("position") : Promise.resolve({ data: [] as unknown[] }),
    responsibleIds.length ? supabaseAdmin.from("profiles").select("id, full_name").in("id", responsibleIds) : Promise.resolve({ data: [] as unknown[] }),
  ])
  const itemsByDeal = new Map<string, { name: string }[]>()
  for (const i of (itemRows ?? []) as { deal_id: string; name: string }[]) {
    const arr = itemsByDeal.get(i.deal_id) ?? []; arr.push({ name: i.name }); itemsByDeal.set(i.deal_id, arr)
  }
  const stagesByPipe = new Map<string, string[]>()   // funil → etapas ordenadas (id) p/ posição da barra
  for (const s of (pstageRows ?? []) as { id: string; pipeline_id: string }[]) {
    const arr = stagesByPipe.get(s.pipeline_id) ?? []; arr.push(s.id); stagesByPipe.set(s.pipeline_id, arr)
  }
  const respName = new Map<string, string>()
  for (const p of (respRows ?? []) as { id: string; full_name: string | null }[]) respName.set(p.id, p.full_name ?? "—")

  const deals: CockpitDeal[] = dealRaw.map((d) => {
    const stg = d.deal_pipeline_stages as { name: string | null; color: string | null } | null
    const c   = d.chat_contacts as { push_name: string | null; custom_name: string | null; profile_pic_url: string | null } | null
    const pipeStages = (d.pipeline_id ? stagesByPipe.get(d.pipeline_id as string) : null) ?? []
    return {
      id: d.id as string, name: (d.name as string | null) ?? null, status: d.status as string,
      estimated_value: (d.estimated_value as number | null) ?? null,
      stage: stg?.name ?? null, stage_color: stg?.color ?? null,
      expected_close_date: (d.expected_close_date as string | null) ?? null,
      updated_at: (d.updated_at as string | null) ?? null,
      contact_name: c ? (c.custom_name?.trim() || c.push_name?.trim() || null) : null,
      contact_pic: c?.profile_pic_url ?? null,
      responsible: d.assigned_to ? (respName.get(d.assigned_to as string) ?? null) : null,
      responsible_id: (d.assigned_to as string | null) ?? null,
      items: itemsByDeal.get(d.id as string) ?? [],
      stageIndex: d.stage_id ? pipeStages.indexOf(d.stage_id as string) : -1,
      stageCount: pipeStages.length,
      created_at: (d.created_at as string | null) ?? null,
      stage_entered_at: (d.stage_entered_at as string | null) ?? null,
      won_at: (d.won_at as string | null) ?? null,
      lost_at: (d.lost_at as string | null) ?? null,
      lost_reason: (d.lost_reason as string | null) ?? null,
    }
  })
  const dealName  = new Map(deals.map((d) => [d.id, d.name]))
  let pipelineValue = 0, pipelineCount = 0, wonValue = 0, wonCount = 0
  for (const d of deals) {
    const v = Number(d.estimated_value ?? 0)
    if (d.status === "open") { pipelineCount += 1; pipelineValue += v }
    else if (d.status === "won") { wonCount += 1; wonValue += v }
  }
  const contacts: CompanyContactLite[] = ((contactRows ?? []) as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    name: (c.custom_name as string | null)?.trim() || (c.push_name as string | null)?.trim() || "Sem nome",
    phone_number: (c.phone_number as string | null) ?? null,
    profile_pic_url: (c.profile_pic_url as string | null) ?? null,
    lifecycle_stage: (c.lifecycle_stage as string | null) ?? null,
  }))
  const contactIds = contacts.map((c) => c.id)

  // Agregados em paralelo: propostas · última interação · próxima tarefa · eventos · dono.
  const noRows = Promise.resolve({ data: [] as unknown[] })
  const [{ data: propRows }, { data: convRows }, { data: taskRows }, { data: evRows }, { data: ownerRow }] = await Promise.all([
    dealIds.length ? supabaseAdmin.from("commercial_documents")
      .select("id, kind, year, number, status, total_cents, valid_until, deal_id, created_at")
      .eq("tenant_id", t).eq("kind", "quote").in("deal_id", dealIds)
      .order("created_at", { ascending: false }).limit(50) : noRows,
    contactIds.length ? supabaseAdmin.from("chat_conversations")
      .select("last_message_at, channel").eq("tenant_id", t).in("contact_id", contactIds)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1) : noRows,
    dealIds.length ? supabaseAdmin.from("tenant_tasks")
      .select("title, due_at").eq("tenant_id", t).eq("status", "pending").in("deal_id", dealIds)
      .order("due_at", { ascending: true, nullsFirst: false }).limit(1) : noRows,
    dealIds.length ? supabaseAdmin.from("tenant_deal_events")
      .select("id, type, at, by, meta, deal_id, from_stage, to_stage").eq("tenant_id", t).in("deal_id", dealIds)
      .order("at", { ascending: false }).limit(15) : noRows,
    company.owner_id ? supabaseAdmin.from("profiles").select("id, full_name").eq("id", company.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const proposals: CompanyProposalLite[] = ((propRows ?? []) as Record<string, unknown>[]).map((p) => ({
    id: p.id as string,
    code: p.number != null ? docCode("quote", p.number as number, p.year as number) : "Rascunho",
    dealId: (p.deal_id as string | null) ?? null,
    dealName: p.deal_id ? (dealName.get(p.deal_id as string) ?? null) : null,
    status: p.status as DocumentStatus,
    value: Number(p.total_cents ?? 0) / 100,
    validUntil: (p.valid_until as string | null) ?? null,
  }))
  let proposalsOpenValue = 0, proposalsOpenCount = 0
  for (const p of proposals) if (OPEN_PROPOSAL.includes(p.status)) { proposalsOpenCount += 1; proposalsOpenValue += p.value }

  const conv = (convRows ?? [])[0] as { last_message_at: string | null; channel: string | null } | undefined
  const task = (taskRows ?? [])[0] as { title: string; due_at: string | null } | undefined

  // Nomes de autores + etapas dos eventos (batch) → mesma info do detalhe de negócio.
  const evR = (evRows ?? []) as Record<string, unknown>[]
  const byIds    = Array.from(new Set(evR.map((e) => e.by as string | null).filter(Boolean))) as string[]
  const stageIds = Array.from(new Set(evR.flatMap((e) => [e.from_stage, e.to_stage]).filter(Boolean))) as string[]
  const byName = new Map<string, string>(), stageName = new Map<string, string>()
  const [{ data: profs }, { data: stages }] = await Promise.all([
    byIds.length    ? supabaseAdmin.from("profiles").select("id, full_name").in("id", byIds) : Promise.resolve({ data: [] as unknown[] }),
    stageIds.length ? supabaseAdmin.from("deal_pipeline_stages").select("id, name").eq("tenant_id", t).in("id", stageIds) : Promise.resolve({ data: [] as unknown[] }),
  ])
  for (const p of (profs ?? []) as { id: string; full_name: string | null }[]) byName.set(p.id, p.full_name ?? "—")
  for (const s of (stages ?? []) as { id: string; name: string }[]) stageName.set(s.id, s.name)

  const timeline: CockpitEvent[] = evR.map((e) => {
    const meta = (e.meta ?? {}) as { note?: string | null; reason?: string | null; change?: { label: string; from: string | null; to: string | null } | null }
    const did  = (e.deal_id as string | null) ?? null
    const fs   = e.from_stage as string | null, ts = e.to_stage as string | null
    return {
      id: e.id as string, type: e.type as string, at: e.at as string,
      by: e.by ? (byName.get(e.by as string) ?? null) : null,
      from_stage: fs ? (stageName.get(fs) ?? null) : null,
      to_stage:   ts ? (stageName.get(ts) ?? null) : null,
      note: meta.note?.trim() || null, reason: meta.reason?.trim() || null,
      change: meta.change ?? null,
      dealName: did ? (dealName.get(did) ?? null) : null,
    }
  })

  return {
    company,
    responsavel: ownerRow ? { id: (ownerRow as { id: string }).id, name: (ownerRow as { full_name: string | null }).full_name ?? "—" } : null,
    kpis: {
      pipelineValue, pipelineCount, proposalsOpenValue, proposalsOpenCount,
      lastInteraction: conv?.last_message_at ? { at: conv.last_message_at, channel: conv.channel ?? null } : null,
      nextActivity: task ? { at: task.due_at ?? null, title: task.title } : null,
      wonValue, wonCount,
    },
    deals, proposals, contacts, timeline,
  }
}
