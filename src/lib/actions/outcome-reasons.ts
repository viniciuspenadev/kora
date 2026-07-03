"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { requireModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"

// ─────────────────────────────────────────────────────────────────
// Motivos de desfecho GOVERNADOS (docs/crm-vision-capture.md, tela 3).
// Config = owner/admin + crm. O negócio grava o LABEL como texto (snapshot):
// excluir do catálogo não corrompe histórico.
// ─────────────────────────────────────────────────────────────────

export type ReasonKind = "lost" | "won"

export interface OutcomeReason {
  id:           string
  kind:         ReasonKind
  label:        string
  require_note: boolean
  active:       boolean
  created_at:   string
}

async function requireManager(): Promise<{ tenantId: string } | { error: string }> {
  const session = await auth()
  if (!session?.user?.tenantId) return { error: "Não autenticado" }
  if (!["owner", "admin"].includes(session.user.role)) return { error: "Sem permissão" }
  try { await requireModule("crm") } catch { return { error: "Módulo CRM não habilitado" } }
  return { tenantId: session.user.tenantId }
}

/** Lista completa pro painel de config (ativos + inativos), mais recentes primeiro. */
export async function getOutcomeReasons(kind: ReasonKind = "lost"): Promise<OutcomeReason[]> {
  const gate = await requireManager()
  if ("error" in gate) return []
  const { data } = await supabaseAdmin.from("deal_outcome_reasons")
    .select("id, kind, label, require_note, active, created_at")
    .eq("tenant_id", gate.tenantId).eq("kind", kind)
    .order("created_at", { ascending: false })
  return ((data ?? []) as OutcomeReason[])
}

export async function createOutcomeReason(kind: ReasonKind, label: string, requireNote: boolean): Promise<{ id: string } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const clean = label.trim()
  if (!clean) return { error: "Nome do motivo é obrigatório" }
  if (clean.length > 80) return { error: "Motivo muito longo (máx. 80)" }

  const { data, error } = await supabaseAdmin.from("deal_outcome_reasons")
    .insert({ tenant_id: gate.tenantId, kind, label: clean, require_note: requireNote })
    .select("id").single()
  if (error) return { error: error.message.includes("uq_deal_outcome_reasons") || error.message.includes("duplicate") ? "Já existe um motivo com esse nome" : error.message }
  revalidatePath("/configuracoes/motivos")
  return { id: (data as { id: string }).id }
}

export async function updateOutcomeReason(id: string, patch: { label?: string; requireNote?: boolean }): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const upd: Record<string, unknown> = {}
  if (patch.label !== undefined) {
    const clean = patch.label.trim()
    if (!clean) return { error: "Nome do motivo é obrigatório" }
    upd.label = clean
  }
  if (patch.requireNote !== undefined) upd.require_note = patch.requireNote
  if (Object.keys(upd).length === 0) return { ok: true }

  const { error } = await supabaseAdmin.from("deal_outcome_reasons")
    .update(upd).eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message.includes("duplicate") ? "Já existe um motivo com esse nome" : error.message }
  revalidatePath("/configuracoes/motivos")
  return { ok: true }
}

export async function deleteOutcomeReason(id: string): Promise<{ ok: true } | { error: string }> {
  const gate = await requireManager()
  if ("error" in gate) return gate
  const { error } = await supabaseAdmin.from("deal_outcome_reasons")
    .delete().eq("id", id).eq("tenant_id", gate.tenantId)
  if (error) return { error: error.message }
  revalidatePath("/configuracoes/motivos")
  return { ok: true }
}
