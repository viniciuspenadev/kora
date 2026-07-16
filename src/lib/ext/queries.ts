import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import {
  type ViewerScope,
  applyDealScope,
  canOpenDeals,
  canOpenContacts,
  seesAllContacts,
  seesAllDeals,
  reachableContactIds,
} from "@/lib/visibility"
import { normalizeWhatsAppPhone, formatPhoneDisplay } from "@/lib/phone-utils"
import { resolveOrCreateContact } from "@/lib/contacts/identity"
import { createDeal, recordDealEvent } from "@/lib/crm/deals"
import { withAliases } from "@/lib/variables/registry"
import {
  createQuote,
  getDealDocuments,
  getDocumentSettings,
  markDocumentSent,
  docCode,
  type DocumentKind,
  type DocumentStatus,
} from "@/lib/commercial/documents"
import { lineSubtotal, computeDealValue, DEFAULT_TERM_MONTHS, type DealItemLike } from "@/lib/crm/value"
import { hasModule } from "@/lib/modules"
import { availabilitySlots, bookAppointment } from "@/lib/agenda/booking"
import { appointmentLevel, viewerShareMap, LEVEL_RANK, type ApptVisibility, type ShareLevel } from "@/lib/agenda/access"
import { logAudit } from "@/lib/audit"

// ═══════════════════════════════════════════════════════════════
// Kora Companion — queries de leitura (F0)
// ═══════════════════════════════════════════════════════════════
// Tudo aqui respeita o ViewerScope: contato fora do alcance = "não encontrado"
// (fail-closed sem vazar existência); deals filtrados por applyDealScope.

export interface ExtContact {
  id:    string
  name:  string | null
  phone: string | null
}

export interface ExtDeal {
  id:           string
  name:         string | null
  value:        number | null
  stageId:      string | null
  stageName:    string | null
  pipelineId:   string | null
  pipelineName: string | null
  updatedAt:    string | null
}

export interface ExtPipeline {
  id:     string
  name:   string
  stages: { id: string; name: string; terminal: boolean }[]
}

/** Acha o contato pelo telefone do chat aberto (jid → phone → identities). Read-only. */
export async function findContactByPhone(
  tenantId: string,
  rawPhone: string,
): Promise<{ id: string; name: string | null; phone: string | null } | null> {
  const norm = normalizeWhatsAppPhone(rawPhone)
  if (!norm) return null

  const COLS = "id, custom_name, push_name, phone_number"
  let row: Record<string, unknown> | null = null

  const { data: byJid } = await supabaseAdmin
    .from("chat_contacts").select(COLS)
    .eq("tenant_id", tenantId).eq("whatsapp_id", norm.jid).maybeSingle()
  row = byJid ?? null

  if (!row) {
    const { data: byPhone } = await supabaseAdmin
      .from("chat_contacts").select(COLS)
      .eq("tenant_id", tenantId).eq("phone_number", norm.phone).maybeSingle()
    row = byPhone ?? null
  }

  // Identidade secundária (contato mesclado) — mesma rede de segurança do resolver.
  if (!row) {
    const { data: idRow } = await supabaseAdmin
      .from("contact_identities").select("contact_id")
      .eq("tenant_id", tenantId).eq("channel", "whatsapp").eq("external_id", norm.jid)
      .maybeSingle()
    if (idRow) {
      const { data } = await supabaseAdmin
        .from("chat_contacts").select(COLS)
        .eq("tenant_id", tenantId).eq("id", idRow.contact_id as string).maybeSingle()
      row = data ?? null
    }
  }

  if (!row) return null
  const name =
    ((row.custom_name as string | null)?.trim() || (row.push_name as string | null)?.trim()) ?? null
  return { id: row.id as string, name, phone: (row.phone_number as string | null) ?? null }
}

/** O viewer alcança este contato? (base toda OU relação: conversa/deal/carteira). */
export async function canReachContact(scope: ViewerScope, contactId: string): Promise<boolean> {
  if (seesAllContacts(scope)) return true
  const ids = await reachableContactIds(scope)
  return ids.includes(contactId)
}

/** Gate de Negócios da extensão = capability do papel E módulo crm do tenant
 *  (alinha com requireModule("crm") das actions do app — fail-closed). */
async function canUseDeals(scope: ViewerScope): Promise<boolean> {
  return canOpenDeals(scope) && (await hasModule(scope.tenantId, "crm"))
}

/** Negócios ABERTOS do contato, no alcance do viewer (Ver = só os dele). */
export async function openDealsForContact(
  scope: ViewerScope,
  contactId: string,
): Promise<ExtDeal[]> {
  if (!(await canUseDeals(scope))) return []
  const q = applyDealScope(
    supabaseAdmin
      .from("tenant_deals")
      .select("id, name, estimated_value, updated_at, stage_id, pipeline_id, deal_pipelines ( name ), deal_pipeline_stages ( name )")
      .eq("tenant_id", scope.tenantId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(10),
    scope,
  )
  const { data } = await q
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id:           r.id as string,
    name:         (r.name as string | null) ?? null,
    value:        (r.estimated_value as number | null) ?? null,
    stageId:      (r.stage_id as string | null) ?? null,
    stageName:    (r.deal_pipeline_stages as { name: string | null } | null)?.name ?? null,
    pipelineId:   (r.pipeline_id as string | null) ?? null,
    pipelineName: (r.deal_pipelines as { name: string | null } | null)?.name ?? null,
    updatedAt:    (r.updated_at as string | null) ?? null,
  }))
}

// ── F1: escrita (mesmas primitivas do app — evento na timeline sempre) ────────

/** Funis ativos com etapas (terminal = ganho/perdido; a extensão não move pra elas). */
export async function listPipelinesExt(scope: ViewerScope): Promise<ExtPipeline[]> {
  if (!(await canUseDeals(scope))) return []
  const { data } = await supabaseAdmin
    .from("deal_pipelines")
    .select("id, name, deal_pipeline_stages ( id, name, position, is_won, is_lost )")
    .eq("tenant_id", scope.tenantId)
    .eq("active", true)
    .order("position")
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    id:   p.id as string,
    name: (p.name as string) ?? "Funil",
    stages: (((p.deal_pipeline_stages as Record<string, unknown>[]) ?? [])
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((s) => ({
        id: s.id as string,
        name: (s.name as string) ?? "—",
        terminal: s.is_won === true || s.is_lost === true,
      }))),
  }))
}

// Foto do WhatsApp (F1): a extensão manda a URL do CDN que está NA TELA do chat;
// o servidor valida o host, baixa os bytes e grava no MESMO pipeline do webhook
// (storage + proxy estável /api/avatar). URL de CDN expira — por isso bytes.
const AVATAR_BUCKET = "chat-attachments"
function isWhatsAppCdn(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return u.protocol === "https:" && /(^|\.)(whatsapp\.net|fbcdn\.net)$/.test(u.hostname)
  } catch { return false }
}

async function saveAvatarFromCdn(
  tenantId: string,
  contactId: string,
  cdnUrl: string,
  onlyIfEmpty: boolean,
): Promise<void> {
  try {
    if (!isWhatsAppCdn(cdnUrl)) return
    if (onlyIfEmpty) {
      const { data: cur } = await supabaseAdmin.from("chat_contacts")
        .select("profile_pic_url").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
      if (cur?.profile_pic_url) return   // já tem foto (do webhook) — não sobrescreve
    }
    const res = await fetch(cdnUrl)
    if (!res.ok) return
    const blob = await res.blob()
    if (blob.size > 2_000_000) return    // avatar não passa de ~2MB
    const mime = blob.type || "image/jpeg"
    const ext = (mime.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "")
    const path = `avatars/${tenantId}/${contactId}.${ext}`
    const buffer = Buffer.from(await blob.arrayBuffer())
    const { error: upErr } = await supabaseAdmin.storage.from(AVATAR_BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: true })
    if (upErr) return
    const now = new Date().toISOString()
    const { data: c } = await supabaseAdmin.from("chat_contacts")
      .select("metadata").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
    const meta = { ...((c?.metadata as Record<string, unknown> | null) ?? {}), avatar_path: path }
    await supabaseAdmin.from("chat_contacts").update({
      profile_pic_url:        `/api/avatar/${contactId}`,
      profile_pic_fetched_at: now,
      metadata:               meta,
      updated_at:             now,
    }).eq("id", contactId).eq("tenant_id", tenantId)
  } catch (e) {
    console.error("[ext.avatar]", (e as Error).message)
  }
}

const ALREADY_IN_BASE =
  "Este número já está na base da empresa. Peça ao gestor pra atribuir o contato a você."

/**
 * Cria contato a partir do chat aberto (F1). Passa pelo resolver canônico
 * (dedup/merge). Agente sem "base inteira" vira DONO (owner_id) SÓ do contato
 * que ele CRIOU de verdade — cadastro NUNCA é porta pra assumir contato
 * pré-existente fora do alcance (anti carteira-grab, auditoria 2026-07-16):
 * nesse caso nada é escrito (nem nome, nem foto, nem carteira) e o erro
 * `already_in_base` manda a sidebar pro estado-guarda. Foto (opt-in) entra
 * fire-and-forget pelo pipeline do webhook.
 */
export async function createContactExt(
  scope: ViewerScope,
  input: { name: string; phone: string; photoUrl?: string | null },
): Promise<{ id: string } | { error: string; code?: string }> {
  if (!(scope.isAdmin || canOpenContacts(scope) || canOpenDeals(scope)))
    return { error: "Seu papel não pode criar contatos." }
  const norm = normalizeWhatsAppPhone(input.phone)
  if (!norm) return { error: "Telefone inválido." }
  const name = input.name.trim().slice(0, 120)
  if (!name) return { error: "Informe o nome." }

  // Barreira ANTES do resolver (que faz backfill no dedup): pré-existente fora
  // do alcance = nega sem escrever nada + registro de auditoria pro gestor.
  const existing = await findContactByPhone(scope.tenantId, input.phone)
  if (existing && !(await canReachContact(scope, existing.id))) {
    await logAudit({
      tenantId: scope.tenantId, actorId: scope.userId,
      action: "companion.contact_claim_blocked", targetType: "contact", targetId: existing.id,
      metadata: { via: "extension" },
    })
    return { error: ALREADY_IN_BASE, code: "already_in_base" }
  }

  const { id, created } = await resolveOrCreateContact(
    scope.tenantId,
    { jid: norm.jid, phone: norm.phone },
    { customName: name, source: "manual", touch: true },
  )
  // Corrida (apareceu entre a checagem e o resolver): dedupou pra algo fora do
  // alcance → mesmo tratamento, sem claim.
  if (!created && !(await canReachContact(scope, id))) {
    return { error: ALREADY_IN_BASE, code: "already_in_base" }
  }
  if (created && !seesAllContacts(scope)) {
    await supabaseAdmin
      .from("chat_contacts")
      .update({ owner_id: scope.userId })
      .eq("id", id).eq("tenant_id", scope.tenantId).is("owner_id", null)
  }
  if (input.photoUrl) {
    // contato pré-existente (alcançável): só preenche se ainda não tem foto
    saveAvatarFromCdn(scope.tenantId, id, input.photoUrl, !created).catch(() => {})
  }
  return { id }
}

/** Cria negócio (F1) — delega pro core do CRM (trava 1-aberto, carteira, evento). */
export async function createDealExt(
  scope: ViewerScope,
  input: { contactId: string; name?: string | null; pipelineId: string; stageId: string; value?: number | null },
): Promise<{ id: string } | { error: string }> {
  if (!(await canUseDeals(scope))) return { error: "Sem acesso a Negócios nesta conta." }
  const pipes = await listPipelinesExt(scope)
  const pipe = pipes.find((p) => p.id === input.pipelineId)
  const stage = pipe?.stages.find((s) => s.id === input.stageId)
  if (!pipe || !stage) return { error: "Funil/etapa inválidos." }
  if (stage.terminal) return { error: "Abrir negócio direto em ganho/perdido é no app." }

  return createDeal({
    tenantId:       scope.tenantId,
    contactId:      input.contactId,
    pipelineId:     input.pipelineId,
    stageId:        input.stageId,
    name:           input.name?.trim().slice(0, 140) || null,
    estimatedValue: typeof input.value === "number" && input.value >= 0 ? input.value : null,
    by:             scope.userId,
  })
}

/** Deal do alcance do viewer (ou null). Base dos writes por-negócio. */
async function dealInScope(scope: ViewerScope, dealId: string) {
  const q = applyDealScope(
    supabaseAdmin
      .from("tenant_deals")
      .select("id, contact_id, pipeline_id, stage_id, status")
      .eq("tenant_id", scope.tenantId)
      .eq("id", dealId),
    scope,
  )
  const { data } = await q.maybeSingle()
  return (data as { id: string; contact_id: string | null; pipeline_id: string | null; stage_id: string | null; status: string } | null) ?? null
}

/** Conversa ligada ao negócio (pro cartão interno na timeline do chat). */
async function conversationOfDeal(tenantId: string, dealId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("chat_conversations").select("id")
    .eq("tenant_id", tenantId).eq("active_deal_id", dealId).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Move etapa (F1) — só etapas NÃO-terminais do MESMO funil. Ganhar/perder = app. */
export async function moveDealStageExt(
  scope: ViewerScope,
  dealId: string,
  stageId: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await canUseDeals(scope))) return { error: "Sem acesso a Negócios nesta conta." }
  const deal = await dealInScope(scope, dealId)
  if (!deal) return { error: "Negócio não encontrado." }
  if (deal.status !== "open") return { error: "Só negócios abertos movem por aqui." }
  if (deal.stage_id === stageId) return { ok: true }

  const { data: stage } = await supabaseAdmin
    .from("deal_pipeline_stages")
    .select("id, is_won, is_lost, pipeline_id")
    .eq("tenant_id", scope.tenantId).eq("id", stageId).maybeSingle()
  const st = stage as { id: string; is_won: boolean | null; is_lost: boolean | null; pipeline_id: string | null } | null
  if (!st || st.pipeline_id !== deal.pipeline_id) return { error: "Etapa inválida." }
  if (st.is_won || st.is_lost) return { error: "Ganhar/perder tem fluxo próprio — finalize no app." }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from("tenant_deals")
    .update({ stage_id: stageId, stage_entered_at: now, updated_at: now })
    .eq("id", dealId).eq("tenant_id", scope.tenantId)
  if (error) return { error: error.message }

  await recordDealEvent({
    tenantId: scope.tenantId, dealId, type: "stage_changed",
    conversationId: await conversationOfDeal(scope.tenantId, dealId),
    fromStageId: deal.stage_id, toStageId: stageId, by: scope.userId,
  })
  return { ok: true }
}

// ── Mensagens rápidas (F1) — biblioteca do app com variáveis JÁ resolvidas ────

export interface ExtQuickReply {
  id:       string
  title:    string
  shortcut: string | null
  preview:  string   // conteúdo com {{variáveis}} resolvidas pro contato atual
}

function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "")
}

/**
 * Modelos de Configurações → Respostas rápidas, com as variáveis do registry
 * resolvidas server-side pros dados REAIS do contato (o navegador nunca resolve).
 */
export async function quickRepliesExt(
  scope: ViewerScope,
  viewerName: string | null,
  contactId?: string | null,
): Promise<ExtQuickReply[]> {
  const { data: replies } = await supabaseAdmin
    .from("chat_quick_replies")
    .select("id, shortcut, title, content")
    .eq("tenant_id", scope.tenantId)
    .order("title")
    .limit(60)
  if (!replies?.length) return []

  let contactVars: Record<string, string> = {}
  if (contactId && (await canReachContact(scope, contactId))) {
    const { data: c } = await supabaseAdmin
      .from("chat_contacts")
      .select("custom_name, push_name, phone_number, email")
      .eq("tenant_id", scope.tenantId).eq("id", contactId).maybeSingle()
    if (c) {
      const name = (c.custom_name as string | null)?.trim() || (c.push_name as string | null)?.trim() || ""
      contactVars = {
        nome:     name.split(/\s+/)[0] ?? "",
        telefone: formatPhoneDisplay(c.phone_number as string | null),
        email:    (c.email as string | null) ?? "",
      }
    }
  }
  const now = new Date()
  const vars = withAliases({
    ...contactVars,
    agente: viewerName?.trim().split(/\s+/)[0] ?? "",
    data:   now.toLocaleDateString("pt-BR", { day: "numeric", month: "long" }),
    hora:   now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  })

  return (replies as { id: string; shortcut: string | null; title: string; content: string }[]).map((r) => ({
    id:       r.id,
    title:    r.title,
    shortcut: r.shortcut,
    preview:  renderVars(r.content, vars),
  }))
}

// ── F2: drill-down do negócio (itens + cotações) ──────────────────────────────
// A cotação usa o MESMO domínio do app (commercial/documents.ts): snapshot
// imutável + PDF congelado no storage. A extensão só orquestra — nunca recalcula.

export interface ExtDealItem {
  name:       string
  type:       "product" | "service"
  qty:        number
  unit:       string
  unitPrice:  number   // reais (como tenant_deal_items guarda)
  billing:    "one_time" | "monthly" | "yearly"
  termMonths: number | null
  lineTotal:  number   // reais — contribuição da linha ao valor (prazo aplicado)
}

export interface ExtQuote {
  id:         string
  code:       string
  status:     DocumentStatus
  totalCents: number
  createdAt:  string
  validUntil: string | null
}

export interface ExtDealDetail {
  id:           string
  name:         string | null
  stageName:    string | null
  pipelineName: string | null
  items:        ExtDealItem[]
  totals:       { total: number; mrr: number }
  quotes:       ExtQuote[]
}

type DealItemRow = {
  name: string; type: "product" | "service"; billing: "one_time" | "monthly" | "yearly"
  unit_price: number; quantity: number; unit: string | null; discount: number; term_months: number | null
}

/** Negócio por dentro: itens+valores (mesma matemática do crm/value.ts) + cotações. */
export async function dealDetailExt(
  scope: ViewerScope,
  dealId: string,
): Promise<ExtDealDetail | { error: string }> {
  if (!(await canUseDeals(scope))) return { error: "Sem acesso a Negócios nesta conta." }
  const q = applyDealScope(
    supabaseAdmin
      .from("tenant_deals")
      .select("id, name, deal_pipelines ( name ), deal_pipeline_stages ( name )")
      .eq("tenant_id", scope.tenantId)
      .eq("id", dealId),
    scope,
  )
  const { data: d } = await q.maybeSingle()
  if (!d) return { error: "Negócio não encontrado." }
  const deal = d as Record<string, unknown>

  const { data: rows } = await supabaseAdmin
    .from("tenant_deal_items")
    .select("name, type, billing, unit_price, quantity, unit, discount, term_months")
    .eq("tenant_id", scope.tenantId).eq("deal_id", dealId)
    .order("position", { ascending: true }).order("created_at", { ascending: true })
  const itemRows = (rows ?? []) as DealItemRow[]

  const likes: DealItemLike[] = itemRows.map((r) => ({
    billing: r.billing, unit_price: Number(r.unit_price ?? 0), quantity: Number(r.quantity ?? 1),
    discount: Number(r.discount ?? 0), term_months: r.term_months,
  }))
  const items: ExtDealItem[] = itemRows.map((r, i) => {
    const net = lineSubtotal(likes[i])
    const term = r.term_months ?? DEFAULT_TERM_MONTHS
    const factor = r.billing === "one_time" ? 1 : r.billing === "monthly" ? term : term / 12
    return {
      name: r.name, type: r.type, qty: likes[i].quantity, unit: r.unit ?? "un",
      unitPrice: likes[i].unit_price, billing: r.billing, termMonths: r.term_months ?? null,
      lineTotal: Math.round(net * factor * 100) / 100,
    }
  })
  const summary = computeDealValue(likes)

  const docs = await getDealDocuments(scope.tenantId, dealId)
  return {
    id:           deal.id as string,
    name:         (deal.name as string | null) ?? null,
    stageName:    (deal.deal_pipeline_stages as { name: string | null } | null)?.name ?? null,
    pipelineName: (deal.deal_pipelines as { name: string | null } | null)?.name ?? null,
    items,
    totals: { total: summary.total, mrr: summary.mrr },
    quotes: docs.slice(0, 6).map((doc) => ({
      id: doc.id, code: doc.code, status: doc.status,
      totalCents: doc.totalCents, createdAt: doc.createdAt, validUntil: doc.validUntil,
    })),
  }
}

/** Gera cotação com as condições-padrão da empresa (numera + congela PDF). */
export async function createQuoteExt(
  scope: ViewerScope,
  dealId: string,
): Promise<{ id: string; code: string } | { error: string }> {
  if (!(await canUseDeals(scope))) return { error: "Sem acesso a Negócios nesta conta." }
  const deal = await dealInScope(scope, dealId)
  if (!deal) return { error: "Negócio não encontrado." }
  const defaults = await getDocumentSettings(scope.tenantId)
  const validUntil = new Date(Date.now() + defaults.validityDays * 86_400_000).toISOString().slice(0, 10)
  return createQuote(scope.tenantId, scope.userId, {
    dealId, validUntil, paymentTerms: defaults.paymentTerms, notes: defaults.defaultNotes,
  })
}

type QuoteDocRow = {
  id: string; deal_id: string | null; pdf_path: string | null
  kind: DocumentKind; year: number; number: number; status: DocumentStatus
}

/** Documento no alcance do viewer (gate = o do NEGÓCIO dele; órfão = só gestor). */
async function quoteInScope(scope: ViewerScope, docId: string): Promise<QuoteDocRow | null> {
  if (!(await canUseDeals(scope))) return null
  const { data } = await supabaseAdmin
    .from("commercial_documents")
    .select("id, deal_id, pdf_path, kind, year, number, status")
    .eq("id", docId).eq("tenant_id", scope.tenantId).maybeSingle()
  const doc = (data as QuoteDocRow | null) ?? null
  if (!doc) return null
  if (doc.deal_id) {
    if (!(await dealInScope(scope, doc.deal_id))) return null
  } else if (!seesAllDeals(scope)) return null
  return doc
}

/** Bytes do PDF congelado (pro attach 1-clique no chat aberto). */
export async function quotePdfExt(
  scope: ViewerScope,
  docId: string,
): Promise<{ bytes: ArrayBuffer; fileName: string } | { error: string }> {
  const doc = await quoteInScope(scope, docId)
  if (!doc) return { error: "Cotação não encontrada." }
  if (!doc.pdf_path) return { error: "PDF da cotação indisponível." }
  const { data: blob, error } = await supabaseAdmin.storage.from("chat-attachments").download(doc.pdf_path)
  if (error || !blob) return { error: "Erro ao ler o PDF da cotação." }
  const code = docCode(doc.kind, doc.number, doc.year)
  return { bytes: await blob.arrayBuffer(), fileName: `${code.replace("/", "-")}.pdf` }
}

/** Marca ENVIADA após o envio verificado no WhatsApp Web (+ atribuição na timeline). */
export async function markQuoteSentExt(
  scope: ViewerScope,
  docId: string,
): Promise<{ ok: true } | { error: string }> {
  const doc = await quoteInScope(scope, docId)
  if (!doc) return { error: "Cotação não encontrada." }
  const r = await markDocumentSent(scope.tenantId, scope.userId, docId)
  if ("error" in r) return r
  if (doc.deal_id) {
    const code = docCode(doc.kind, doc.number, doc.year)
    await recordDealEvent({
      tenantId: scope.tenantId, dealId: doc.deal_id, type: "note",
      conversationId: await conversationOfDeal(scope.tenantId, doc.deal_id),
      by: scope.userId, note: `Cotação ${code} enviada pelo WhatsApp Web (extensão)`, postCard: false,
    })
  }
  return { ok: true }
}

// ── F2b: Agenda na ficha (próximo compromisso + agendar no chat aberto) ───────
// Leitura respeita a ESCADA de níveis (fonte única em agenda/access.ts — nível
// ≥ details, igual à sidebar do app). Booking = qualquer membro (espelho do app:
// createAppointment não restringe por share) via núcleo bookAppointment
// (anti-double-book EXCLUDE, notificação do host, lembretes server-side).

export interface ExtAppt {
  id:           string
  startsAt:     string
  endsAt:       string
  status:       string
  serviceName:  string | null
  resourceName: string | null
}

export interface ExtAgenda {
  enabled:   boolean
  next:      ExtAppt | null
  upcoming:  number
  resources: { id: string; name: string }[]
  services:  { id: string; name: string; durationMinutes: number; resourceIds: string[] }[]
}

type ExtApptRow = ApptVisibility & {
  id: string; resource_id: string; starts_at: string; ends_at: string; status: string
  tenant_services: { name: string | null } | null
  tenant_resources: { name: string | null; assigned_agent_id: string | null; share_everyone_level: ShareLevel | null } | null
}

/** Agenda do contato: próximos compromissos visíveis + agendas/serviços ativos. */
export async function agendaForContactExt(
  scope: ViewerScope,
  contactId: string,
): Promise<ExtAgenda | { error: string }> {
  if (!(await canReachContact(scope, contactId))) return { error: "Contato não encontrado." }
  if (!(await hasModule(scope.tenantId, "agenda")))
    return { enabled: false, next: null, upcoming: 0, resources: [], services: [] }

  const { data: rows } = await supabaseAdmin
    .from("appointments")
    .select(`id, resource_id, starts_at, ends_at, status, created_by,
      tenant_services(name),
      tenant_resources(name, assigned_agent_id, share_everyone_level),
      chat_conversations(instance_id, assigned_to, participants, department_id)`)
    .eq("tenant_id", scope.tenantId).eq("contact_id", contactId)
    .gte("ends_at", new Date().toISOString())
    .in("status", ["scheduled", "confirmed"])
    .order("starts_at", { ascending: true })
    .limit(10)
  const all = (rows ?? []) as unknown as ExtApptRow[]

  // Mesma régua do app (getContactAppointments): nível ≥ details entra.
  let visible = all
  if (!scope.isAdmin && all.length) {
    const shareMap = await viewerShareMap(scope)
    const { data: parts } = await supabaseAdmin
      .from("appointment_participants")
      .select("appointment_id")
      .eq("tenant_id", scope.tenantId).eq("user_id", scope.userId)
      .in("appointment_id", all.map((a) => a.id))
    const coSet = new Set((parts ?? []).map((p) => p.appointment_id as string))
    visible = all.filter(
      (a) => LEVEL_RANK[appointmentLevel(scope, a, shareMap.get(a.resource_id), coSet.has(a.id))] >= LEVEL_RANK.details,
    )
  }

  const [resR, svcR] = await Promise.all([
    supabaseAdmin.from("tenant_resources").select("id, name").eq("tenant_id", scope.tenantId).eq("active", true).order("name"),
    supabaseAdmin.from("tenant_services").select("id, name, duration_minutes, resource_ids").eq("tenant_id", scope.tenantId).eq("active", true).order("name"),
  ])

  const nxt = visible[0] ?? null
  return {
    enabled: true,
    next: nxt ? {
      id: nxt.id, startsAt: nxt.starts_at, endsAt: nxt.ends_at, status: nxt.status,
      serviceName: nxt.tenant_services?.name ?? null, resourceName: nxt.tenant_resources?.name ?? null,
    } : null,
    upcoming: visible.length,
    resources: ((resR.data ?? []) as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name })),
    services: ((svcR.data ?? []) as { id: string; name: string; duration_minutes: number; resource_ids: string[] | null }[])
      .map((s) => ({ id: s.id, name: s.name, durationMinutes: s.duration_minutes, resourceIds: s.resource_ids ?? [] })),
  }
}

/** Horários livres de UMA agenda num dia (America/Sao_Paulo, −03 fixo desde 2019). */
export async function agendaSlotsExt(
  scope: ViewerScope,
  input: { resourceId: string; serviceId?: string | null; date: string },
): Promise<{ slots: { start: string; end: string }[] } | { error: string }> {
  if (!(await hasModule(scope.tenantId, "agenda"))) return { error: "Módulo Agenda não habilitado." }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "Dia inválido." }
  const slots = await availabilitySlots(scope.tenantId, {
    resourceId: input.resourceId,
    serviceId:  input.serviceId ?? null,
    rangeStart: `${input.date}T00:00:00-03:00`,
    rangeEnd:   `${input.date}T23:59:59-03:00`,
  })
  const now = Date.now()
  return { slots: slots.filter((s) => new Date(s.start).getTime() > now).slice(0, 48) }
}

/**
 * Marca horário pro contato do chat aberto — delega pro núcleo (mesmo motor do app/Studio).
 * `notify` = quem dá o aviso IMEDIATO (lembretes + round-trip do sistema seguem a política, intocados):
 *   "chat"   → o ATENDENTE avisa na conversa aberta: devolvemos a mensagem PRONTA
 *              (texto da política com variáveis resolvidas) pra extensão pré-encher o
 *              composer — humano revisa e envia. Hand-off registrado na auditoria.
 *   "system" → aviso plano pelo canal conectado (comportamento clássico do app).
 *   "none"   → ninguém avisa agora.
 */
export async function bookAppointmentExt(
  scope: ViewerScope,
  input: { contactId: string; resourceId: string; serviceId?: string | null; startsAt: string; notify?: "chat" | "system" | "none" },
): Promise<{ id: string; confirmMessage?: string } | { error: string }> {
  if (!(await hasModule(scope.tenantId, "agenda"))) return { error: "Módulo Agenda não habilitado." }
  if (!(await canReachContact(scope, input.contactId))) return { error: "Contato não encontrado." }
  const notify = input.notify ?? "system"
  const r = await bookAppointment(scope.tenantId, {
    contactId:  input.contactId,
    resourceId: input.resourceId,
    serviceId:  input.serviceId ?? null,
    startsAt:   input.startsAt,
    source:     "agent",
    createdBy:  scope.userId,
    notifyCustomer: true,
    // ≠"system": pula SÓ o aviso plano do sistema (semântica conversationalConfirm
    // da IA); round-trip de confirmação e lembretes da política CONTINUAM.
    conversationalConfirm: notify !== "system",
  })
  if (r.error || !r.id) return { error: r.error ?? "Não deu pra marcar o horário." }
  if (notify !== "chat") return { id: r.id }
  return { id: r.id, confirmMessage: await agendaHandOffMessage(scope, r.id) }
}

/**
 * Mensagem de aviso pronta pro atendente enviar na conversa aberta ("o sistema
 * prepara, o humano dispara"). Usa o MESMO texto do passo "ao agendar" da política
 * do serviço (variáveis do registry resolvidas server-side); sem política → default
 * sóbrio. Registra o hand-off em appointment_reminders (auditoria: o aviso ficou
 * com o atendente, canal extensão).
 */
async function agendaHandOffMessage(scope: ViewerScope, appointmentId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("appointments")
    .select("starts_at, chat_contacts(custom_name, push_name), tenant_services(name, reminder_policy), tenant_resources(name)")
    .eq("tenant_id", scope.tenantId).eq("id", appointmentId).maybeSingle()
  const a = data as unknown as {
    starts_at: string
    chat_contacts: { custom_name: string | null; push_name: string | null } | null
    tenant_services: { name: string | null; reminder_policy: { steps?: { offset_minutes?: number; audience?: string; request_confirmation?: boolean; text?: string }[] } | null } | null
    tenant_resources: { name: string | null } | null
  } | null

  const TZ = "America/Sao_Paulo"
  const starts = a?.starts_at ? new Date(a.starts_at) : new Date()
  // Mesmos nomes/formatos do buildVars dos avisos do sistema (reminders.ts).
  const vars = withAliases({
    nome:    a?.chat_contacts?.custom_name || a?.chat_contacts?.push_name || "",
    data:    starts.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "long" }),
    hora:    starts.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }),
    servico: a?.tenant_services?.name ?? "",
    recurso: a?.tenant_resources?.name ?? "",
  })
  const step = (a?.tenant_services?.reminder_policy?.steps ?? []).find(
    (s) => (s.offset_minutes ?? 0) === 0 && (s.audience ?? "customer") !== "agent" && s.request_confirmation !== true && !!s.text?.trim(),
  )
  const first = (vars.nome || "").trim().split(/\s+/)[0]
  const text = step?.text?.trim()
    ? renderVars(step.text, vars)
    : `Oi${first ? `, ${first}` : ""}! Tudo certo por aqui: ${vars.servico ? `${vars.servico} — ` : ""}${vars.data} às ${vars.hora}. Qualquer imprevisto, é só me avisar por esta conversa.`

  await supabaseAdmin.from("appointment_reminders").insert({
    tenant_id: scope.tenantId, appointment_id: appointmentId,
    step_key: "created#ext", audience: "customer", channel: "extension",
    status: "handed_to_agent", detail: "mensagem preparada na conversa pelo atendente (Kora Companion)",
  })
  return text
}

/** Nota na linha do tempo do negócio (F1) — com autoria real. */
export async function addDealNoteExt(
  scope: ViewerScope,
  dealId: string,
  text: string,
): Promise<{ ok: true } | { error: string }> {
  if (!(await canUseDeals(scope))) return { error: "Sem acesso a Negócios nesta conta." }
  const note = text.trim().slice(0, 2000)
  if (!note) return { error: "Escreva a nota." }
  const deal = await dealInScope(scope, dealId)
  if (!deal) return { error: "Negócio não encontrado." }

  await recordDealEvent({
    tenantId: scope.tenantId, dealId, type: "note",
    conversationId: await conversationOfDeal(scope.tenantId, dealId),
    by: scope.userId, note,
  })
  return { ok: true }
}

// ── Radar do Dia — fila derivada do que JÁ existe (zero migration) ────────────
// Cada fila respeita a régua do PRÓPRIO domínio (nunca duplicar): agenda = escada
// nível ≥ details (agenda/access.ts) · negócios/cotações = applyDealScope + módulo
// crm. Módulo desligado / sem capability = fila simplesmente some (fail-closed).
// `draft` = mensagem pronta pro composer ("o sistema prepara, o humano dispara").

export interface ExtRadar {
  appointments: {
    id: string; startsAt: string; status: string
    serviceName: string | null; resourceName: string | null
    contactName: string | null; contactPhone: string | null
  }[]
  staleDeals: {
    id: string; name: string | null; value: number | null; stageName: string | null
    days: number; contactName: string | null; contactPhone: string | null; draft: string
  }[]
  pendingQuotes: {
    id: string; code: string; totalCents: number; days: number; dealName: string | null
    contactName: string | null; contactPhone: string | null; draft: string
  }[]
  count: number
}

const RADAR_TZ = "America/Sao_Paulo"
const daysSince = (iso: string) => Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
const firstName = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] ?? ""

export async function radarExt(scope: ViewerScope): Promise<ExtRadar> {
  const [appointments, staleDeals, pendingQuotes] = await Promise.all([
    radarAppointments(scope),
    radarStaleDeals(scope),
    radarPendingQuotes(scope),
  ])
  return { appointments, staleDeals, pendingQuotes, count: appointments.length + staleDeals.length + pendingQuotes.length }
}

/** Compromissos de HOJE visíveis ao viewer (mesma escada da agenda). */
async function radarAppointments(scope: ViewerScope): Promise<ExtRadar["appointments"]> {
  if (!(await hasModule(scope.tenantId, "agenda"))) return []
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: RADAR_TZ })
  const { data: rows } = await supabaseAdmin
    .from("appointments")
    .select(`id, resource_id, starts_at, ends_at, status, created_by,
      chat_contacts(custom_name, push_name, phone_number),
      tenant_services(name),
      tenant_resources(name, assigned_agent_id, share_everyone_level),
      chat_conversations(instance_id, assigned_to, participants, department_id)`)
    .eq("tenant_id", scope.tenantId)
    .gte("starts_at", `${ymd}T00:00:00-03:00`).lte("starts_at", `${ymd}T23:59:59-03:00`)
    .in("status", ["scheduled", "confirmed"])
    .order("starts_at", { ascending: true })
    .limit(20)
  type Row = ExtApptRow & { chat_contacts: { custom_name: string | null; push_name: string | null; phone_number: string | null } | null }
  const all = (rows ?? []) as unknown as Row[]

  let visible = all
  if (!scope.isAdmin && all.length) {
    const shareMap = await viewerShareMap(scope)
    const { data: parts } = await supabaseAdmin
      .from("appointment_participants").select("appointment_id")
      .eq("tenant_id", scope.tenantId).eq("user_id", scope.userId)
      .in("appointment_id", all.map((a) => a.id))
    const coSet = new Set((parts ?? []).map((p) => p.appointment_id as string))
    visible = all.filter(
      (a) => LEVEL_RANK[appointmentLevel(scope, a, shareMap.get(a.resource_id), coSet.has(a.id))] >= LEVEL_RANK.details,
    )
  }
  return visible.map((a) => ({
    id: a.id, startsAt: a.starts_at, status: a.status,
    serviceName: a.tenant_services?.name ?? null,
    resourceName: a.tenant_resources?.name ?? null,
    contactName: a.chat_contacts?.custom_name || a.chat_contacts?.push_name || null,
    contactPhone: a.chat_contacts?.phone_number ?? null,
  }))
}

/** Negócios ABERTOS do alcance parados há 7+ dias (updated_at é tocado por toda ação). */
async function radarStaleDeals(scope: ViewerScope): Promise<ExtRadar["staleDeals"]> {
  if (!(await canUseDeals(scope))) return []
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const q = applyDealScope(
    supabaseAdmin
      .from("tenant_deals")
      .select("id, name, estimated_value, updated_at, deal_pipeline_stages(name), chat_contacts(custom_name, push_name, phone_number)")
      .eq("tenant_id", scope.tenantId).eq("status", "open").lt("updated_at", cutoff)
      .order("updated_at", { ascending: true }).limit(10),
    scope,
  )
  const { data } = await q
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const c = r.chat_contacts as { custom_name: string | null; push_name: string | null; phone_number: string | null } | null
    const contactName = c?.custom_name || c?.push_name || null
    const first = firstName(contactName)
    const dealName = (r.name as string | null) ?? null
    return {
      id: r.id as string,
      name: dealName,
      value: (r.estimated_value as number | null) ?? null,
      stageName: (r.deal_pipeline_stages as { name: string | null } | null)?.name ?? null,
      days: daysSince(r.updated_at as string),
      contactName,
      contactPhone: c?.phone_number ?? null,
      draft: `Oi${first ? `, ${first}` : ""}! Passando pra retomar nossa conversa${dealName ? ` sobre ${dealName}` : ""} — conseguiu avaliar? Qualquer dúvida, estou por aqui.`,
    }
  })
}

/** Cotações ENVIADAS há 3+ dias sem aceite/recusa (versão vigente), no alcance. */
async function radarPendingQuotes(scope: ViewerScope): Promise<ExtRadar["pendingQuotes"]> {
  if (!(await canUseDeals(scope))) return []
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const { data: docs } = await supabaseAdmin
    .from("commercial_documents")
    .select("id, kind, year, number, deal_id, sent_at, snapshot")
    .eq("tenant_id", scope.tenantId).eq("kind", "quote").eq("status", "sent")
    .is("superseded_by", null).not("deal_id", "is", null).lt("sent_at", cutoff)
    .order("sent_at", { ascending: true }).limit(15)
  const rows = (docs ?? []) as {
    id: string; kind: DocumentKind; year: number; number: number
    deal_id: string; sent_at: string; snapshot: { totals?: { total_cents?: number } } | null
  }[]
  if (!rows.length) return []

  // Alcance decidido pelo applyDealScope (fonte única) — doc cujo negócio não volta = fora.
  const q = applyDealScope(
    supabaseAdmin
      .from("tenant_deals")
      .select("id, name, chat_contacts(custom_name, push_name, phone_number)")
      .eq("tenant_id", scope.tenantId)
      .in("id", [...new Set(rows.map((r) => r.deal_id))]),
    scope,
  )
  const { data: deals } = await q
  const byId = new Map(((deals ?? []) as Record<string, unknown>[]).map((d) => [d.id as string, d]))

  const out: ExtRadar["pendingQuotes"] = []
  for (const r of rows) {
    const deal = byId.get(r.deal_id)
    if (!deal) continue
    const c = deal.chat_contacts as { custom_name: string | null; push_name: string | null; phone_number: string | null } | null
    const contactName = c?.custom_name || c?.push_name || null
    const first = firstName(contactName)
    const code = docCode(r.kind, r.number, r.year)
    out.push({
      id: r.id, code,
      totalCents: Number(r.snapshot?.totals?.total_cents ?? 0),
      days: daysSince(r.sent_at),
      dealName: (deal.name as string | null) ?? null,
      contactName,
      contactPhone: c?.phone_number ?? null,
      draft: `Oi${first ? `, ${first}` : ""}! Sobre a cotação ${code} que te enviei — ficou alguma dúvida? Posso ajustar o que for preciso.`,
    })
    if (out.length >= 10) break
  }
  return out
}
