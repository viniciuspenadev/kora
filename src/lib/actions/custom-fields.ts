"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Campos personalizados do contato (por tenant) — Cadastro F3
// ═══════════════════════════════════════════════════════════════
// Definições em tenant_contact_fields (gerenciadas por admin/dono); valores em
// chat_contacts.custom_fields (jsonb). Horizontal: cada segmento cria os seus.

export type ContactFieldType = "text" | "number" | "date" | "select" | "bool"

export interface ContactFieldDef {
  id:       string
  key:      string
  label:    string
  type:     ContactFieldType
  options:  string[] | null
  position: number
  active:   boolean
}

function rowToDef(r: Record<string, unknown>): ContactFieldDef {
  return {
    id: r.id as string, key: r.key as string, label: r.label as string,
    type: r.type as ContactFieldType, options: (r.options as string[] | null) ?? null,
    position: (r.position as number) ?? 0, active: r.active as boolean,
  }
}

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "campo"

/** Definições do tenant (ativas por padrão). Pra o cadastro e a tela de Configurações. */
export async function listContactFields(opts?: { includeInactive?: boolean }): Promise<ContactFieldDef[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  let q = supabaseAdmin.from("tenant_contact_fields")
    .select("id, key, label, type, options, position, active")
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: true }).order("created_at", { ascending: true })
  if (!opts?.includeInactive) q = q.eq("active", true)
  const { data } = await q
  return ((data ?? []) as Record<string, unknown>[]).map(rowToDef)
}

async function requireAdmin(): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  const scope = await getViewerScope()
  if (!scope.tenantId) return { ok: false, error: "Não autenticado" }
  if (!scope.isAdmin) return { ok: false, error: "Só admin ou dono gerencia os campos do cadastro." }
  return { ok: true, tenantId: scope.tenantId }
}

export async function createContactField(input: { label: string; type: ContactFieldType; options?: string[] }): Promise<{ id: string } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  const label = input.label.trim()
  if (!label) return { error: "Dê um nome ao campo." }
  const options = input.type === "select" ? (input.options ?? []).map((o) => o.trim()).filter(Boolean) : null
  const base = slugify(label)
  // Garante chave única no tenant (sufixa se colidir).
  let key = base
  for (let i = 2; i <= 50; i++) {
    const { data: clash } = await supabaseAdmin.from("tenant_contact_fields").select("id").eq("tenant_id", g.tenantId).eq("key", key).maybeSingle()
    if (!clash) break
    key = `${base}_${i}`
  }
  const { data: maxPos } = await supabaseAdmin.from("tenant_contact_fields").select("position").eq("tenant_id", g.tenantId).order("position", { ascending: false }).limit(1).maybeSingle()
  const position = ((maxPos?.position as number | undefined) ?? -1) + 1
  const { data, error } = await supabaseAdmin.from("tenant_contact_fields")
    .insert({ tenant_id: g.tenantId, key, label, type: input.type, options, position })
    .select("id").single()
  if (error || !data) return { error: error?.message ?? "Falha ao criar campo" }
  return { id: (data as { id: string }).id }
}

export async function updateContactField(id: string, patch: { label?: string; type?: ContactFieldType; options?: string[]; active?: boolean }): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  const upd: Record<string, unknown> = {}
  if (patch.label !== undefined)  { const l = patch.label.trim(); if (!l) return { error: "Nome vazio" }; upd.label = l }
  if (patch.type !== undefined)   upd.type = patch.type
  if (patch.options !== undefined) upd.options = patch.options.map((o) => o.trim()).filter(Boolean)
  if (patch.active !== undefined) upd.active = patch.active
  if (patch.type === "select" && patch.options === undefined) { /* mantém options */ }
  if (Object.keys(upd).length === 0) return { ok: true }
  const { error } = await supabaseAdmin.from("tenant_contact_fields").update(upd).eq("id", id).eq("tenant_id", g.tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function deleteContactField(id: string): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  // Remove a DEFINIÇÃO; os valores já gravados em custom_fields ficam (inertes).
  const { error } = await supabaseAdmin.from("tenant_contact_fields").delete().eq("id", id).eq("tenant_id", g.tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function reorderContactFields(orderedIds: string[]): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  await Promise.all(orderedIds.map((id, i) =>
    supabaseAdmin.from("tenant_contact_fields").update({ position: i }).eq("id", id).eq("tenant_id", g.tenantId)))
  return { ok: true }
}

/** Grava os VALORES dos campos personalizados num contato (merge no jsonb). */
export async function setContactCustomFields(contactId: string, values: Record<string, unknown>): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const tenantId = session.user.tenantId
  const { data: cur } = await supabaseAdmin.from("chat_contacts").select("custom_fields").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle()
  if (!cur) return { error: "Contato não encontrado" }
  const merged = { ...((cur.custom_fields as Record<string, unknown> | null) ?? {}), ...values }
  // Limpa chaves vazias pra não inchar o jsonb.
  for (const k of Object.keys(merged)) { const v = merged[k]; if (v === "" || v === null || v === undefined) delete merged[k] }
  const { error } = await supabaseAdmin.from("chat_contacts").update({ custom_fields: merged, updated_at: new Date().toISOString() }).eq("id", contactId).eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}
