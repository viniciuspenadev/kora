"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — actions da base de conhecimento (RAG)
// ═══════════════════════════════════════════════════════════════
// Salvar/editar re-indexa (chunk + embeddings) automaticamente. Falha de
// embedding NÃO bloqueia o save — o item fica salvo (a busca keyword cobre).

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { reindexKnowledge } from "@/lib/ai-v2/rag"
import type { StudioKnowledgeItem } from "@/types/studio"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

export async function listKnowledge(): Promise<StudioKnowledgeItem[]> {
  const session = await requireAdmin()
  const { data, error } = await supabaseAdmin
    .from("studio_knowledge")
    .select("id, title, source, content, updated_at")
    .eq("tenant_id", session.user.tenantId)
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as StudioKnowledgeItem[]
}

async function reindexSafe(tenantId: string, id: string, content: string) {
  try {
    await reindexKnowledge(tenantId, id, content)
  } catch (e) {
    console.error("[studio/knowledge] reindex falhou (item salvo, busca keyword segue):", e instanceof Error ? e.message : e)
  }
}

export async function createKnowledge(input: { title: string; content: string; source?: string }): Promise<{ id?: string; error?: string }> {
  const session = await requireAdmin()
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) return { error: "Título e conteúdo são obrigatórios." }

  const { data, error } = await supabaseAdmin
    .from("studio_knowledge")
    .insert({ tenant_id: session.user.tenantId, title, content, source: input.source ?? "manual" })
    .select("id")
    .maybeSingle()
  if (error) return { error: error.message }

  if (data?.id) await reindexSafe(session.user.tenantId, data.id, content)
  revalidatePath("/studio/conhecimento")
  revalidatePath("/studio")
  return { id: data?.id }
}

export async function updateKnowledge(id: string, input: { title: string; content: string }): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const title = input.title.trim()
  const content = input.content.trim()
  if (!title || !content) return { error: "Título e conteúdo são obrigatórios." }

  const { error } = await supabaseAdmin
    .from("studio_knowledge")
    .update({ title, content, updated_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }

  await reindexSafe(session.user.tenantId, id, content)
  revalidatePath("/studio/conhecimento")
  return {}
}

export async function deleteKnowledge(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()
  // chunks somem por FK ON DELETE CASCADE.
  const { error } = await supabaseAdmin
    .from("studio_knowledge")
    .delete()
    .eq("tenant_id", session.user.tenantId)
    .eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/studio/conhecimento")
  revalidatePath("/studio")
  return {}
}
