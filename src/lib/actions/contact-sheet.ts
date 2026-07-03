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
  tags:     { id: string; name: string; color: string }[]
}

export async function getContactSheet(contactId: string): Promise<ContactSheetData | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const t = session.user.tenantId

  const [record, activity, tagRes] = await Promise.all([
    getContactRecord(contactId),
    getContactActivity(contactId),
    supabaseAdmin.from("taggings").select("tag_id")
      .eq("tenant_id", t).eq("taggable_type", "contact").eq("taggable_id", contactId),
  ])
  if ("error" in record) return record

  let tags: ContactSheetData["tags"] = []
  const tagIds = ((tagRes.data ?? []) as { tag_id: string }[]).map((r) => r.tag_id)
  if (tagIds.length) {
    const { data } = await supabaseAdmin.from("tags")
      .select("id, name, color").eq("tenant_id", t).in("id", tagIds).order("name")
    tags = (data ?? []) as ContactSheetData["tags"]
  }

  return { record, activity, tags }
}
