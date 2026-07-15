import "server-only"
import { createElement } from "react"
import { createHash } from "node:crypto"
import { renderToBuffer } from "@react-pdf/renderer"
import { supabaseAdmin } from "@/lib/supabase"
import { emitCommercialEvent, toCents } from "@/lib/commercial/entries"
import { lineSubtotal, DEFAULT_TERM_MONTHS } from "@/lib/crm/value"
import { recordDealEvent } from "@/lib/crm/deals"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { QuotePdf, type QuotePdfData } from "@/lib/pdf/quote-pdf"

// ═══════════════════════════════════════════════════════════════════
// Commercial Core — F4: DOCUMENTOS (docs/commercial-core-design.md §7.1).
// Domínio PURO server-only (espelha entries.ts): recebe `tenantId` explícito,
// NÃO é "use server" — quem expõe pra UI são os wrappers gated em
// src/lib/actions/documents.ts.
//
// Regras invioláveis:
//   • Cotação = SNAPSHOT imutável (itens+preços+condições+emissor+cliente) +
//     sha256 do JSON canônico. Mudou o negócio → NOVA versão, nunca UPDATE.
//   • Dinheiro do snapshot em CENTAVOS (tenant_deal_items.unit_price é reais).
//   • TODA query filtra tenant_id (supabaseAdmin bypassa RLS — anti-IDOR).
//   • 'signed' existe no union de status (previsto F5) mas NENHUMA transição
//     leva até ele no v1.
// ═══════════════════════════════════════════════════════════════════

const BUCKET = "chat-attachments"

// ── Tipos de domínio ────────────────────────────────────────────────
export type DocumentKind = "quote" | "order" | "contract"
export type DocumentStatus = "draft" | "sent" | "accepted" | "declined" | "signed" | "void"
export type Billing = "one_time" | "monthly" | "yearly"

export interface QuoteAddress {
  zip_code: string | null; street: string | null; number: string | null
  complement: string | null; district: string | null; city: string | null; state: string | null
}
export interface QuoteIssuer {
  name:       string          // nome fantasia / nome da unidade
  legal_name: string | null   // razão social
  tax_id:     string | null   // CNPJ
  phone:      string | null
  email:      string | null
  address:    QuoteAddress | null
  logo_path:  string | null   // storage path do logo da unidade (não é URL)
}
export interface QuoteClient { name: string; phone: string | null }
export interface QuoteDealRef { id: string; name: string | null; seller: string | null }
export interface QuoteItem {
  name:             string
  type:             "product" | "service"
  qty:              number
  unit:             string
  unit_price_cents: number
  billing:          Billing
  term_months:      number | null
  discount:         number      // centavos (desconto da linha, sem fator de prazo)
  total_cents:      number      // contribuição da linha ao valor do negócio (billing/prazo aplicados)
}
export interface QuoteConditions {
  payment_terms: string | null
  notes:         string | null
  valid_until:   string | null  // yyyy-mm-dd
}
export interface QuoteTotals { subtotal_cents: number; discount_cents: number; total_cents: number }

export interface QuoteSnapshot {
  issuer:     QuoteIssuer
  client:     QuoteClient
  deal:       QuoteDealRef
  items:      QuoteItem[]
  conditions: QuoteConditions
  totals:     QuoteTotals
}

/** Condições editáveis no modal de gerar cotação. */
export interface DocumentConditionsInput {
  paymentTerms?: string | null
  notes?:        string | null
  validUntil?:   string | null   // yyyy-mm-dd
}

/** Linha da tabela commercial_documents pro client (código+valor derivados do snapshot). */
export interface DocumentRow {
  id:           string
  kind:         DocumentKind
  year:         number
  number:       number
  code:         string          // "COT-0001/2026"
  status:       DocumentStatus
  totalCents:   number
  validUntil:   string | null
  supersededBy: string | null
  createdAt:    string
  sentAt:       string | null
  acceptedAt:   string | null
  declinedAt:   string | null
  voidedAt:     string | null
}

export interface DocumentSettings {
  paymentTerms: string | null
  validityDays: number
  defaultNotes: string | null
}

// ── Numeração / código ──────────────────────────────────────────────
const KIND_PREFIX: Record<DocumentKind, string> = { quote: "COT", order: "PED", contract: "CTR" }
export function docCode(kind: DocumentKind, number: number, year: number): string {
  return `${KIND_PREFIX[kind]}-${String(number).padStart(4, "0")}/${year}`
}
/** Ano corrente em America/Sao_Paulo (base da sequência tenant+kind+ano). */
function currentYear(): number {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()))
}
async function nextNumber(tenantId: string, kind: DocumentKind, year: number): Promise<number> {
  const { data } = await supabaseAdmin.from("commercial_documents")
    .select("number").eq("tenant_id", tenantId).eq("kind", kind).eq("year", year)
    .order("number", { ascending: false }).limit(1).maybeSingle()
  return ((data as { number: number } | null)?.number ?? 0) + 1
}

// ── Hash canônico ───────────────────────────────────────────────────
/** Ordena chaves recursivamente pra o JSON.stringify ser estável (hash reproduzível). */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>
    return Object.keys(src).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = canonical(src[k]); return acc }, {})
  }
  return v
}
export function snapshotHash(snapshot: QuoteSnapshot): string {
  return createHash("sha256").update(JSON.stringify(canonical(snapshot))).digest("hex")
}

// ── Emissor (unidade → única ativa → tenant) ────────────────────────
const UNIT_COLS = "id, name, legal_name, tax_id, phone, email, zip_code, street, number, complement, district, city, state, logo_path"
interface UnitRow {
  id: string; name: string; legal_name: string | null; tax_id: string | null; phone: string | null; email: string | null
  zip_code: string | null; street: string | null; number: string | null; complement: string | null
  district: string | null; city: string | null; state: string | null; logo_path: string | null
}
function unitToIssuer(u: UnitRow): QuoteIssuer {
  return {
    name: u.name, legal_name: u.legal_name, tax_id: u.tax_id, phone: u.phone, email: u.email,
    address: { zip_code: u.zip_code, street: u.street, number: u.number, complement: u.complement, district: u.district, city: u.city, state: u.state },
    logo_path: u.logo_path,
  }
}
/** Emissor: unidade do deal → senão a ÚNICA unidade ativa do tenant → senão nome do tenant. */
async function resolveIssuer(tenantId: string, dealUnitId: string | null): Promise<{ issuer: QuoteIssuer; unitId: string | null }> {
  let unit: UnitRow | null = null
  if (dealUnitId) {
    const { data } = await supabaseAdmin.from("tenant_units").select(UNIT_COLS).eq("id", dealUnitId).eq("tenant_id", tenantId).maybeSingle()
    unit = (data as UnitRow | null) ?? null
  }
  if (!unit) {
    const { data } = await supabaseAdmin.from("tenant_units").select(UNIT_COLS).eq("tenant_id", tenantId).eq("active", true).limit(2)
    const rows = (data ?? []) as UnitRow[]
    if (rows.length === 1) unit = rows[0]   // ambiguidade (2+) → cai pro tenant
  }
  if (unit) return { issuer: unitToIssuer(unit), unitId: unit.id }

  const { data: t } = await supabaseAdmin.from("tenants").select("name").eq("id", tenantId).maybeSingle()
  return {
    issuer: { name: (t as { name: string } | null)?.name ?? "Minha empresa", legal_name: null, tax_id: null, phone: null, email: null, address: null, logo_path: null },
    unitId: null,
  }
}

// ── Snapshot ────────────────────────────────────────────────────────
type ItemRow = { name: string; type: "product" | "service"; billing: Billing; unit_price: number; quantity: number; unit: string | null; discount: number; term_months: number | null }

/** Fator de prazo do valor (espelha src/lib/crm/value.ts). */
function termFactor(billing: Billing, termMonths: number | null): number {
  if (billing === "one_time") return 1
  const term = termMonths ?? DEFAULT_TERM_MONTHS
  return billing === "monthly" ? term : term / 12
}

/**
 * Constrói o snapshot IMUTÁVEL da cotação a partir do estado atual do negócio.
 * Usado tanto pra gerar (createQuote) quanto pra prévia no modal.
 */
export async function buildQuoteSnapshot(
  tenantId: string, dealId: string, cond: DocumentConditionsInput,
): Promise<{ snapshot: QuoteSnapshot; contactId: string | null; unitId: string | null } | { error: string }> {
  const { data: d } = await supabaseAdmin.from("tenant_deals").select(`
    id, name, assigned_to, contact_id, unit_id,
    chat_contacts ( push_name, custom_name, phone_number )
  `).eq("id", dealId).eq("tenant_id", tenantId).maybeSingle()
  if (!d) return { error: "Negócio não encontrado" }
  const deal = d as Record<string, unknown>

  const c = deal.chat_contacts as { push_name: string | null; custom_name: string | null; phone_number: string | null } | null
  const clientName = c?.custom_name?.trim() || c?.push_name?.trim() || "Cliente"
  const clientPhone = c?.phone_number ? formatPhoneDisplay(c.phone_number) : null

  // Vendedor = dono do negócio (assigned_to → profiles.full_name).
  let seller: string | null = null
  const assignedTo = (deal.assigned_to as string | null) ?? null
  if (assignedTo) {
    const { data: prof } = await supabaseAdmin.from("profiles").select("full_name").eq("id", assignedTo).maybeSingle()
    seller = (prof as { full_name: string | null } | null)?.full_name ?? null
  }

  const { data: rows } = await supabaseAdmin.from("tenant_deal_items")
    .select("name, type, billing, unit_price, quantity, unit, discount, term_months")
    .eq("tenant_id", tenantId).eq("deal_id", dealId)
    .order("position", { ascending: true }).order("created_at", { ascending: true })
  const itemRows = (rows ?? []) as ItemRow[]
  if (itemRows.length === 0) return { error: "Adicione itens ao negócio antes de gerar a cotação." }

  let subtotalCents = 0, discountCents = 0, totalCents = 0
  const items: QuoteItem[] = itemRows.map((r) => {
    const unit_price = Number(r.unit_price ?? 0)
    const quantity   = Number(r.quantity ?? 1)
    const discount   = Number(r.discount ?? 0)
    const billing    = r.billing
    const factor     = termFactor(billing, r.term_months)
    const gross      = unit_price * quantity
    const net        = lineSubtotal({ unit_price, quantity, discount, billing, term_months: r.term_months })
    // Arredonda em cents com o fator aplicado; a soma fecha exata (subtotal − desc = total).
    const grossLineC = Math.round(gross * factor * 100)
    const netLineC   = Math.round(net * factor * 100)
    subtotalCents += grossLineC
    totalCents    += netLineC
    discountCents += grossLineC - netLineC
    return {
      name: r.name, type: r.type, qty: quantity, unit: r.unit ?? "un",
      unit_price_cents: toCents(unit_price), billing, term_months: r.term_months ?? null,
      discount: toCents(discount), total_cents: netLineC,
    }
  })

  const { issuer, unitId } = await resolveIssuer(tenantId, (deal.unit_id as string | null) ?? null)

  const snapshot: QuoteSnapshot = {
    issuer,
    client: { name: clientName, phone: clientPhone },
    deal:   { id: dealId, name: (deal.name as string | null) ?? null, seller },
    items,
    conditions: {
      payment_terms: cond.paymentTerms?.trim() || null,
      notes:         cond.notes?.trim() || null,
      valid_until:   cond.validUntil || null,
    },
    totals: { subtotal_cents: subtotalCents, discount_cents: discountCents, total_cents: totalCents },
  }
  return { snapshot, contactId: (deal.contact_id as string | null) ?? null, unitId }
}

// ── Render PDF ──────────────────────────────────────────────────────
async function logoToDataUri(path: string): Promise<string | null> {
  const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(path)
  if (error || !blob) return null
  const buf = Buffer.from(await blob.arrayBuffer())
  return `data:${blob.type || "image/png"};base64,${buf.toString("base64")}`
}

async function snapshotToPdfData(snapshot: QuoteSnapshot, code: string, issuedAt: string, contentHash: string): Promise<QuotePdfData> {
  const logoDataUri = snapshot.issuer.logo_path ? await logoToDataUri(snapshot.issuer.logo_path) : null
  return {
    code, issuedAt, validUntil: snapshot.conditions.valid_until,
    issuer: {
      name: snapshot.issuer.name, legal_name: snapshot.issuer.legal_name, tax_id: snapshot.issuer.tax_id,
      phone: snapshot.issuer.phone, email: snapshot.issuer.email, address: snapshot.issuer.address,
    },
    logoDataUri,
    client: snapshot.client,
    deal: { name: snapshot.deal.name, seller: snapshot.deal.seller },
    items: snapshot.items.map((i) => ({
      name: i.name, type: i.type, qty: i.qty, unit: i.unit,
      unit_price_cents: i.unit_price_cents, billing: i.billing, term_months: i.term_months, total_cents: i.total_cents,
    })),
    totals: snapshot.totals,
    conditions: { payment_terms: snapshot.conditions.payment_terms, notes: snapshot.conditions.notes },
    contentHash,
  }
}

async function renderQuoteBuffer(snapshot: QuoteSnapshot, code: string, issuedAt: string, contentHash: string): Promise<Buffer> {
  const data = await snapshotToPdfData(snapshot, code, issuedAt, contentHash)
  const buf = await renderToBuffer(createElement(QuotePdf, { data }) as Parameters<typeof renderToBuffer>[0])
  return buf as Buffer
}

// ── Linha do client ─────────────────────────────────────────────────
const DOC_COLS = "id, kind, year, number, status, snapshot, valid_until, pdf_path, superseded_by, created_at, sent_at, accepted_at, declined_at, voided_at"
interface RawDoc {
  id: string; kind: DocumentKind; year: number; number: number; status: DocumentStatus
  snapshot: QuoteSnapshot; valid_until: string | null; pdf_path: string | null; superseded_by: string | null
  created_at: string; sent_at: string | null; accepted_at: string | null; declined_at: string | null; voided_at: string | null
}
function mapDoc(r: RawDoc): DocumentRow {
  return {
    id: r.id, kind: r.kind, year: r.year, number: r.number, code: docCode(r.kind, r.number, r.year),
    status: r.status, totalCents: Number(r.snapshot?.totals?.total_cents ?? 0),
    // pdf_path NÃO trafega pro client (exposição mínima — só a rota /api/documents lê do banco).
    validUntil: r.valid_until, supersededBy: r.superseded_by,
    createdAt: r.created_at, sentAt: r.sent_at, acceptedAt: r.accepted_at, declinedAt: r.declined_at, voidedAt: r.voided_at,
  }
}

// ── Geração ─────────────────────────────────────────────────────────
export interface CreateQuoteInput {
  dealId:       string
  validUntil?:  string | null
  paymentTerms?: string | null
  notes?:       string | null
  saveAsDefault?: boolean
}

/**
 * Gera uma cotação: numera (retry em colisão), congela o snapshot+hash, renderiza
 * o PDF UMA vez no storage, emite doc_created na espinha e registra na timeline
 * do negócio. Retorna o id + código ou { error }.
 */
export async function createQuote(
  tenantId: string, userId: string, input: CreateQuoteInput,
): Promise<{ id: string; code: string } | { error: string }> {
  const cond: DocumentConditionsInput = { paymentTerms: input.paymentTerms ?? null, notes: input.notes ?? null, validUntil: input.validUntil ?? null }
  const built = await buildQuoteSnapshot(tenantId, input.dealId, cond)
  if ("error" in built) return built
  const { snapshot, contactId, unitId } = built

  const year = currentYear()
  const contentHash = snapshotHash(snapshot)

  // Numeração com retry: a unique (tenant,kind,year,number) segura corridas.
  let docId: string | null = null
  let code = ""
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextNumber(tenantId, "quote", year)
    code = docCode("quote", number, year)
    const { data, error } = await supabaseAdmin.from("commercial_documents").insert({
      tenant_id: tenantId, kind: "quote", year, number,
      deal_id: input.dealId, contact_id: contactId, unit_id: unitId,
      snapshot, content_hash: contentHash,
      status: "draft", valid_until: snapshot.conditions.valid_until, created_by: userId,
    }).select("id").single()
    if (!error && data) { docId = (data as { id: string }).id; break }
    if (error?.code === "23505") continue   // número tomado → renumera
    return { error: error?.message ?? "Falha ao gerar cotação" }
  }
  if (!docId) return { error: "Não foi possível numerar a cotação. Tente novamente." }

  // PDF (prova do enviado) — gerado UMA vez. Falha → remove o rascunho órfão.
  try {
    const buffer = await renderQuoteBuffer(snapshot, code, new Date().toISOString(), contentHash)
    const pdfPath = `documents/${tenantId}/${docId}.pdf`
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(pdfPath, buffer, { contentType: "application/pdf", upsert: true })
    if (upErr) throw new Error(upErr.message)
    await supabaseAdmin.from("commercial_documents").update({ pdf_path: pdfPath, updated_at: new Date().toISOString() }).eq("id", docId).eq("tenant_id", tenantId)
  } catch (e) {
    await supabaseAdmin.from("commercial_documents").delete().eq("id", docId).eq("tenant_id", tenantId)
    console.error("[documents.createQuote] pdf:", (e as Error).message)
    return { error: "Falha ao gerar o PDF da cotação" }
  }

  // Espinha + timeline do negócio (type genérico 'note' — tenant_deal_events.type
  // é texto livre, sem enum; postCard=false = só auditoria, não polui o chat).
  await emitCommercialEvent(tenantId, "doc_created", { subject: { deal_id: input.dealId, document_id: docId }, actorId: userId })
  await recordDealEvent({ tenantId, dealId: input.dealId, type: "note", by: userId, note: `Cotação ${code} gerada`, postCard: false })

  if (input.saveAsDefault) {
    const validityDays = snapshot.conditions.valid_until
      ? Math.max(1, Math.round((new Date(snapshot.conditions.valid_until + "T12:00:00").getTime() - Date.now()) / 86_400_000))
      : undefined
    await supabaseAdmin.from("tenant_document_settings").upsert({
      tenant_id: tenantId,
      payment_terms: cond.paymentTerms?.trim() || null,
      default_notes: cond.notes?.trim() || null,
      ...(validityDays != null ? { validity_days: validityDays } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" })
  }

  return { id: docId, code }
}

// ── Leituras ────────────────────────────────────────────────────────
export async function getDealDocuments(tenantId: string, dealId: string): Promise<DocumentRow[]> {
  const { data } = await supabaseAdmin.from("commercial_documents")
    .select(DOC_COLS).eq("tenant_id", tenantId).eq("deal_id", dealId)
    .order("created_at", { ascending: false })
  return ((data ?? []) as RawDoc[]).map(mapDoc)
}

export async function getDocumentSettings(tenantId: string): Promise<DocumentSettings> {
  const { data } = await supabaseAdmin.from("tenant_document_settings")
    .select("payment_terms, validity_days, default_notes").eq("tenant_id", tenantId).maybeSingle()
  const r = data as { payment_terms: string | null; validity_days: number | null; default_notes: string | null } | null
  return { paymentTerms: r?.payment_terms ?? null, validityDays: r?.validity_days ?? 7, defaultNotes: r?.default_notes ?? null }
}

// ── Transições (cada uma valida o status de origem — fail-closed) ────
async function loadDocStatus(tenantId: string, docId: string): Promise<{ status: DocumentStatus; deal_id: string | null } | null> {
  const { data } = await supabaseAdmin.from("commercial_documents")
    .select("status, deal_id").eq("id", docId).eq("tenant_id", tenantId).maybeSingle()
  return (data as { status: DocumentStatus; deal_id: string | null } | null) ?? null
}

export async function markDocumentSent(tenantId: string, userId: string, docId: string): Promise<{ ok: true } | { error: string }> {
  const doc = await loadDocStatus(tenantId, docId)
  if (!doc) return { error: "Documento não encontrado" }
  if (doc.status !== "draft" && doc.status !== "sent") return { error: "Só uma cotação em rascunho pode ser enviada." }
  await supabaseAdmin.from("commercial_documents")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", docId).eq("tenant_id", tenantId)
  await emitCommercialEvent(tenantId, "doc_sent", { subject: { deal_id: doc.deal_id, document_id: docId }, actorId: userId })
  return { ok: true }
}

export async function markDocumentAccepted(tenantId: string, userId: string, docId: string): Promise<{ ok: true } | { error: string }> {
  const doc = await loadDocStatus(tenantId, docId)
  if (!doc) return { error: "Documento não encontrado" }
  if (doc.status !== "draft" && doc.status !== "sent") return { error: "Esta cotação não pode ser marcada como aceita." }
  await supabaseAdmin.from("commercial_documents")
    .update({ status: "accepted", accepted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", docId).eq("tenant_id", tenantId)
  await emitCommercialEvent(tenantId, "doc_accepted", { subject: { deal_id: doc.deal_id, document_id: docId }, actorId: userId })
  return { ok: true }
}

export async function markDocumentDeclined(tenantId: string, userId: string, docId: string): Promise<{ ok: true } | { error: string }> {
  const doc = await loadDocStatus(tenantId, docId)
  if (!doc) return { error: "Documento não encontrado" }
  if (doc.status !== "draft" && doc.status !== "sent") return { error: "Esta cotação não pode ser marcada como recusada." }
  await supabaseAdmin.from("commercial_documents")
    .update({ status: "declined", declined_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", docId).eq("tenant_id", tenantId)
  await emitCommercialEvent(tenantId, "doc_declined", { subject: { deal_id: doc.deal_id, document_id: docId }, actorId: userId })
  return { ok: true }
}

export async function voidDocument(tenantId: string, _userId: string, docId: string): Promise<{ ok: true } | { error: string }> {
  const doc = await loadDocStatus(tenantId, docId)
  if (!doc) return { error: "Documento não encontrado" }
  if (doc.status === "void") return { error: "Cotação já anulada." }
  await supabaseAdmin.from("commercial_documents")
    .update({ status: "void", voided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", docId).eq("tenant_id", tenantId)
  return { ok: true }
}

/**
 * Nova versão: gera uma cotação NOVA do mesmo negócio e anula a anterior
 * (status void + superseded_by → nova). Não versiona uma já anulada.
 */
export async function createNewVersion(
  tenantId: string, userId: string, docId: string, cond: DocumentConditionsInput,
): Promise<{ id: string; code: string } | { error: string }> {
  const doc = await loadDocStatus(tenantId, docId)
  if (!doc) return { error: "Documento não encontrado" }
  if (doc.status === "void") return { error: "Não é possível versionar uma cotação anulada." }
  if (!doc.deal_id) return { error: "Cotação sem negócio de origem." }

  // CLAIM atômico ANTES de gerar (auditoria F4): o `.neq status void` garante que
  // só UMA chamada concorrente vence — a perdedora recebe zero linhas e sai.
  // Sem isso, 2 abas/duplo-clique gerariam 2 versões "ativas" do mesmo doc.
  const now = new Date().toISOString()
  const { data: claimed } = await supabaseAdmin.from("commercial_documents")
    .update({ status: "void", voided_at: now, updated_at: now })
    .eq("id", docId).eq("tenant_id", tenantId).neq("status", "void")
    .select("id")
  if (!claimed?.length) return { error: "Esta cotação já foi versionada ou anulada." }

  const created = await createQuote(tenantId, userId, {
    dealId: doc.deal_id, validUntil: cond.validUntil ?? null, paymentTerms: cond.paymentTerms ?? null, notes: cond.notes ?? null,
  })
  if ("error" in created) {
    // Rollback best-effort: devolve o status lido antes do claim (janela minúscula).
    await supabaseAdmin.from("commercial_documents")
      .update({ status: doc.status, voided_at: null, updated_at: new Date().toISOString() })
      .eq("id", docId).eq("tenant_id", tenantId)
    return created
  }

  await supabaseAdmin.from("commercial_documents")
    .update({ superseded_by: created.id, updated_at: new Date().toISOString() })
    .eq("id", docId).eq("tenant_id", tenantId)
  return created
}
