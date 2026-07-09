"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { type SegmentRules } from "@/lib/crm/segment-rules"
import { resolveAudienceContacts, classifyRecipient, CONV_PRICE } from "@/lib/campaigns/audience"
import { materializeRecipients } from "@/lib/campaigns/engine"
import { openerTemplateNode } from "@/lib/campaigns/flow-opener"
import { getInboxTemplates, type InboxTemplate } from "@/lib/actions/whatsapp-official"
import type { FlowGraph } from "@/lib/ai-v2/flow/types"
import { revalidatePath } from "next/cache"

// ─────────────────────────────────────────────────────────────────
// Campanhas WABA (docs/campanhas-waba-design.md). Marketing = SÓ Meta Oficial,
// consent fail-closed. CRUD + preview de audiência + controle do motor (F2b).
// Gestão owner/admin + módulo `broadcasts`.
// ─────────────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "done" | "canceled" | "failed"

export interface CampaignRow {
  id: string; name: string; status: CampaignStatus
  template_name: string | null; template_category: "MARKETING" | "UTILITY" | null
  audience_label: string | null
  scheduled_at: string | null; est_cost: number | null
  created_at: string
  recipients: number
}

export interface AudienceOption { kind: "list" | "tag"; id: string; label: string; count: number; dynamic?: boolean }

export interface AudiencePreview {
  total: number
  eligible: number
  skips: { no_consent: number; no_phone: number }
  estCost: number
}

async function requireManager(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Só owner/admin gerencia campanhas" }
  try { await requireModule("broadcasts") } catch { return { error: "Módulo de marketing não habilitado" } }
  return { tenantId: session.user.tenantId, userId: session.user.id }
}

/** Listas + tags como opções de audiência (com contagem bruta). */
export async function getCampaignAudiences(): Promise<AudienceOption[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const t = gate.tenantId
  const [{ data: lists }, { data: members }, { data: tags }, { data: taggings }] = await Promise.all([
    supabaseAdmin.from("contact_lists").select("id, name, kind, rules").eq("tenant_id", t).order("name"),
    supabaseAdmin.from("contact_list_members").select("list_id").eq("tenant_id", t),
    supabaseAdmin.from("tags").select("id, name").eq("tenant_id", t).order("name"),
    supabaseAdmin.from("taggings").select("tag_id").eq("tenant_id", t).eq("taggable_type", "contact"),
  ])
  const memBy = new Map<string, number>()
  for (const m of (members ?? []) as { list_id: string }[]) memBy.set(m.list_id, (memBy.get(m.list_id) ?? 0) + 1)
  const tagBy = new Map<string, number>()
  for (const x of (taggings ?? []) as { tag_id: string }[]) tagBy.set(x.tag_id, (tagBy.get(x.tag_id) ?? 0) + 1)

  const listOpts: AudienceOption[] = []
  for (const l of (lists ?? []) as { id: string; name: string; kind: string | null; rules: SegmentRules | null }[]) {
    const dynamic = (l.kind ?? "static") === "dynamic"
    // Contagem: dinâmica resolve ao vivo; estática usa membros.
    const count = dynamic ? (await resolveAudienceContacts(t, "list", l.id)).length : (memBy.get(l.id) ?? 0)
    listOpts.push({ kind: "list", id: l.id, label: l.name, count, dynamic })
  }
  const tagOpts: AudienceOption[] = ((tags ?? []) as { id: string; name: string }[]).map((tg) => ({ kind: "tag", id: tg.id, label: tg.name, count: tagBy.get(tg.id) ?? 0 }))
  return [...listOpts, ...tagOpts]
}

/**
 * Preview HONESTO da audiência: total × elegíveis × skips por motivo × custo.
 * Consent fail-closed: MARKETING exige `marketing_opt_in`; UTILITY exige `consent_opt_in`.
 */
export async function previewAudience(input: { kind: "list" | "tag"; id: string; category: "MARKETING" | "UTILITY" }): Promise<AudiencePreview | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const contacts = await resolveAudienceContacts(gate.tenantId, input.kind, input.id)

  let eligible = 0, noConsent = 0, noPhone = 0
  for (const c of contacts) {
    const r = classifyRecipient(c, input.category)
    if ("ok" in r) eligible++
    else if (r.skip === "no_phone") noPhone++
    else noConsent++
  }
  return {
    total: contacts.length, eligible,
    skips: { no_consent: noConsent, no_phone: noPhone },
    estCost: Math.round(eligible * CONV_PRICE[input.category] * 100) / 100,
  }
}

/** Lista de campanhas do tenant (mais recentes primeiro) com contagem de destinatários. */
export async function getCampaigns(): Promise<CampaignRow[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const t = gate.tenantId
  const [{ data: rows }, { data: recips }] = await Promise.all([
    supabaseAdmin.from("campaigns")
      .select("id, name, status, template_name, template_category, audience_label, scheduled_at, est_cost, created_at")
      .eq("tenant_id", t).order("created_at", { ascending: false }),
    supabaseAdmin.from("campaign_recipients").select("campaign_id").eq("tenant_id", t),
  ])
  const recBy = new Map<string, number>()
  for (const r of (recips ?? []) as { campaign_id: string }[]) recBy.set(r.campaign_id, (recBy.get(r.campaign_id) ?? 0) + 1)
  return ((rows ?? []) as Omit<CampaignRow, "recipients">[]).map((c) => ({ ...c, recipients: recBy.get(c.id) ?? 0 }))
}

export interface CampaignDetail extends CampaignRow {
  template_language: string | null
  instance_label: string | null
  batch_size: number
  batch_interval_seconds: number
  opt_out_enabled: boolean
  audience_kind: "list" | "tag" | null
  audience_id: string | null
  started_at: string | null
  finished_at: string | null
  /** Contagem por status dos destinatários (fila viva do motor). */
  byStatus: Record<string, number>
}

export async function getCampaign(id: string): Promise<CampaignDetail | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const { data: c } = await supabaseAdmin.from("campaigns")
    .select("id, name, status, template_name, template_language, template_category, instance_id, audience_kind, audience_id, audience_label, scheduled_at, started_at, finished_at, batch_size, batch_interval_seconds, opt_out_enabled, est_cost, created_at")
    .eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!c) return { error: "Campanha não encontrada" }
  const C = c as Record<string, unknown>

  const [{ data: inst }, { data: recips }] = await Promise.all([
    C.instance_id ? supabaseAdmin.from("whatsapp_instances").select("display_name, phone_number").eq("id", C.instance_id as string).eq("tenant_id", t).maybeSingle() : Promise.resolve({ data: null }),
    supabaseAdmin.from("campaign_recipients").select("status").eq("tenant_id", t).eq("campaign_id", id),
  ])
  const byStatus: Record<string, number> = {}
  for (const r of (recips ?? []) as { status: string }[]) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
  const instLabel = (inst as { display_name: string | null; phone_number: string | null } | null)
  return {
    id: C.id as string, name: C.name as string, status: C.status as CampaignStatus,
    template_name: (C.template_name as string | null) ?? null, template_category: (C.template_category as "MARKETING" | "UTILITY" | null) ?? null,
    template_language: (C.template_language as string | null) ?? null,
    audience_label: (C.audience_label as string | null) ?? null, audience_kind: (C.audience_kind as "list" | "tag" | null) ?? null, audience_id: (C.audience_id as string | null) ?? null,
    instance_label: instLabel?.display_name?.trim() || instLabel?.phone_number || null,
    scheduled_at: (C.scheduled_at as string | null) ?? null, started_at: (C.started_at as string | null) ?? null, finished_at: (C.finished_at as string | null) ?? null,
    batch_size: Number(C.batch_size ?? 10), batch_interval_seconds: Number(C.batch_interval_seconds ?? 30), opt_out_enabled: !!C.opt_out_enabled,
    est_cost: (C.est_cost as number | null) ?? null, created_at: C.created_at as string,
    recipients: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus,
  }
}

// ── Detalhe por DESTINATÁRIO (saber cada cliente) ───────────────
export interface CampaignRecipientRow {
  id: string; name: string; phone: string | null
  status: string; skipReason: string | null; error: string | null
  sentAt: string | null; deliveredAt: string | null; readAt: string | null; repliedAt: string | null
  conversationId: string | null
}
export type RecipientFilter = "all" | "sent" | "replied" | "failed" | "skipped" | "queued"

/** Lista paginada de destinatários da campanha + status/tempos + link pra conversa.
 *  Cursor por id (estável). Filtro por grupo de status. */
export async function getCampaignRecipients(
  campaignId: string,
  opts?: { filter?: RecipientFilter; cursor?: string | null; limit?: number },
): Promise<{ items: CampaignRecipientRow[]; nextCursor: string | null; hasMore: boolean } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 100)

  const { data: camp } = await supabaseAdmin.from("campaigns").select("instance_id").eq("id", campaignId).eq("tenant_id", t).maybeSingle()
  if (!camp) return { error: "Campanha não encontrada" }
  const instanceId = (camp as { instance_id: string | null }).instance_id

  let q = supabaseAdmin.from("campaign_recipients")
    .select("id, phone, status, skip_reason, error, sent_at, delivered_at, read_at, replied_at, contact_id, chat_contacts(custom_name, push_name)")
    .eq("tenant_id", t).eq("campaign_id", campaignId)
    .order("id", { ascending: true }).limit(limit + 1)
  const f = opts?.filter ?? "all"
  if (f === "sent")         q = q.in("status", ["sent", "delivered", "read", "replied"])
  else if (f !== "all")     q = q.eq("status", f)
  if (opts?.cursor) q = q.gt("id", opts.cursor)

  const { data, error } = await q
  if (error) return { error: error.message }
  const rows = (data ?? []) as unknown as {
    id: string; phone: string | null; status: string; skip_reason: string | null; error: string | null
    sent_at: string | null; delivered_at: string | null; read_at: string | null; replied_at: string | null
    contact_id: string | null; chat_contacts: { custom_name: string | null; push_name: string | null } | null
  }[]

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  // Conversas desses contatos no número da campanha → link "abrir conversa".
  const convByContact = new Map<string, string>()
  const contactIds = page.map((r) => r.contact_id).filter(Boolean) as string[]
  if (contactIds.length && instanceId) {
    const { data: convs } = await supabaseAdmin.from("chat_conversations")
      .select("id, contact_id").eq("tenant_id", t).eq("instance_id", instanceId).in("contact_id", contactIds)
    for (const c of (convs ?? []) as { id: string; contact_id: string }[]) if (!convByContact.has(c.contact_id)) convByContact.set(c.contact_id, c.id)
  }

  const items: CampaignRecipientRow[] = page.map((r) => ({
    id: r.id,
    name: r.chat_contacts?.custom_name?.trim() || r.chat_contacts?.push_name?.trim() || r.phone || "Sem nome",
    phone: r.phone, status: r.status, skipReason: r.skip_reason, error: r.error,
    sentAt: r.sent_at, deliveredAt: r.delivered_at, readAt: r.read_at, repliedAt: r.replied_at,
    conversationId: r.contact_id ? convByContact.get(r.contact_id) ?? null : null,
  }))
  return { items, nextCursor: hasMore ? page[page.length - 1].id : null, hasMore }
}

/** Materializa os destinatários de um RASCUNHO pra virarem lista selecionável
 *  (antes do disparo). Idempotente — reusa se já materializou. */
export async function materializeCampaignDraft(campaignId: string): Promise<{ queued: number; skipped: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const { data: c } = await supabaseAdmin.from("campaigns")
    .select("status, template_category, audience_kind, audience_id").eq("id", campaignId).eq("tenant_id", t).maybeSingle()
  if (!c) return { error: "Campanha não encontrada" }
  const C = c as { status: string; template_category: "MARKETING" | "UTILITY"; audience_kind: "list" | "tag"; audience_id: string }
  if (!["draft", "scheduled"].includes(C.status)) return { error: "Os destinatários só podem ser selecionados antes do disparo." }
  const mat = await materializeRecipients(t, campaignId, C.audience_kind, C.audience_id, C.template_category)
  if ("error" in mat) return mat
  revalidatePath(`/campanhas/${campaignId}`)
  return mat
}

/** Inclui/exclui destinatários DA fila (queued ↔ excluded) — só antes do disparo.
 *  NUNCA inclui um `skipped` (sem consentimento/telefone) — consent fail-closed. */
export async function setRecipientsIncluded(campaignId: string, recipientIds: string[], included: boolean): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  if (!recipientIds.length) return { ok: true }
  const { data: c } = await supabaseAdmin.from("campaigns").select("status").eq("id", campaignId).eq("tenant_id", t).maybeSingle()
  if (!c) return { error: "Campanha não encontrada" }
  if (!["draft", "scheduled"].includes((c as { status: string }).status)) return { error: "Só dá pra selecionar antes do disparo." }
  const from = included ? "excluded" : "queued"
  const to   = included ? "queued" : "excluded"
  const { error } = await supabaseAdmin.from("campaign_recipients")
    .update({ status: to }).eq("tenant_id", t).eq("campaign_id", campaignId).in("id", recipientIds).eq("status", from)
  if (error) return { error: error.message }
  revalidatePath(`/campanhas/${campaignId}`)
  return { ok: true }
}

export interface CreateCampaignInput {
  name: string
  templateName: string; templateLanguage: string; templateCategory: "MARKETING" | "UTILITY"
  instanceId: string
  audienceKind: "list" | "tag"; audienceId: string; audienceLabel: string
  scheduledAt?: string | null       // ISO ou null = enviar depois (rascunho)
  /** Ritmo em 2 eixos: N mensagens a cada X segundos + jitter no motor. */
  batchSize?: number
  batchIntervalSeconds?: number
  optOutEnabled?: boolean
  varMapping?: Record<string, string>
  estCost?: number | null
  /** Campanha-por-fluxo: fluxo do Studio que roda quando o cliente engaja. */
  flowId?: string | null
}

/** Cria a campanha (rascunho ou agendada). O disparo real é o motor (F2b). */
export async function createCampaign(input: CreateCampaignInput): Promise<{ id: string } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const name = input.name.trim()
  if (!name) return { error: "Dê um nome à campanha" }
  if (!input.templateName) return { error: "Escolha o template" }
  if (!input.instanceId) return { error: "Escolha o número de saída" }
  if (!input.audienceId) return { error: "Escolha a audiência" }

  // Anti-IDOR: número e audiência têm que ser do tenant.
  const { data: inst } = await supabaseAdmin.from("whatsapp_instances")
    .select("id").eq("id", input.instanceId).eq("tenant_id", t).eq("provider", "meta_cloud").maybeSingle()
  if (!inst) return { error: "Número de saída inválido (precisa ser um número oficial)" }

  // Campanha-por-fluxo (opcional): valida que o fluxo é DO tenant.
  let flowId: string | null = null
  if (input.flowId) {
    const { data: fl } = await supabaseAdmin.from("studio_flows").select("id").eq("id", input.flowId).eq("tenant_id", t).maybeSingle()
    if (!fl) return { error: "Fluxo inválido" }
    flowId = input.flowId
  }

  const scheduledAt = input.scheduledAt || null
  const status: CampaignStatus = scheduledAt ? "scheduled" : "draft"
  const batchSize = Math.min(500, Math.max(1, Math.floor(input.batchSize ?? 10)))
  const batchInterval = Math.min(3600, Math.max(1, Math.floor(input.batchIntervalSeconds ?? 30)))

  const { data, error } = await supabaseAdmin.from("campaigns").insert({
    tenant_id: t, name, status,
    template_name: input.templateName, template_language: input.templateLanguage, template_category: input.templateCategory,
    instance_id: input.instanceId,
    audience_kind: input.audienceKind, audience_id: input.audienceId, audience_label: input.audienceLabel,
    var_mapping: input.varMapping ?? {},
    scheduled_at: scheduledAt,
    batch_size: batchSize, batch_interval_seconds: batchInterval,
    // Agendada já nasce com o gatilho do 1º lote no horário; rascunho dispara manual.
    next_batch_at: scheduledAt,
    flow_id: flowId,
    opt_out_enabled: input.optOutEnabled ?? true,
    est_cost: input.estCost ?? null,
    created_by: gate.userId,
  }).select("id").single()
  if (error) return { error: error.message }
  revalidatePath("/campanhas")
  return { id: (data as { id: string }).id }
}

// ── Controle do motor (F2b) ─────────────────────────────────────
// Materializa os destinatários (consent fail-closed) e liga/pausa/retoma/cancela.

/**
 * DISPARAR: rascunho/agendada → running. Materializa os destinatários AGORA
 * (fila `queued` + `skipped` com motivo) e arma o 1º lote. O cron toca daqui.
 */
export async function startCampaign(id: string): Promise<{ ok: true; queued: number; skipped: number } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const { data: c } = await supabaseAdmin.from("campaigns")
    .select("status, template_category, audience_kind, audience_id").eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!c) return { error: "Campanha não encontrada" }
  const C = c as { status: string; template_category: "MARKETING" | "UTILITY"; audience_kind: "list" | "tag"; audience_id: string }
  if (!["draft", "scheduled"].includes(C.status)) return { error: "A campanha não pode ser disparada neste estado" }

  const mat = await materializeRecipients(t, id, C.audience_kind, C.audience_id, C.template_category)
  if ("error" in mat) return mat
  if (mat.queued === 0) return { error: "Ninguém elegível nesta audiência (sem opt-in/telefone) — nada a enviar." }

  const now = new Date().toISOString()
  await supabaseAdmin.from("campaigns")
    .update({ status: "running", started_at: now, next_batch_at: now, updated_at: now })
    .eq("id", id).eq("tenant_id", t)
  revalidatePath("/campanhas"); revalidatePath(`/campanhas/${id}`)
  return { ok: true, queued: mat.queued, skipped: mat.skipped }
}

export async function pauseCampaign(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { error } = await supabaseAdmin.from("campaigns")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", gate.tenantId).eq("status", "running")
  if (error) return { error: error.message }
  revalidatePath(`/campanhas/${id}`); revalidatePath("/campanhas")
  return { ok: true }
}

export async function resumeCampaign(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from("campaigns")
    .update({ status: "running", next_batch_at: now, updated_at: now })
    .eq("id", id).eq("tenant_id", gate.tenantId).eq("status", "paused")
  if (error) return { error: error.message }
  revalidatePath(`/campanhas/${id}`); revalidatePath("/campanhas")
  return { ok: true }
}

export async function cancelCampaign(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const now = new Date().toISOString()
  // Cancela a campanha e descarta a fila restante (queued → skipped:canceled).
  const { error } = await supabaseAdmin.from("campaigns")
    .update({ status: "canceled", finished_at: now, updated_at: now })
    .eq("id", id).eq("tenant_id", gate.tenantId).in("status", ["running", "paused", "scheduled"])
  if (error) return { error: error.message }
  await supabaseAdmin.from("campaign_recipients")
    .update({ status: "skipped", skip_reason: "canceled" })
    .eq("tenant_id", gate.tenantId).eq("campaign_id", id).eq("status", "queued")
  revalidatePath(`/campanhas/${id}`); revalidatePath("/campanhas")
  return { ok: true }
}

export async function deleteCampaign(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { data: c } = await supabaseAdmin.from("campaigns").select("status").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle()
  if (!c) return { error: "Campanha não encontrada" }
  if (["running", "paused"].includes((c as { status: string }).status)) return { error: "Pause e finalize a campanha antes de excluir" }
  const { error } = await supabaseAdmin.from("campaigns").delete().eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/campanhas")
  return { ok: true }
}

export interface CampaignFlowOption {
  id: string; name: string
  /** true = começa com nó Template (pode virar campanha). */
  ready: boolean
  openerName: string | null; openerLanguage: string | null; openerCategory: "MARKETING" | "UTILITY" | null
}

/**
 * Fluxos de MARKETING publicados pro picker de campanha-por-fluxo — com o
 * "template de acionamento" (1º nó) resolvido. `ready=false` = não começa com
 * template (não pode virar campanha; a UI explica e induz o ajuste no Studio).
 */
export async function getCampaignReadyFlows(): Promise<CampaignFlowOption[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const t = gate.tenantId
  const { data } = await supabaseAdmin.from("studio_flows")
    .select("id, name, graph").eq("tenant_id", t).eq("purpose", "marketing").eq("status", "published")
    .order("updated_at", { ascending: false })
  const flows = (data ?? []) as { id: string; name: string; graph: FlowGraph }[]
  const openers = flows.map((f) => ({ f, op: openerTemplateNode(f.graph) }))

  // Categoria dos openers via cache wa_templates (consent gate).
  const names = Array.from(new Set(openers.map((o) => o.op?.name).filter(Boolean))) as string[]
  const catBy = new Map<string, "MARKETING" | "UTILITY">()
  if (names.length) {
    const { data: tpls } = await supabaseAdmin.from("wa_templates").select("name, language, category").eq("tenant_id", t).in("name", names)
    for (const r of (tpls ?? []) as { name: string; language: string; category: string | null }[]) {
      catBy.set(`${r.name}|${r.language}`, (r.category ?? "").toUpperCase() === "UTILITY" ? "UTILITY" : "MARKETING")
    }
  }
  return openers.map(({ f, op }) => ({
    id: f.id, name: f.name, ready: !!op,
    openerName: op?.name ?? null, openerLanguage: op?.language ?? null,
    openerCategory: op ? (catBy.get(`${op.name}|${op.language}`) ?? "MARKETING") : null,
  }))
}

/** Tudo que o wizard de criação precisa, sob demanda (pro modal abrir sem custo na lista). */
export interface CampaignWizardData {
  audiences: AudienceOption[]
  templates: InboxTemplate[]
  numbers:   { id: string; label: string }[]
  flows:     CampaignFlowOption[]
}
export async function getCampaignWizardData(): Promise<CampaignWizardData> {
  const [audiences, templates, numbers, flows] = await Promise.all([
    getCampaignAudiences(), getInboxTemplates(), getOutboundNumbers(), getCampaignReadyFlows(),
  ])
  return { audiences, templates, numbers, flows }
}

/** Números oficiais (meta_cloud) do tenant pro seletor de saída. */
export async function getOutboundNumbers(): Promise<{ id: string; label: string }[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const { data } = await supabaseAdmin.from("whatsapp_instances")
    .select("id, display_name, phone_number, meta_phone_number_id").eq("tenant_id", gate.tenantId).eq("provider", "meta_cloud").order("created_at")
  return ((data ?? []) as { id: string; display_name: string | null; phone_number: string | null }[])
    .map((i) => ({ id: i.id, label: i.display_name?.trim() || i.phone_number || "Número oficial" }))
}
