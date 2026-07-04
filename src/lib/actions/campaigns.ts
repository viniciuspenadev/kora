"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { matchesSegment, type SegmentRules } from "@/lib/crm/segment-rules"
import { revalidatePath } from "next/cache"

// ─────────────────────────────────────────────────────────────────
// Campanhas WABA — C1 (docs/campanhas-waba-design.md).
// Marketing = SÓ Meta Oficial, consent fail-closed. O disparo (motor) é C3;
// aqui é CRUD + preview de audiência (elegíveis/skips) + estimativa de custo.
// Gestão owner/admin + módulo `broadcasts`.
// ─────────────────────────────────────────────────────────────────

/** Preço aproximado por conversa iniciada (BRL) — configurável no futuro (admin). */
const CONV_PRICE = { MARKETING: 0.35, UTILITY: 0.08 } as const

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

interface AudContact { id: string; phone: string | null; marketing_opt_in: boolean; consent_opt_in: boolean }

/**
 * Resolve a audiência (lista estática/dinâmica OU tag) → contatos DISTINTOS com
 * telefone + consent. Dinâmica avalia as regras ao vivo. Cap 5000 (v1).
 */
async function resolveAudienceContacts(t: string, kind: "list" | "tag", id: string): Promise<AudContact[]> {
  const pick = (rows: unknown[]): AudContact[] =>
    (rows as { id: string; phone_number: string | null; marketing_opt_in: boolean | null; consent_opt_in: boolean | null }[])
      .map((c) => ({ id: c.id, phone: c.phone_number, marketing_opt_in: !!c.marketing_opt_in, consent_opt_in: !!c.consent_opt_in }))

  if (kind === "tag") {
    const { data: tg } = await supabaseAdmin.from("taggings")
      .select("taggable_id").eq("tenant_id", t).eq("taggable_type", "contact").eq("tag_id", id).limit(5000)
    const ids = Array.from(new Set(((tg ?? []) as { taggable_id: string }[]).map((x) => x.taggable_id)))
    if (!ids.length) return []
    const { data } = await supabaseAdmin.from("chat_contacts")
      .select("id, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).in("id", ids)
    return pick(data ?? [])
  }

  // Lista: estática (membros) ou dinâmica (regras).
  const { data: list } = await supabaseAdmin.from("contact_lists")
    .select("kind, rules").eq("id", id).eq("tenant_id", t).maybeSingle()
  if (!list) return []
  const L = list as { kind: string | null; rules: SegmentRules | null }

  if ((L.kind ?? "static") === "static") {
    const { data: mem } = await supabaseAdmin.from("contact_list_members")
      .select("contact_id").eq("tenant_id", t).eq("list_id", id).limit(5000)
    const ids = ((mem ?? []) as { contact_id: string }[]).map((m) => m.contact_id)
    if (!ids.length) return []
    const { data } = await supabaseAdmin.from("chat_contacts")
      .select("id, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).in("id", ids)
    return pick(data ?? [])
  }

  // Dinâmica: avalia regras ao vivo (mesma fonte do leanContacts, com consent/phone).
  if (!L.rules) return []
  const [{ data: cs }, { data: tags }, { data: won }] = await Promise.all([
    supabaseAdmin.from("chat_contacts").select("id, lifecycle_stage, created_at, phone_number, marketing_opt_in, consent_opt_in").eq("tenant_id", t).limit(5000),
    supabaseAdmin.from("taggings").select("tag_id, taggable_id").eq("tenant_id", t).eq("taggable_type", "contact"),
    supabaseAdmin.from("tenant_deals").select("contact_id, won_at").eq("tenant_id", t).eq("status", "won").not("won_at", "is", null).limit(5000),
  ])
  const tagsBy = new Map<string, string[]>()
  for (const x of (tags ?? []) as { tag_id: string; taggable_id: string }[]) {
    const arr = tagsBy.get(x.taggable_id) ?? []; arr.push(x.tag_id); tagsBy.set(x.taggable_id, arr)
  }
  const lastWon = new Map<string, string>()
  for (const w of (won ?? []) as { contact_id: string | null; won_at: string }[]) {
    if (!w.contact_id) continue
    const cur = lastWon.get(w.contact_id)
    if (!cur || w.won_at > cur) lastWon.set(w.contact_id, w.won_at)
  }
  const now = Date.now()
  const out: AudContact[] = []
  for (const c of (cs ?? []) as { id: string; lifecycle_stage: string | null; created_at: string; phone_number: string | null; marketing_opt_in: boolean | null; consent_opt_in: boolean | null }[]) {
    const last = lastWon.get(c.id)
    const seg = {
      lifecycle_stage: c.lifecycle_stage, tag_ids: tagsBy.get(c.id) ?? [], created_at: c.created_at,
      ultima_dias: last ? Math.max(0, Math.floor((now - new Date(last).getTime()) / 86_400_000)) : null,
    }
    if (matchesSegment(seg, L.rules)) out.push({ id: c.id, phone: c.phone_number, marketing_opt_in: !!c.marketing_opt_in, consent_opt_in: !!c.consent_opt_in })
  }
  return out
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
    if (!c.phone) { noPhone++; continue }
    const consented = input.category === "MARKETING" ? c.marketing_opt_in : c.consent_opt_in
    if (!consented) { noConsent++; continue }
    eligible++
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
  pacing_per_min: number
  opt_out_enabled: boolean
  audience_kind: "list" | "tag" | null
  audience_id: string | null
  started_at: string | null
  finished_at: string | null
  /** Contagem por status dos destinatários (vazio até o motor rodar — C3). */
  byStatus: Record<string, number>
}

export async function getCampaign(id: string): Promise<CampaignDetail | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const t = gate.tenantId
  const { data: c } = await supabaseAdmin.from("campaigns")
    .select("id, name, status, template_name, template_language, template_category, instance_id, audience_kind, audience_id, audience_label, scheduled_at, started_at, finished_at, pacing_per_min, opt_out_enabled, est_cost, created_at")
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
    pacing_per_min: Number(C.pacing_per_min ?? 20), opt_out_enabled: !!C.opt_out_enabled,
    est_cost: (C.est_cost as number | null) ?? null, created_at: C.created_at as string,
    recipients: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus,
  }
}

export interface CreateCampaignInput {
  name: string
  templateName: string; templateLanguage: string; templateCategory: "MARKETING" | "UTILITY"
  instanceId: string
  audienceKind: "list" | "tag"; audienceId: string; audienceLabel: string
  scheduledAt?: string | null       // ISO ou null = enviar depois (rascunho)
  pacingPerMin?: number
  optOutEnabled?: boolean
  varMapping?: Record<string, string>
  estCost?: number | null
}

/** Cria a campanha (rascunho ou agendada). O disparo real é o motor (C3). */
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

  const scheduledAt = input.scheduledAt || null
  const status: CampaignStatus = scheduledAt ? "scheduled" : "draft"
  const pacing = Math.min(240, Math.max(1, Math.floor(input.pacingPerMin ?? 20)))

  const { data, error } = await supabaseAdmin.from("campaigns").insert({
    tenant_id: t, name, status,
    template_name: input.templateName, template_language: input.templateLanguage, template_category: input.templateCategory,
    instance_id: input.instanceId,
    audience_kind: input.audienceKind, audience_id: input.audienceId, audience_label: input.audienceLabel,
    var_mapping: input.varMapping ?? {},
    scheduled_at: scheduledAt, pacing_per_min: pacing,
    opt_out_enabled: input.optOutEnabled ?? true,
    est_cost: input.estCost ?? null,
    created_by: gate.userId,
  }).select("id").single()
  if (error) return { error: error.message }
  revalidatePath("/campanhas")
  return { id: (data as { id: string }).id }
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

/** Números oficiais (meta_cloud) do tenant pro seletor de saída. */
export async function getOutboundNumbers(): Promise<{ id: string; label: string }[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const { data } = await supabaseAdmin.from("whatsapp_instances")
    .select("id, display_name, phone_number, meta_phone_number_id").eq("tenant_id", gate.tenantId).eq("provider", "meta_cloud").order("created_at")
  return ((data ?? []) as { id: string; display_name: string | null; phone_number: string | null }[])
    .map((i) => ({ id: i.id, label: i.display_name?.trim() || i.phone_number || "Número oficial" }))
}
