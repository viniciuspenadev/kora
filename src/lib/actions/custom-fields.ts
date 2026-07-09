"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getViewerScope } from "@/lib/visibility"

// ═══════════════════════════════════════════════════════════════
// Campos personalizados UNIFICADOS (por tenant) — Contato · Negócio · Empresa · Produto
// ═══════════════════════════════════════════════════════════════
// Definições em tenant_custom_fields (discriminador `entity`, gerenciadas por
// admin/dono); valores no jsonb DE CADA entidade. Doc: docs/crm-companies-fields-design.md.
// A base era só-contato (tenant_contact_fields); generalizada mantendo os wrappers
// de contato (listContactFields/setContactCustomFields/…) pra não quebrar a ficha.

export type CustomFieldEntity = "contact" | "deal" | "company" | "product"
export type CustomFieldType = "text" | "number" | "date" | "select" | "multi" | "bool"

export interface CustomFieldDef {
  id:       string
  entity:   CustomFieldEntity
  key:      string
  label:    string
  type:     CustomFieldType
  options:  string[] | null
  position: number
  active:   boolean
}

// Onde cada entidade guarda os VALORES (coluna jsonb). Registro central.
const VALUE_STORE: Record<CustomFieldEntity, { table: string; column: string }> = {
  contact: { table: "chat_contacts",     column: "custom_fields" },
  deal:    { table: "tenant_deals",       column: "custom_fields" },
  company: { table: "tenant_companies",   column: "custom_fields" },
  product: { table: "catalog_items",      column: "attrs" },
}

function rowToDef(r: Record<string, unknown>): CustomFieldDef {
  return {
    id: r.id as string, entity: r.entity as CustomFieldEntity, key: r.key as string,
    label: r.label as string, type: r.type as CustomFieldType,
    options: (r.options as string[] | null) ?? null,
    position: (r.position as number) ?? 0, active: r.active as boolean,
  }
}

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "campo"

// ── Leitura ────────────────────────────────────────────────────────────────
/** Definições do tenant p/ uma entidade (ativas por padrão). */
export async function listCustomFields(
  entity: CustomFieldEntity,
  opts?: { includeInactive?: boolean },
): Promise<CustomFieldDef[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  let q = supabaseAdmin.from("tenant_custom_fields")
    .select("id, entity, key, label, type, options, position, active")
    .eq("tenant_id", session.user.tenantId)
    .eq("entity", entity)
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

// ── Definições (admin) ──────────────────────────────────────────────────────
export async function createCustomField(input: {
  entity: CustomFieldEntity; label: string; type: CustomFieldType; options?: string[]
}): Promise<{ id: string } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  const label = input.label.trim()
  if (!label) return { error: "Dê um nome ao campo." }
  const hasOptions = input.type === "select" || input.type === "multi"
  const options = hasOptions ? (input.options ?? []).map((o) => o.trim()).filter(Boolean) : null
  const base = slugify(label)
  // Chave única no (tenant, entity) — sufixa se colidir.
  let key = base
  for (let i = 2; i <= 50; i++) {
    const { data: clash } = await supabaseAdmin.from("tenant_custom_fields")
      .select("id").eq("tenant_id", g.tenantId).eq("entity", input.entity).eq("key", key).maybeSingle()
    if (!clash) break
    key = `${base}_${i}`
  }
  const { data: maxPos } = await supabaseAdmin.from("tenant_custom_fields")
    .select("position").eq("tenant_id", g.tenantId).eq("entity", input.entity)
    .order("position", { ascending: false }).limit(1).maybeSingle()
  const position = ((maxPos?.position as number | undefined) ?? -1) + 1
  const { data, error } = await supabaseAdmin.from("tenant_custom_fields")
    .insert({ tenant_id: g.tenantId, entity: input.entity, key, label, type: input.type, options, position })
    .select("id").single()
  if (error || !data) return { error: error?.message ?? "Falha ao criar campo" }
  return { id: (data as { id: string }).id }
}

export async function updateCustomField(
  id: string,
  patch: { label?: string; type?: CustomFieldType; options?: string[]; active?: boolean },
): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  const upd: Record<string, unknown> = {}
  if (patch.label !== undefined)   { const l = patch.label.trim(); if (!l) return { error: "Nome vazio" }; upd.label = l }
  if (patch.type !== undefined)    upd.type = patch.type
  if (patch.options !== undefined) upd.options = patch.options.map((o) => o.trim()).filter(Boolean)
  if (patch.active !== undefined)  upd.active = patch.active
  if (Object.keys(upd).length === 0) return { ok: true }
  const { error } = await supabaseAdmin.from("tenant_custom_fields").update(upd).eq("id", id).eq("tenant_id", g.tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function deleteCustomField(id: string): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  // Remove a DEFINIÇÃO; os valores já gravados no jsonb ficam (inertes).
  const { error } = await supabaseAdmin.from("tenant_custom_fields").delete().eq("id", id).eq("tenant_id", g.tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

export async function reorderCustomFields(entity: CustomFieldEntity, orderedIds: string[]): Promise<{ ok: true } | { error: string }> {
  const g = await requireAdmin(); if (!g.ok) return { error: g.error }
  await Promise.all(orderedIds.map((id, i) =>
    supabaseAdmin.from("tenant_custom_fields").update({ position: i })
      .eq("id", id).eq("tenant_id", g.tenantId).eq("entity", entity)))
  return { ok: true }
}

// ── Valores (grava no jsonb da entidade certa) ──────────────────────────────
export async function setEntityCustomFields(
  entity: CustomFieldEntity, recordId: string, values: Record<string, unknown>,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  const tenantId = session.user.tenantId
  const { table, column } = VALUE_STORE[entity]
  const { data: cur } = await supabaseAdmin.from(table).select(column).eq("id", recordId).eq("tenant_id", tenantId).maybeSingle()
  if (!cur) return { error: "Registro não encontrado" }
  const curRow = cur as unknown as Record<string, unknown>
  const merged = { ...((curRow[column] as Record<string, unknown> | null) ?? {}), ...values }
  // Limpa chaves vazias pra não inchar o jsonb.
  for (const k of Object.keys(merged)) { const v = merged[k]; if (v === "" || v === null || v === undefined) delete merged[k] }
  const { error } = await supabaseAdmin.from(table)
    .update({ [column]: merged, updated_at: new Date().toISOString() })
    .eq("id", recordId).eq("tenant_id", tenantId)
  if (error) return { error: error.message }
  return { ok: true }
}

// ═══════════════════════════════════════════════════════════════
// Wrappers de CONTATO (compat — a ficha do contato depende destes)
// ═══════════════════════════════════════════════════════════════
export type ContactFieldType = CustomFieldType
export type ContactFieldDef  = CustomFieldDef

export async function listContactFields(opts?: { includeInactive?: boolean }) {
  return listCustomFields("contact", opts)
}
export async function createContactField(input: { label: string; type: ContactFieldType; options?: string[] }) {
  return createCustomField({ entity: "contact", ...input })
}
export async function updateContactField(id: string, patch: { label?: string; type?: ContactFieldType; options?: string[]; active?: boolean }) {
  return updateCustomField(id, patch)
}
export async function deleteContactField(id: string) {
  return deleteCustomField(id)
}
export async function reorderContactFields(orderedIds: string[]) {
  return reorderCustomFields("contact", orderedIds)
}
export async function setContactCustomFields(contactId: string, values: Record<string, unknown>) {
  return setEntityCustomFields("contact", contactId, values)
}
