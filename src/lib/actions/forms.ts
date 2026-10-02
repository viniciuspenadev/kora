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
import { requireModule } from "@/lib/modules"
import { getViewerScope, canViewForms, canManageForms } from "@/lib/visibility"
import { logAudit } from "@/lib/audit"
import { normalizeDefinition, draftProblems, type FormDefinition } from "@/lib/forms/definition"
import { isTemplateKey, templateDefinition, templateInfo } from "@/lib/forms/templates"
import { newPublicId, formSlugFrom, uniqueSlug, uniqueName, isUuid, cleanFormName } from "@/lib/forms/identity"

export type FormStatus = "draft" | "published" | "paused"

export interface FormListItem {
  id:            string
  name:          string
  status:        FormStatus
  templateKey:   string | null
  questionCount: number
  updatedAt:     string
}

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
}

/** Teto do rascunho no app (o banco segura 256 KB; aqui recusa antes, com mensagem clara). */
const DRAFT_MAX_CHARS = 200_000

type Gate = { tenantId: string; userId: string; canManage: boolean } | { error: string }

async function gate(level: "view" | "manage"): Promise<Gate> {
  let scope: Awaited<ReturnType<typeof getViewerScope>>
  try { scope = await getViewerScope() } catch { return { error: "Não autenticado." } }
  try { await requireModule("forms") } catch { return { error: "O módulo Formulários não está habilitado para esta empresa." } }
  const canManage = canManageForms(scope)
  if (level === "manage" ? !canManage : !canViewForms(scope)) {
    return { error: level === "manage" ? "Sem permissão para gerenciar formulários." : "Sem acesso a formulários." }
  }
  return { tenantId: scope.tenantId, userId: scope.userId, canManage }
}

const asStatus = (v: unknown): FormStatus => (v === "published" || v === "paused" ? v : "draft")

async function takenNamesAndSlugs(tenantId: string, exceptId?: string): Promise<{ names: string[]; slugs: string[] } | { error: string }> {
  const { data, error } = await supabaseAdmin.from("forms").select("id, name, slug").eq("tenant_id", tenantId)
  if (error) return { error: "Não foi possível consultar os formulários." }
  const rows = ((data ?? []) as { id: string; name: string; slug: string }[]).filter((r) => r.id !== exceptId)
  return { names: rows.map((r) => r.name), slugs: rows.map((r) => r.slug) }
}

// ── Leitura ──────────────────────────────────────────────────────
export async function listForms(): Promise<{ items: FormListItem[]; canManage: boolean } | { error: string }> {
  const g = await gate("view")
  if ("error" in g) return g
  const { data, error } = await supabaseAdmin.from("forms")
    .select("id, name, status, template_key, updated_at, questions:draft->questions")
    .eq("tenant_id", g.tenantId).is("archived_at", null)
    .order("updated_at", { ascending: false }).order("id", { ascending: false })
    .limit(200)
  if (error) return { error: "Não foi possível carregar os formulários." }
  const items = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const qs = r.questions ?? (r.draft as { questions?: unknown } | undefined)?.questions
    return {
      id:            r.id as string,
      name:          r.name as string,
      status:        asStatus(r.status),
      templateKey:   (r.template_key as string | null) ?? null,
      questionCount: Array.isArray(qs) ? qs.length : 0,
      updatedAt:     r.updated_at as string,
    }
  })
  return { items, canManage: g.canManage }
}

export async function getForm(id: string): Promise<FormDetail | { error: string }> {
  const g = await gate("view")
  if ("error" in g) return g
  if (!isUuid(id)) return { error: "Formulário não encontrado." }
  const { data, error } = await supabaseAdmin.from("forms")
    .select("id, name, status, slug, public_id, template_key, draft, draft_revision, updated_at")
    .eq("tenant_id", g.tenantId).eq("id", id).is("archived_at", null).maybeSingle()
  if (error) return { error: "Não foi possível carregar o formulário." }
  if (!data) return { error: "Formulário não encontrado." }
  const r = data as Record<string, unknown>
  return {
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
