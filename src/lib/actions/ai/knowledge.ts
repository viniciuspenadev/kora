"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import type { AIKnowledgeItem, AIKnowledgeItemInput } from "@/types/ai"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

async function requireMember() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

function sanitize(input: AIKnowledgeItemInput): AIKnowledgeItemInput {
  return {
    title:    input.title.trim(),
    category: input.category?.trim() || null,
    content:  input.content.trim(),
  }
}

function validate(input: AIKnowledgeItemInput): string | null {
  if (!input.title)   return "Dê um título ao item"
  if (!input.content) return "O conteúdo não pode estar vazio"
  return null
}

export async function listKnowledgeItems(): Promise<AIKnowledgeItem[]> {
  const session = await requireMember()

  const { data, error } = await supabaseAdmin
    .from("ai_knowledge_items")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createKnowledgeItem(
  input: AIKnowledgeItemInput,
): Promise<{ error?: string; id?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  const { data: existing } = await supabaseAdmin
    .from("ai_knowledge_items")
    .select("position")
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = (existing?.position ?? -1) + 1

  const { data: created, error: dbErr } = await supabaseAdmin
    .from("ai_knowledge_items")
    .insert({
      tenant_id: session.user.tenantId,
      title:     data.title,
      category:  data.category,
      content:   data.content,
      position:  nextPosition,
    })
    .select("id")
    .single()

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia/conhecimento")
  return { id: created.id }
}

export async function updateKnowledgeItem(
  id: string,
  input: AIKnowledgeItemInput,
): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  const { error: dbErr } = await supabaseAdmin
    .from("ai_knowledge_items")
    .update({
      title:      data.title,
      category:   data.category,
      content:    data.content,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia/conhecimento")
  return {}
}

export async function deleteKnowledgeItem(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("ai_knowledge_items")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia/conhecimento")
  return {}
}

export async function reorderKnowledgeItems(orderedIds: string[]): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const results = await Promise.all(
    orderedIds.map((id, position) =>
      supabaseAdmin
        .from("ai_knowledge_items")
        .update({ position, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", session.user.tenantId),
    ),
  )

  const firstErr = results.find((r) => r.error)?.error
  if (firstErr) return { error: firstErr.message }

  revalidatePath("/automacao/ia/conhecimento")
  return {}
}
