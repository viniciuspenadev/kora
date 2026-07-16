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

/** Negócios ABERTOS do contato, no alcance do viewer (Ver = só os dele). */
export async function openDealsForContact(
  scope: ViewerScope,
  contactId: string,
): Promise<ExtDeal[]> {
  if (!canOpenDeals(scope)) return []
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
  if (!canOpenDeals(scope)) return []
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

/**
 * Cria contato a partir do chat aberto (F1). Passa pelo resolver canônico
 * (dedup/merge). Agente sem "base inteira" vira DONO (owner_id) do contato que
 * criou — senão criaria algo que o próprio alcance não enxerga. Foto (opt-in)
 * entra fire-and-forget pelo pipeline do webhook.
 */
export async function createContactExt(
  scope: ViewerScope,
  input: { name: string; phone: string; photoUrl?: string | null },
): Promise<{ id: string } | { error: string }> {
  if (!(scope.isAdmin || canOpenContacts(scope) || canOpenDeals(scope)))
    return { error: "Seu papel não pode criar contatos." }
  const norm = normalizeWhatsAppPhone(input.phone)
  if (!norm) return { error: "Telefone inválido." }
  const name = input.name.trim().slice(0, 120)
  if (!name) return { error: "Informe o nome." }

  const { id, created } = await resolveOrCreateContact(
    scope.tenantId,
    { jid: norm.jid, phone: norm.phone },
    { customName: name, source: "manual", touch: true },
  )
  if (!seesAllContacts(scope)) {
    await supabaseAdmin
      .from("chat_contacts")
      .update({ owner_id: scope.userId })
      .eq("id", id).eq("tenant_id", scope.tenantId).is("owner_id", null)
  }
  if (input.photoUrl) {
    // contato pré-existente: só preenche se ainda não tem foto
    saveAvatarFromCdn(scope.tenantId, id, input.photoUrl, !created).catch(() => {})
  }
  return { id }
}

/** Cria negócio (F1) — delega pro core do CRM (trava 1-aberto, carteira, evento). */
export async function createDealExt(
  scope: ViewerScope,
  input: { contactId: string; name?: string | null; pipelineId: string; stageId: string; value?: number | null },
): Promise<{ id: string } | { error: string }> {
  if (!canOpenDeals(scope)) return { error: "Seu papel não tem acesso a Negócios." }
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
  if (!canOpenDeals(scope)) return { error: "Seu papel não tem acesso a Negócios." }
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
  if (!canOpenDeals(scope)) return { error: "Seu papel não tem acesso a Negócios." }
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
  if (!canOpenDeals(scope)) return { error: "Seu papel não tem acesso a Negócios." }
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
  if (!canOpenDeals(scope)) return null
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

/** Nota na linha do tempo do negócio (F1) — com autoria real. */
export async function addDealNoteExt(
  scope: ViewerScope,
  dealId: string,
  text: string,
): Promise<{ ok: true } | { error: string }> {
  if (!canOpenDeals(scope)) return { error: "Seu papel não tem acesso a Negócios." }
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
