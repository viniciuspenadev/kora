"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getContactRecord, getContactActivity, type ContactRecord, type ActivityItem } from "./deals"

// ─────────────────────────────────────────────────────────────────
// Contato 360 em SHEET (docs/crm-vision-capture.md, tela 4 da referência).
// Compõe as fontes que JÁ existem (prontuário + timeline unificada) + tags,
// em 1 roundtrip — o sheet abre do board de Negócios (e de onde mais plugar).
// ─────────────────────────────────────────────────────────────────

export interface ContactSheetData {
  record:   ContactRecord
  activity: ActivityItem[]
  /** Tags DO contato (aplicadas). */
  tags:     { id: string; name: string; color: string }[]
  /** Catálogo de tags do tenant — pro "+" adicionar direto no sheet. */
  allTags:  { id: string; name: string; color: string }[]
  /** Listas ESTÁTICAS do tenant — pro "+ Adicionar listas" (referência). */
  lists:    { id: string; name: string }[]
  /** Ids das listas de que o contato é membro. */
  memberListIds: string[]
}

export async function getContactSheet(contactId: string): Promise<ContactSheetData | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const t = session.user.tenantId

  const [record, activity, tagRes, allTagRes, listRes, memberRes] = await Promise.all([
    getContactRecord(contactId),
    getContactActivity(contactId),
    supabaseAdmin.from("taggings").select("tag_id")
      .eq("tenant_id", t).eq("taggable_type", "contact").eq("taggable_id", contactId),
    supabaseAdmin.from("tags").select("id, name, color").eq("tenant_id", t).order("name"),
    // Só estáticas: dinâmica não recebe membro manual (regra do F5c).
    supabaseAdmin.from("contact_lists").select("id, name").eq("tenant_id", t).eq("kind", "static").order("name"),
    supabaseAdmin.from("contact_list_members").select("list_id").eq("tenant_id", t).eq("contact_id", contactId),
  ])
  if ("error" in record) return record

  const allTags = ((allTagRes.data ?? []) as ContactSheetData["allTags"])
  const applied = new Set(((tagRes.data ?? []) as { tag_id: string }[]).map((r) => r.tag_id))
  const tags = allTags.filter((tg) => applied.has(tg.id))

  return {
    record, activity, tags, allTags,
    lists: ((listRes.data ?? []) as ContactSheetData["lists"]),
    memberListIds: ((memberRes.data ?? []) as { list_id: string }[]).map((m) => m.list_id),
  }
}
