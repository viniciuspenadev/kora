"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

type TaggableType = "contact" | "conversation"

async function requireSession() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

// ── CRUD de Tags ───────────────────────────────────────────────

export async function createTag(name: string, color: string, description?: string) {
  const session = await requireSession()

  const { data, error } = await supabaseAdmin
    .from("tags")
    .insert({
      tenant_id:   session.user.tenantId,
      name:        name.trim(),
      color:       color.startsWith("#") ? color : `#${color}`,
      description: description?.trim() || null,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)
  revalidatePath("/inbox")
  revalidatePath("/contatos")
  return data
}

export async function updateTag(id: string, data: { name?: string; color?: string; description?: string | null }) {
  const session = await requireSession()
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (data.name        !== undefined) payload.name        = data.name.trim()
  if (data.color       !== undefined) payload.color       = data.color
  if (data.description !== undefined) payload.description = data.description

  const { error } = await supabaseAdmin
    .from("tags")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) throw new Error(error.message)
  revalidatePath("/inbox")
  revalidatePath("/contatos")
}

export async function deleteTag(id: string) {
  const session = await requireSession()

  const { error } = await supabaseAdmin
    .from("tags")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) throw new Error(error.message)
  revalidatePath("/inbox")
  revalidatePath("/contatos")
}

// ── Aplicar/Remover tag em entidade ────────────────────────────

export async function applyTag(tagId: string, taggableType: TaggableType, taggableId: string) {
  const session = await requireSession()
  const tenantId = session.user.tenantId

  // Defense-in-depth: a tag E o alvo (contato/conversa) devem pertencer ao tenant
  // do chamador — senão dava pra etiquetar item de outro tenant via ID adivinhado.
  const targetTable = taggableType === "contact" ? "chat_contacts" : "chat_conversations"
  const [tagRow, targetRow] = await Promise.all([
    supabaseAdmin.from("tags").select("id").eq("id", tagId).eq("tenant_id", tenantId).maybeSingle(),
    supabaseAdmin.from(targetTable).select("id").eq("id", taggableId).eq("tenant_id", tenantId).maybeSingle(),
  ])
  if (!tagRow.data)    throw new Error("Tag não encontrada.")
  if (!targetRow.data) throw new Error("Item não encontrado.")

  const { error } = await supabaseAdmin
    .from("taggings")
    .insert({
      tag_id:        tagId,
      tenant_id:     tenantId,
      taggable_type: taggableType,
      taggable_id:   taggableId,
      tagged_by:     session.user.id,
    })

  // Ignora duplicate key (já tagueado)
  if (error && !error.message.includes("duplicate")) throw new Error(error.message)

  revalidatePath("/contatos")
  revalidatePath("/inbox")
}

export async function removeTag(tagId: string, taggableType: TaggableType, taggableId: string) {
  const session = await requireSession()

  const { error } = await supabaseAdmin
    .from("taggings")
    .delete()
    .eq("tag_id", tagId)
    .eq("tenant_id", session.user.tenantId)
    .eq("taggable_type", taggableType)
    .eq("taggable_id", taggableId)

  if (error) throw new Error(error.message)
  revalidatePath("/contatos")
  revalidatePath("/inbox")
}
