"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { sanitizeRules, matchesSegment, type SegmentRules, type SegmentContact } from "@/lib/crm/segment-rules"

// ─────────────────────────────────────────────────────────────────
// Listas de contatos — segmentos SALVOS (docs/crm-vision-capture.md, F5b).
// `kind`: static (curadoria manual) | dynamic (regras que se reavaliam na
// leitura — sempre atual, sem membros materializados).
// Governança (criar/editar/excluir) = owner/admin; adicionar/remover MEMBRO
// (só estática) = qualquer membro do tenant (mesmo modelo das tags).
// ─────────────────────────────────────────────────────────────────

export type ListKind = "static" | "dynamic"

export interface ContactList {
  id:          string
  name:        string
  description: string | null
  kind:        ListKind
  rules:       SegmentRules | null
  created_at:  string
  /** Nº de contatos — estática: membros; dinâmica: avaliação das regras. */
  members:     number
}

/** Contatos em forma enxuta pro avaliador de segmento (server-side). */
async function leanContacts(t: string): Promise<SegmentContact[]> {
  const [{ data: cs }, { data: tg }, { data: won }] = await Promise.all([
    supabaseAdmin.from("chat_contacts").select("id, lifecycle_stage, created_at").eq("tenant_id", t).limit(5000),
    supabaseAdmin.from("taggings").select("tag_id, taggable_id").eq("tenant_id", t).eq("taggable_type", "contact"),
    supabaseAdmin.from("tenant_deals").select("contact_id, won_at").eq("tenant_id", t).eq("status", "won").not("won_at", "is", null).limit(5000),
  ])
  const tagsBy = new Map<string, string[]>()
  for (const x of (tg ?? []) as { tag_id: string; taggable_id: string }[]) {
    const arr = tagsBy.get(x.taggable_id) ?? []
    arr.push(x.tag_id); tagsBy.set(x.taggable_id, arr)
  }
  const lastWon = new Map<string, string>()
  for (const w of (won ?? []) as { contact_id: string | null; won_at: string }[]) {
    if (!w.contact_id) continue
    const cur = lastWon.get(w.contact_id)
    if (!cur || w.won_at > cur) lastWon.set(w.contact_id, w.won_at)
  }
  const now = Date.now()
  return ((cs ?? []) as { id: string; lifecycle_stage: string | null; created_at: string }[]).map((c) => {
    const last = lastWon.get(c.id)
    return {
      lifecycle_stage: c.lifecycle_stage,
      tag_ids: tagsBy.get(c.id) ?? [],
      created_at: c.created_at,
      ultima_dias: last ? Math.max(0, Math.floor((now - new Date(last).getTime()) / 86_400_000)) : null,
    }
  })
}

async function requireMember() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

async function requireManager(): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  return { tenantId: session.user.tenantId, userId: session.user.id }
}

/** Todas as listas do tenant com contagem (estática = membros; dinâmica = avaliada). */
export async function getLists(): Promise<ContactList[]> {
  const session = await requireMember()
  const t = session.user.tenantId
  const [{ data: lists }, { data: members }] = await Promise.all([
    supabaseAdmin.from("contact_lists")
      .select("id, name, description, kind, rules, created_at")
      .eq("tenant_id", t).order("created_at", { ascending: false }),
    supabaseAdmin.from("contact_list_members").select("list_id").eq("tenant_id", t),
  ])
  const counts = new Map<string, number>()
  for (const m of (members ?? []) as { list_id: string }[])
    counts.set(m.list_id, (counts.get(m.list_id) ?? 0) + 1)

  const rows = ((lists ?? []) as (Omit<ContactList, "members" | "kind" | "rules"> & { kind: ListKind | null; rules: SegmentRules | null })[])
    .map((l) => ({ ...l, kind: (l.kind ?? "static") as ListKind, rules: l.rules ?? null }))

  // Dinâmicas: avalia as regras UMA vez sobre os contatos enxutos.
  if (rows.some((l) => l.kind === "dynamic" && l.rules)) {
    const cs = await leanContacts(t)
    for (const l of rows) {
      if (l.kind !== "dynamic" || !l.rules) continue
      counts.set(l.id, cs.filter((c) => matchesSegment(c, l.rules as SegmentRules)).length)
    }
  }

  return rows.map((l) => ({ ...l, members: counts.get(l.id) ?? 0 }))
}

export async function createList(
  name: string, description?: string | null,
  kind: ListKind = "static", rules?: unknown,
): Promise<{ id: string } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const clean = name.trim()
  if (!clean) return { error: "Nome da lista é obrigatório" }
  if (clean.length > 60) return { error: "Nome muito longo (máx. 60)" }

  let safeRules: SegmentRules | null = null
  if (kind === "dynamic") {
    const r = sanitizeRules(rules)
    if ("error" in r) return r
    safeRules = r
  }

  const { data, error } = await supabaseAdmin.from("contact_lists")
    .insert({ tenant_id: gate.tenantId, name: clean, description: description?.trim() || null, kind, rules: safeRules, created_by: gate.userId })
    .select("id").single()
  if (error) return { error: error.message.includes("uq_contact_lists") || error.message.includes("duplicate") ? "Já existe uma lista com esse nome" : error.message }
  revalidatePath("/configuracoes/listas")
  return { id: (data as { id: string }).id }
}

export async function updateList(
  id: string,
  patch: { name?: string; description?: string | null; rules?: unknown },
): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const upd: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) {
    const clean = patch.name.trim()
    if (!clean) return { error: "Nome da lista é obrigatório" }
    upd.name = clean
  }
  if (patch.description !== undefined) upd.description = patch.description?.trim() || null
  if (patch.rules !== undefined) {
    // Só lista dinâmica tem regras — valida o tipo no banco (fail-closed).
    const { data: cur } = await supabaseAdmin.from("contact_lists").select("kind").eq("id", id).eq("tenant_id", gate.tenantId).maybeSingle()
    if ((cur as { kind: string | null } | null)?.kind !== "dynamic") return { error: "Só listas dinâmicas têm regras" }
    const r = sanitizeRules(patch.rules)
    if ("error" in r) return r
    upd.rules = r
  }

  const { error } = await supabaseAdmin.from("contact_lists")
    .update(upd).eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message.includes("duplicate") ? "Já existe uma lista com esse nome" : error.message }
  revalidatePath("/configuracoes/listas")
  return { ok: true }
}

export async function deleteList(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { error } = await supabaseAdmin.from("contact_lists")
    .delete().eq("id", id).eq("tenant_id", gate.tenantId)   // membros caem por CASCADE
  if (error) return { error: error.message }
  revalidatePath("/configuracoes/listas")
  revalidatePath("/contatos")
  return { ok: true }
}

/**
 * Adiciona VÁRIOS contatos a uma lista (seleção em massa do roster). Anti-IDOR:
 * valida a lista E filtra os contatos pro tenant. Idempotente (pula quem já está).
 */
export async function addContactsToList(listId: string, contactIds: string[]): Promise<{ added: number }> {
  const session = await requireMember()
  const t = session.user.tenantId
  const wanted = Array.from(new Set(contactIds)).slice(0, 500)
  if (wanted.length === 0) return { added: 0 }

  const [listRow, owned, existing] = await Promise.all([
    supabaseAdmin.from("contact_lists").select("id, kind").eq("id", listId).eq("tenant_id", t).maybeSingle(),
    supabaseAdmin.from("chat_contacts").select("id").eq("tenant_id", t).in("id", wanted),
    supabaseAdmin.from("contact_list_members").select("contact_id")
      .eq("tenant_id", t).eq("list_id", listId).in("contact_id", wanted),
  ])
  if (!listRow.data) throw new Error("Lista não encontrada.")
  if ((listRow.data as { kind: string | null }).kind === "dynamic") throw new Error("Lista dinâmica se atualiza sozinha pelas regras — não recebe membros manuais.")

  const has = new Set(((existing.data ?? []) as { contact_id: string }[]).map((r) => r.contact_id))
  const ids = ((owned.data ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !has.has(id))
  if (ids.length === 0) return { added: 0 }

  const { error } = await supabaseAdmin.from("contact_list_members").insert(ids.map((id) => ({
    tenant_id: t, list_id: listId, contact_id: id, added_by: session.user.id,
  })))
  if (error && !error.message.includes("duplicate")) throw new Error(error.message)

  revalidatePath("/contatos")
  revalidatePath("/configuracoes/listas")
  return { added: ids.length }
}

export async function removeContactFromList(listId: string, contactId: string): Promise<{ ok: true }> {
  const session = await requireMember()
  const { error } = await supabaseAdmin.from("contact_list_members")
    .delete().eq("tenant_id", session.user.tenantId).eq("list_id", listId).eq("contact_id", contactId)
  if (error) throw new Error(error.message)
  revalidatePath("/contatos")
  revalidatePath("/configuracoes/listas")
  return { ok: true }
}
