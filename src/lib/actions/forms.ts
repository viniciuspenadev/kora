"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Formulários — ações (Fase 1: cadastro e edição do rascunho)
// ═══════════════════════════════════════════════════════════════
// Toda ação deriva a empresa da SESSÃO e passa pelo portão do módulo + permissão (fail-closed
// no servidor; a tela só esconde). Ver = ler · Gerenciar = criar/editar/duplicar/excluir.
// Nada aqui é helper exportado (arquivo "use server" = toda exportação vira ação pública).
// Desenho: docs/forms-design.md §4.1 e §5.

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule, hasModule } from "@/lib/modules"
import { asFormOutcome, type FormOutcome } from "@/lib/forms/outcomes"
import { getViewerScope, canViewForms, canManageForms } from "@/lib/visibility"
import { logAudit } from "@/lib/audit"
import { normalizeDefinition, draftProblems, publishProblems, answerLabel, type Answers, type FormDefinition } from "@/lib/forms/definition"
import { canonicalJson } from "@/lib/forms/canonical"
import { definitionHash } from "@/lib/forms/server"
import { formatPhoneDisplay } from "@/lib/phone-utils"
import { isTemplateKey, templateDefinition, templateInfo } from "@/lib/forms/templates"
import { newPublicId, formSlugFrom, uniqueSlug, uniqueName, isUuid, cleanFormName } from "@/lib/forms/identity"

export type FormStatus = "draft" | "published" | "paused"

export interface FormListItem {
  id:             string
  name:           string
  status:         FormStatus
  templateKey:    string | null
  questionCount:  number
  updatedAt:      string
  responses30d:   number
  responsesTotal: number
  lastResponseAt: string | null
  /** Fluxo do Studio que chama quem envia este formulário (null = nenhum). */
  flow:           FormFlowLink | null
  /** Respostas que viraram conversa (a pessoa respondeu a mensagem do Kora). */
  conversations:  number
}

export interface FormFlowLink { id: string; name: string; live: boolean }

export interface FormDetail {
  id:          string
  name:        string
  status:      FormStatus
  slug:        string
  publicId:    string
  templateKey: string | null
  draft:       FormDefinition
  revision:    number
  updatedAt:   string
  canManage:   boolean
  /** O que está no ar (null = nunca publicado). O editor compara com o rascunho. */
  published:   { version: number; publishedAt: string; definition: FormDefinition } | null
  /** Caminho do link próprio (`/f/<empresa>/<formulário>`); o domínio a tela completa. */
  publicPath:  string
  responsesTotal: number
  flow:        FormFlowLink | null
  /** Pode criar o fluxo no Studio daqui (dono/admin com o módulo Kora Studio). */
  canCreateFlow: boolean
}

export interface SubmissionItem {
  id:          string
  createdAt:   string
  name:        string
  phone:       string
  contactId:   string | null
  /** Pergunta → resposta legível, na ordem da versão que a pessoa viu. */
  answers:     { title: string; value: string }[]
  source:      { kind: string; page: string | null; utm: Record<string, string> }
  consentAt:   string | null
  marketing:   boolean | null
  outcome:     FormOutcome
  /** A pessoa respondeu no WhatsApp depois de enviar (a conversa tem mensagem dela). */
  replied:     boolean
  conversationId: string | null
  conflicts:   number
}

export type SubmissionCursor = { createdAt: string; id: string }

/** Teto do rascunho no app (o banco segura 256 KB; aqui recusa antes, com mensagem clara). */
const DRAFT_MAX_CHARS = 200_000

type Gate = { tenantId: string; userId: string; canManage: boolean; isAdmin: boolean } | { error: string }

async function gate(level: "view" | "manage"): Promise<Gate> {
  let scope: Awaited<ReturnType<typeof getViewerScope>>
  try { scope = await getViewerScope() } catch { return { error: "Não autenticado." } }
  try { await requireModule("forms") } catch { return { error: "O módulo Formulários não está habilitado para esta empresa." } }
  const canManage = canManageForms(scope)
  if (level === "manage" ? !canManage : !canViewForms(scope)) {
    return { error: level === "manage" ? "Sem permissão para gerenciar formulários." : "Sem acesso a formulários." }
  }
  return { tenantId: scope.tenantId, userId: scope.userId, canManage, isAdmin: scope.isAdmin === true }
}

/** Criar fluxo no Studio é de dono/admin com o módulo (a mesma régua do Studio). */
async function canCreateFlowFor(g: { tenantId: string; isAdmin: boolean }): Promise<boolean> {
  return g.isAdmin && (await hasModule(g.tenantId, "ai_studio"))
}

/** Fluxo do Studio ligado a cada formulário. O que está no ar vence; senão o mais antigo. */
async function formFlows(tenantId: string): Promise<Map<string, FormFlowLink>> {
  const out = new Map<string, FormFlowLink>()
  const { data, error } = await supabaseAdmin.from("studio_flows").select("id, name, status, active, trigger, updated_at")
    .eq("tenant_id", tenantId).neq("status", "archived").eq("trigger->>type", "form_submitted")
    .order("updated_at", { ascending: true })
  if (error) { console.error("[forms] fluxos ligados:", error.code, error.message); return out }
  for (const f of (data ?? []) as { id: string; name: string; status: string; active: boolean; trigger: { formId?: string } | null }[]) {
    const formId = f.trigger?.formId
    if (!formId) continue
    const link = { id: f.id, name: f.name, live: f.status === "published" && f.active === true }
    const cur = out.get(formId)
    if (!cur || (!cur.live && link.live)) out.set(formId, link)
  }
  return out
}

/** Ids de conversa → a pessoa mandou mensagem depois de `since`? (respondeu o Kora) */
async function repliedConversations(tenantId: string, rows: { conversation_id: string | null; created_at: string }[]): Promise<Set<string>> {
  const ids = [...new Set(rows.map((r) => r.conversation_id).filter((v): v is string => !!v))]
  const lastIn = new Map<string, string | null>()
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabaseAdmin.from("chat_conversations").select("id, last_inbound_at")
      .eq("tenant_id", tenantId).in("id", ids.slice(i, i + 150))
    for (const c of (data ?? []) as { id: string; last_inbound_at: string | null }[]) lastIn.set(c.id, c.last_inbound_at)
  }
  const out = new Set<string>()
  for (const r of rows) {
    const at = r.conversation_id ? lastIn.get(r.conversation_id) : null
    if (r.conversation_id && at && Date.parse(at) > Date.parse(r.created_at)) out.add(`${r.conversation_id}|${r.created_at}`)
  }
  return out
}

/** "Viraram conversa": por formulário (total) e na empresa (30 dias). Até 5.000 respostas chamadas. */
async function conversationStats(tenantId: string): Promise<{ byForm: Map<string, number>; replied30d: number }> {
  const byForm = new Map<string, number>()
  const { data, error } = await supabaseAdmin.from("form_submissions").select("form_id, conversation_id, created_at")
    .eq("tenant_id", tenantId).not("conversation_id", "is", null).order("created_at", { ascending: false }).limit(5000)
  if (error) return { byForm, replied30d: 0 }
  const rows = (data ?? []) as { form_id: string; conversation_id: string | null; created_at: string }[]
  const replied = await repliedConversations(tenantId, rows)
  const since = Date.now() - 30 * 86_400_000
  let replied30d = 0
  for (const r of rows) {
    if (!replied.has(`${r.conversation_id}|${r.created_at}`)) continue
    byForm.set(r.form_id, (byForm.get(r.form_id) ?? 0) + 1)
    if (Date.parse(r.created_at) >= since) replied30d++
  }
  return { byForm, replied30d }
}

const asStatus = (v: unknown): FormStatus => (v === "published" || v === "paused" ? v : "draft")

async function takenNamesAndSlugs(tenantId: string, exceptId?: string): Promise<{ names: string[]; slugs: string[] } | { error: string }> {
  const { data, error } = await supabaseAdmin.from("forms").select("id, name, slug").eq("tenant_id", tenantId)
  if (error) return { error: "Não foi possível consultar os formulários." }
  const rows = ((data ?? []) as { id: string; name: string; slug: string }[]).filter((r) => r.id !== exceptId)
  return { names: rows.map((r) => r.name), slugs: rows.map((r) => r.slug) }
}

// ── Leitura ──────────────────────────────────────────────────────
export async function listForms(): Promise<{ items: FormListItem[]; canManage: boolean; canCreateFlow: boolean; replied30d: number } | { error: string }> {
  const g = await gate("view")
  if ("error" in g) return g
  const { data, error } = await supabaseAdmin.from("forms")
    .select("id, name, status, template_key, updated_at, questions:draft->questions")
    .eq("tenant_id", g.tenantId).is("archived_at", null)
    .order("updated_at", { ascending: false }).order("id", { ascending: false })
    .limit(200)
  if (error) return { error: "Não foi possível carregar os formulários." }
  const [stats, flows, conv, canCreateFlow] = await Promise.all([
    formStats(g.tenantId), formFlows(g.tenantId), conversationStats(g.tenantId), canCreateFlowFor(g),
  ])
  const items = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const qs = r.questions ?? (r.draft as { questions?: unknown } | undefined)?.questions
    const st = stats.get(r.id as string)
    return {
      id:             r.id as string,
      name:           r.name as string,
      status:         asStatus(r.status),
      templateKey:    (r.template_key as string | null) ?? null,
      questionCount:  Array.isArray(qs) ? qs.length : 0,
      updatedAt:      r.updated_at as string,
      responses30d:   st?.responses30d ?? 0,
      responsesTotal: st?.responsesTotal ?? 0,
      lastResponseAt: st?.lastAt ?? null,
      flow:           flows.get(r.id as string) ?? null,
      conversations:  conv.byForm.get(r.id as string) ?? 0,
    }
  })
  return { items, canManage: g.canManage, canCreateFlow, replied30d: conv.replied30d }
}

/** Contagem por formulário (no banco). Falhou = zeros: a lista continua de pé. */
async function formStats(tenantId: string): Promise<Map<string, { responses30d: number; responsesTotal: number; lastAt: string | null }>> {
  const out = new Map<string, { responses30d: number; responsesTotal: number; lastAt: string | null }>()
  const { data, error } = await supabaseAdmin.rpc("form_list_stats", { p_tenant_id: tenantId })
  if (error) { console.error("[forms] números da lista:", error.code, error.message); return out }
  for (const r of (data ?? []) as { form_id: string; responses_30d: number | string; responses_total: number | string; last_at: string | null }[]) {
    out.set(r.form_id, { responses30d: Number(r.responses_30d) || 0, responsesTotal: Number(r.responses_total) || 0, lastAt: r.last_at })
  }
  return out
}

export async function getForm(id: string): Promise<FormDetail | { error: string }> {
  const g = await gate("view")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data, error } = await supabaseAdmin.from("forms")
    .select("id, name, status, slug, public_id, template_key, draft, draft_revision, updated_at, published_version_id")
    .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
  if (error) return { error: "Não foi possível carregar o formulário." }
  if (!data) return { error: "Formulário não encontrado." }
  const r = data as Record<string, unknown>
  const [{ data: ver }, { data: tenant }, stats, flows, canCreateFlow] = await Promise.all([
    r.published_version_id
      ? supabaseAdmin.from("form_versions").select("version, published_at, definition")
          .eq("tenant_id", g.tenantId).eq("form_id", id).eq("id", r.published_version_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("tenants").select("slug").eq("id", g.tenantId).maybeSingle(),
    formStats(g.tenantId),
    formFlows(g.tenantId),
    canCreateFlowFor(g),
  ])
  const v = ver as { version: number; published_at: string; definition: unknown } | null
  return {
    published:   v ? { version: v.version, publishedAt: v.published_at, definition: normalizeDefinition(v.definition) } : null,
    publicPath:  `/f/${(tenant as { slug?: string } | null)?.slug ?? ""}/${r.slug as string}`,
    responsesTotal: stats.get(id)?.responsesTotal ?? 0,
    flow:        flows.get(id) ?? null,
    canCreateFlow,
    id:          r.id as string,
    name:        r.name as string,
    status:      asStatus(r.status),
    slug:        r.slug as string,
    publicId:    r.public_id as string,
    templateKey: (r.template_key as string | null) ?? null,
    draft:       normalizeDefinition(r.draft),
    revision:    Number(r.draft_revision) || 1,
    updatedAt:   r.updated_at as string,
    canManage:   g.canManage,
  }
}

// ── Escrita ──────────────────────────────────────────────────────
/** Cria um formulário a partir de um modelo da galeria. */
export async function createForm(templateKey: string): Promise<{ id: string } | { error: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isTemplateKey(templateKey)) return { error: "Modelo inválido." }
  const info = templateInfo(templateKey)
  const draft = templateDefinition(templateKey)

  // Até 3 tentativas: outra pessoa pode criar com o mesmo nome no mesmo instante (o banco
  // recusa slug/código repetido e a gente recalcula — nunca sobrescreve).
  for (let attempt = 0; attempt < 3; attempt++) {
    const taken = await takenNamesAndSlugs(g.tenantId)
    if ("error" in taken) return taken
    const name = uniqueName(templateKey === "blank" ? "Novo formulário" : info.name, taken.names)
    const slug = uniqueSlug(formSlugFrom(name), taken.slugs)
    const { data, error } = await supabaseAdmin.from("forms").insert({
      tenant_id: g.tenantId, public_id: newPublicId(), slug, name, status: "draft",
      template_key: templateKey, draft, created_by: g.userId, updated_by: g.userId,
    }).select("id").single()
    if (!error && data) {
      await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.create", targetType: "form",
        targetId: (data as { id: string }).id, metadata: { template: templateKey } })
      revalidatePath("/formularios")
      return { id: (data as { id: string }).id }
    }
    if ((error as { code?: string } | null)?.code !== "23505") return { error: "Não foi possível criar o formulário." }
  }
  return { error: "Não foi possível criar o formulário agora. Tente de novo." }
}

/**
 * Salva o rascunho. `revision` = a versão que a tela tinha quando começou a editar: se outra
 * aba (ou outra pessoa) salvou no meio, o banco não casa e a gravação é RECUSADA — nunca
 * sobrescreve o trabalho de ninguém em silêncio.
 */
export async function saveFormDraft(id: string, draft: unknown, revision: number): Promise<{ revision: number } | { error: string; problems?: string[] }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  if (!Number.isInteger(revision) || revision < 1) return { error: "Versão do rascunho inválida. Recarregue a página." }

  const def = normalizeDefinition(draft)
  const problems = draftProblems(def)
  if (problems.length) return { error: problems[0], problems }
  if (JSON.stringify(def).length > DRAFT_MAX_CHARS) return { error: "O formulário ficou grande demais. Remova perguntas ou encurte os textos." }

  const { data, error } = await supabaseAdmin.from("forms")
    .update({ draft: def, draft_revision: revision + 1, updated_by: g.userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", g.tenantId).eq("id", id).eq("draft_revision", revision).is("archived_at", null)
    .select("draft_revision")
  if (error) return { error: "Não foi possível salvar o rascunho." }
  if (!data?.length) {
    const { data: exists } = await supabaseAdmin.from("forms").select("id")
      .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
    return exists
      ? { error: "Este formulário foi alterado em outra aba ou por outra pessoa. Recarregue para ver a versão mais nova." }
      : { error: "Formulário não encontrado." }
  }
  return { revision: revision + 1 }
}

export async function renameForm(id: string, rawName: string): Promise<{ error?: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const name = cleanFormName(rawName)
  if (!name) return { error: "Dê um nome de 1 a 120 caracteres." }

  const { data: current } = await supabaseAdmin.from("forms").select("id, status, name")
    .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
  if (!current) return { error: "Formulário não encontrado." }
  const patch: Record<string, unknown> = { name, updated_by: g.userId, updated_at: new Date().toISOString() }
  // Enquanto nunca foi ao ar, o link acompanha o nome. Depois de publicado, o link é de quem
  // já colou no site: trocar de nome NÃO muda o endereço (regra da Fase 2).
  if ((current as { status: string }).status === "draft") {
    const taken = await takenNamesAndSlugs(g.tenantId, id)
    if ("error" in taken) return taken
    patch.slug = uniqueSlug(formSlugFrom(name), taken.slugs)
  }
  const { error } = await supabaseAdmin.from("forms").update(patch).eq("tenant_id", g.tenantId).eq("id", id)
  if (error) return { error: (error as { code?: string }).code === "23505" ? "Já existe um formulário com esse endereço. Tente outro nome." : "Não foi possível renomear." }
  await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.rename", targetType: "form", targetId: id,
    before: { name: (current as { name: string }).name }, after: { name } })
  revalidatePath("/formularios")
  return {}
}

export async function duplicateForm(id: string): Promise<{ id: string } | { error: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data: src } = await supabaseAdmin.from("forms").select("id, name, template_key, draft")
    .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
  if (!src) return { error: "Formulário não encontrado." }
  const s = src as { name: string; template_key: string | null; draft: unknown }
  const draft = normalizeDefinition(s.draft)

  for (let attempt = 0; attempt < 3; attempt++) {
    const taken = await takenNamesAndSlugs(g.tenantId)
    if ("error" in taken) return taken
    const name = uniqueName(`${s.name.slice(0, 110)} (cópia)`, taken.names)
    const slug = uniqueSlug(formSlugFrom(name), taken.slugs)
    const { data, error } = await supabaseAdmin.from("forms").insert({
      tenant_id: g.tenantId, public_id: newPublicId(), slug, name, status: "draft",
      template_key: s.template_key, draft, created_by: g.userId, updated_by: g.userId,
    }).select("id").single()
    if (!error && data) {
      const newId = (data as { id: string }).id
      await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.duplicate", targetType: "form", targetId: newId, metadata: { from: id } })
      revalidatePath("/formularios")
      return { id: newId }
    }
    if ((error as { code?: string } | null)?.code !== "23505") return { error: "Não foi possível duplicar o formulário." }
  }
  return { error: "Não foi possível duplicar agora. Tente de novo." }
}

/** Exclui um RASCUNHO (nunca publicado). Formulário que já foi ao ar é pausado/arquivado (Fase 2). */
export async function deleteForm(id: string): Promise<{ error?: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data, error } = await supabaseAdmin.from("forms").delete()
    .eq("tenant_id", g.tenantId).eq("id", id).eq("status", "draft").select("id, name")
  if (error) return { error: "Não foi possível excluir o formulário." }
  if (!data?.length) return { error: "Só dá para excluir formulário que ainda não foi publicado." }
  await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.delete", targetType: "form", targetId: id,
    before: { name: (data[0] as { name: string }).name } })
  revalidatePath("/formularios")
  return {}
}

// ── Publicar (Fase 2) ────────────────────────────────────────────
/**
 * Publica o rascunho: tira um RETRATO novo (form_versions, append-only) e aponta o formulário
 * para ele. O que já está no ar nunca é reescrito — quem respondeu a versão 1 continua
 * apontando para a versão 1. Sem mudança desde a última publicação, não cria versão nova
 * (e, se estava pausado, volta ao ar).
 */
export async function publishForm(id: string): Promise<{ version: number } | { error: string; problems?: string[] }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data: cur } = await supabaseAdmin.from("forms").select("id, status, draft, published_version_id")
    .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
  if (!cur) return { error: "Formulário não encontrado." }
  const c = cur as { status: string; draft: unknown; published_version_id: string | null }
  const def = normalizeDefinition(c.draft)
  const problems = publishProblems(def)
  if (problems.length) return { error: "Falta ajustar antes de publicar.", problems }
  if (JSON.stringify(def).length > DRAFT_MAX_CHARS) return { error: "O formulário ficou grande demais para publicar." }

  if (c.published_version_id) {
    const { data: pv } = await supabaseAdmin.from("form_versions").select("version, definition")
      .eq("tenant_id", g.tenantId).eq("form_id", id).eq("id", c.published_version_id).maybeSingle()
    const p = pv as { version: number; definition: unknown } | null
    if (p && canonicalJson(normalizeDefinition(p.definition)) === canonicalJson(def)) {
      if (c.status !== "published") {
        const r = await resumeForm(id)
        if (r.error) return { error: r.error }
      }
      return { version: p.version }
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await supabaseAdmin.from("form_versions").select("version")
      .eq("tenant_id", g.tenantId).eq("form_id", id).order("version", { ascending: false }).limit(1).maybeSingle()
    const version = ((last as { version?: number } | null)?.version ?? 0) + 1
    const { data: ins, error } = await supabaseAdmin.from("form_versions").insert({
      tenant_id: g.tenantId, form_id: id, version, definition: def, hash: definitionHash(def), published_by: g.userId,
    }).select("id").single()
    if (error) {
      if ((error as { code?: string }).code === "23505") continue   // outra aba publicou junto: próximo número
      console.error("[forms] publicar (versão):", (error as { code?: string }).code, error.message)
      return { error: "Não foi possível publicar." }
    }
    const { error: upErr } = await supabaseAdmin.from("forms").update({
      status: "published", published_version_id: (ins as { id: string }).id, updated_by: g.userId, updated_at: new Date().toISOString(),
    }).eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null)
    if (upErr) {
      console.error("[forms] publicar (formulário):", (upErr as { code?: string }).code, upErr.message)
      return { error: "Não foi possível publicar." }
    }
    await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.publish", targetType: "form", targetId: id, metadata: { version } })
    revalidatePath("/formularios")
    return { version }
  }
  return { error: "Não foi possível publicar agora. Tente de novo." }
}

/** Para de receber respostas (o link mostra "não está recebendo respostas agora"). */
export async function pauseForm(id: string): Promise<{ error?: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data, error } = await supabaseAdmin.from("forms")
    .update({ status: "paused", updated_by: g.userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", g.tenantId).eq("id", id).eq("status", "published").is("archived_at", null).select("id")
  if (error) return { error: "Não foi possível pausar." }
  if (!data?.length) return { error: "Só dá para pausar um formulário publicado." }
  await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.pause", targetType: "form", targetId: id })
  revalidatePath("/formularios")
  return {}
}

/** Volta a receber respostas, com a mesma versão que estava no ar. */
export async function resumeForm(id: string): Promise<{ error?: string }> {
  const g = await gate("manage")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data, error } = await supabaseAdmin.from("forms")
    .update({ status: "published", updated_by: g.userId, updated_at: new Date().toISOString() })
    .eq("tenant_id", g.tenantId).eq("id", id).eq("status", "paused").not("published_version_id", "is", null)
    .is("archived_at", null).select("id")
  if (error) return { error: "Não foi possível retomar." }
  if (!data?.length) return { error: "Só dá para retomar um formulário pausado." }
  await logAudit({ tenantId: g.tenantId, actorId: g.userId, action: "form.resume", targetType: "form", targetId: id })
  revalidatePath("/formularios")
  return {}
}

// ── Respostas (Fase 2: leitura; a tela completa é a Fase 4) ──────
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/
const SUBMISSIONS_PAGE = 30

/**
 * Respostas de um formulário, mais novas primeiro (cursor com desempate por id — padrão do
 * inbox). Respostas são DADO PESSOAL: exige Ver formulários. Busca por nome ou telefone.
 */
export async function listFormSubmissions(formId: string, opts: { cursor?: SubmissionCursor | null; q?: string } = {}): Promise<{ items: SubmissionItem[]; nextCursor: SubmissionCursor | null; hasMore: boolean } | { error: string }> {
  const g = await gate("view")
  if ("error" in g) return g
  if (!isUuid(formId)) return { error: "Formulário não encontrado." }
  const { data: form } = await supabaseAdmin.from("forms").select("id").eq("tenant_id", g.tenantId).eq("id", formId).maybeSingle()
  if (!form) return { error: "Formulário não encontrado." }

  let query = supabaseAdmin.from("form_submissions")
    .select("id, created_at, version_id, contact_id, contact_name, phone_e164, answers, source, consent, outcome, conversation_id, contact_conflicts")
    .eq("tenant_id", g.tenantId).eq("form_id", formId)
  const c = opts.cursor
  if (c) {
    if (!ISO_RE.test(c.createdAt) || !isUuid(c.id)) return { error: "Página inválida." }
    query = query.or(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`)
  }
  // Busca: só letras, números e espaço (nada que mexa no filtro do PostgREST).
  const term = (opts.q ?? "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60)
  if (term) {
    const digits = term.replace(/\D/g, "")
    query = digits.length >= 3
      ? query.or(`contact_name.ilike.*${term}*,phone_e164.like.*${digits}*`)
      : query.ilike("contact_name", `%${term}%`)
  }
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(SUBMISSIONS_PAGE + 1)
  if (error) return { error: "Não foi possível carregar as respostas." }
  const rows = (data ?? []) as Record<string, unknown>[]
  const page = rows.slice(0, SUBMISSIONS_PAGE)

  // Cada resposta é lida com a VERSÃO que a pessoa viu (títulos e opções daquela época).
  const versionIds = [...new Set(page.map((r) => r.version_id as string))]
  const defs = new Map<string, FormDefinition>()
  if (versionIds.length) {
    const { data: vs } = await supabaseAdmin.from("form_versions").select("id, definition")
      .eq("tenant_id", g.tenantId).eq("form_id", formId).in("id", versionIds)
    for (const v of (vs ?? []) as { id: string; definition: unknown }[]) defs.set(v.id, normalizeDefinition(v.definition))
  }

  // Respondeu? = a conversa aberta pelo Kora tem mensagem da pessoa depois do envio.
  const replied = await repliedConversations(g.tenantId,
    page.map((r) => ({ conversation_id: (r.conversation_id as string | null) ?? null, created_at: r.created_at as string })))

  const items: SubmissionItem[] = page.map((r) => {
    const def = defs.get(r.version_id as string)
    const answers = (r.answers ?? {}) as Answers
    const consent = (r.consent ?? {}) as { at?: string; marketing?: { checked?: boolean } | null }
    const source = (r.source ?? {}) as { kind?: string; page?: string | null; utm?: Record<string, string> }
    return {
      id:        r.id as string,
      createdAt: r.created_at as string,
      name:      r.contact_name as string,
      phone:     formatPhoneDisplay(r.phone_e164 as string),
      contactId: (r.contact_id as string | null) ?? null,
      answers:   def ? def.questions.filter((q) => answers[q.id] !== undefined)
        .map((q) => ({ title: q.title.trim() || "Pergunta", value: answerLabel(q, answers[q.id]) })).filter((a) => a.value) : [],
      source:    { kind: source.kind ?? "link", page: source.page ?? null, utm: source.utm ?? {} },
      consentAt: consent.at ?? null,
      marketing: consent.marketing ? !!consent.marketing.checked : null,
      outcome:   asFormOutcome(r.outcome),
      replied:   replied.has(`${r.conversation_id as string}|${r.created_at as string}`),
      conversationId: (r.conversation_id as string | null) ?? null,
      conflicts: Array.isArray(r.contact_conflicts) ? (r.contact_conflicts as unknown[]).length : 0,
    }
  })
  const last = page.at(-1)
  return {
    items,
    hasMore:    rows.length > SUBMISSIONS_PAGE,
    nextCursor: rows.length > SUBMISSIONS_PAGE && last ? { createdAt: last.created_at as string, id: last.id as string } : null,
  }
}
