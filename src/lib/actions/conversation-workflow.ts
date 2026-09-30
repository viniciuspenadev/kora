"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { assertConversationAccess } from "@/lib/visibility"
import { hasModule } from "@/lib/modules"
import { applyTag, removeTag } from "@/lib/actions/tags"
import { revalidatePath } from "next/cache"

/** Lazy, allow-listed dialog data. Every entry point checks conversation access. */
export async function getConversationWorkflow(conversationId: string) {
  const { scope } = await assertConversationAccess(conversationId)
  const tenantId = scope.tenantId
  const { data: conversation, error } = await supabaseAdmin.from("chat_conversations")
    .select("id, contact_id, pipeline_id, stage_id, updated_at, status, assigned_to, archived_at, is_group, stage_entered_at")
    .eq("tenant_id", tenantId).eq("id", conversationId).single()
  if (error || !conversation) throw new Error("Não foi possível carregar a conversa.")
  const kanban = await hasModule(tenantId, "kanban")
  const [contact, pipelines, stages, tags, taggings] = await Promise.all([
    conversation.contact_id ? supabaseAdmin.from("chat_contacts").select("id, custom_name, push_name, lifecycle_stage, updated_at, unfit_reason")
      .eq("tenant_id", tenantId).eq("id", conversation.contact_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    kanban ? supabaseAdmin.from("pipelines").select("id, name, color").eq("tenant_id", tenantId).eq("active", true).order("position") : Promise.resolve({ data: [], error: null }),
    kanban ? supabaseAdmin.from("pipeline_stages").select("id, pipeline_id, name, color, position, show_in_kanban, is_triage, is_won, is_lost").eq("tenant_id", tenantId).order("position") : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", tenantId).order("name"),
    conversation.contact_id ? supabaseAdmin.from("taggings").select("tag_id").eq("tenant_id", tenantId).eq("taggable_type", "contact").eq("taggable_id", conversation.contact_id) : Promise.resolve({ data: [], error: null }),
  ])
  if ([contact, pipelines, stages, tags, taggings].some(r => r.error)) throw new Error("Não foi possível carregar as opções. Tente novamente.")
  return { conversation, contact: contact.data, kanban, pipelines: pipelines.data ?? [],
    stages: (stages.data ?? []).filter(s => s.show_in_kanban || s.is_triage), tags: tags.data ?? [],
    tagIds: (taggings.data ?? []).map(t => t.tag_id as string) }
}

export async function qualifyConversationContact(conversationId: string) {
  const { scope } = await assertConversationAccess(conversationId)
  const { data: conv } = await supabaseAdmin.from("chat_conversations").select("contact_id, is_group")
    .eq("tenant_id", scope.tenantId).eq("id", conversationId).maybeSingle()
  if (!conv?.contact_id || conv.is_group) throw new Error("Esta conversa não possui um contato individual.")
  const now = new Date().toISOString()
  // Atomic predicate: a concurrent customer promotion must never be downgraded.
  const { data, error } = await supabaseAdmin.from("chat_contacts").update({ lifecycle_stage: "lead",
    lifecycle_changed_at: now, qualified_at: now, qualified_by: scope.userId, unfit_reason: null, updated_at: now })
    .eq("tenant_id", scope.tenantId).eq("id", conv.contact_id).eq("lifecycle_stage", "contact").select("id").maybeSingle()
  if (error) throw new Error("Não foi possível qualificar o contato.")
  if (!data) throw new Error("A classificação mudou ou este contato já foi qualificado. Atualize a conversa.")
  revalidatePath("/inbox"); revalidatePath("/kanban"); revalidatePath("/contatos")
  return { ok: true }
}

/** Explicit contact classification; attendance and CRM state remain independent. */
export async function classifyConversationContact(conversationId: string, input: {
  stage: "contact" | "lead" | "customer" | "unfit"; expectedUpdatedAt: string; reason?: string
}) {
  if (!input || !["contact", "lead", "customer", "unfit"].includes(input.stage) ||
      typeof input.expectedUpdatedAt !== "string" || !input.expectedUpdatedAt ||
      (input.reason !== undefined && (typeof input.reason !== "string" || input.reason.length > 500))) {
    throw new Error("Classificação inválida.")
  }
  const { scope } = await assertConversationAccess(conversationId)
  const { data: conv, error: convError } = await supabaseAdmin.from("chat_conversations")
    .select("contact_id, is_group").eq("tenant_id", scope.tenantId).eq("id", conversationId).maybeSingle()
  if (convError || !conv?.contact_id || conv.is_group) throw new Error("Conversa sem contato individual.")
  const { data: contact, error: readError } = await supabaseAdmin.from("chat_contacts")
    .select("id, lifecycle_stage, updated_at, qualified_at").eq("tenant_id", scope.tenantId).eq("id", conv.contact_id).maybeSingle()
  if (readError || !contact) throw new Error("Não foi possível consultar o contato.")
  if (contact.updated_at !== input.expectedUpdatedAt) throw new Error("A classificação mudou. Feche e abra novamente para revisar.")
  if (["customer", "won"].includes(contact.lifecycle_stage) && input.stage !== "customer") {
    throw new Error("Um Cliente não pode ser rebaixado por este menu.")
  }
  const now = new Date().toISOString()
  const { data: saved, error } = await supabaseAdmin.from("chat_contacts").update({
    lifecycle_stage: input.stage, lifecycle_changed_at: now, updated_at: now,
    unfit_reason: input.stage === "unfit" ? input.reason?.trim() || null : null,
    ...(input.stage === "lead" && !contact.qualified_at ? { qualified_at: now, qualified_by: scope.userId } : {}),
  }).eq("tenant_id", scope.tenantId).eq("id", contact.id).eq("updated_at", contact.updated_at).select("id").maybeSingle()
  if (error) throw new Error("Não foi possível salvar a classificação.")
  if (!saved) throw new Error("O contato mudou durante a operação. Atualize e tente novamente.")
  revalidatePath("/inbox"); revalidatePath("/kanban"); revalidatePath("/contatos")
  return { ok: true }
}

/** Apply only the explicit delta; never replace concurrent agents' other tags. */
export async function updateConversationContactTags(conversationId: string, add: string[], remove: string[]) {
  if (!Array.isArray(add) || !Array.isArray(remove) || add.length + remove.length > 100 ||
      [...add, ...remove].some(id => typeof id !== "string") || add.some(id => remove.includes(id))) throw new Error("Seleção de etiquetas inválida.")
  const { scope } = await assertConversationAccess(conversationId)
  const { data: conv } = await supabaseAdmin.from("chat_conversations").select("contact_id, is_group")
    .eq("tenant_id", scope.tenantId).eq("id", conversationId).maybeSingle()
  if (!conv?.contact_id || conv.is_group) throw new Error("Conversa sem contato individual.")
  // Existing tag actions enforce tenant ownership of definitions and targets.
  // Partial failure is surfaced; the dialog reloads persisted selection before retry.
  for (const id of new Set(add)) await applyTag(id, "contact", conv.contact_id)
  for (const id of new Set(remove)) await removeTag(id, "contact", conv.contact_id)
  revalidatePath("/inbox"); revalidatePath("/kanban")
}
