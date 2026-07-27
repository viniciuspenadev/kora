"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { getViewerScope, canManageContacts } from "@/lib/visibility"
import { rateLimit } from "@/lib/rate-limit"

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
}

export interface Company extends CompanyInput {
  id: string
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
  return out
}

const COMPANY_COLS = "id, name, legal_name, doc_id, email, phone, site, address_cep, address_street, address_number, address_complement, address_district, address_city, address_state, address_country, price_table_id, owner_id, notes, ie, ie_indicador, im, tax_regime, municipio_ibge, custom_fields, created_at, updated_at"

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

export interface CompanyLite { id: string; name: string; legal_name: string | null; doc_id: string | null; city: string | null }

/** Busca empresas por nome/CNPJ (escopo de tenant, rate-limited). Pro picker "Empresa". */
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
    .select("id, name, legal_name, doc_id, address_city").eq("tenant_id", session.user.tenantId)
  sel = digits.length >= 3
    ? sel.or(`name.ilike.${like},legal_name.ilike.${like},doc_id.ilike.%${digits}%`)
    : sel.or(`name.ilike.${like},legal_name.ilike.${like}`)
  const { data } = await sel.order("name", { ascending: true }).limit(20)
  return ((data ?? []) as { id: string; name: string; legal_name: string | null; doc_id: string | null; address_city: string | null }[])
    .map((c) => ({ id: c.id, name: c.name, legal_name: c.legal_name, doc_id: c.doc_id, city: c.address_city }))
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
