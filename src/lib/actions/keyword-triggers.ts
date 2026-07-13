"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

export type MatchType = "exact" | "contains" | "starts_with"

export interface KeywordTriggerInput {
  name:                string
  patterns:            string[]
  match_type:          MatchType
  case_sensitive:      boolean
  response_text:       string | null
  apply_tag_id:        string | null
  cooldown_min:        number
  enabled:             boolean
  pause_when_assigned: boolean
}

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

function sanitize(input: KeywordTriggerInput): KeywordTriggerInput {
  return {
    ...input,
    name:        input.name.trim(),
    patterns:    input.patterns.map((p) => p.trim()).filter(Boolean),
    response_text: input.response_text?.trim() || null,
    cooldown_min: Math.max(0, Math.min(1440, Math.floor(input.cooldown_min || 0))),
  }
}

function validate(input: KeywordTriggerInput): string | null {
  if (!input.name) return "Dê um nome ao gatilho"
  if (input.patterns.length === 0) return "Adicione pelo menos uma palavra-chave"
  if (!input.response_text && !input.apply_tag_id) {
    return "Configure pelo menos uma ação: responder com texto ou aplicar tag"
  }
  return null
}

export async function createKeywordTrigger(input: KeywordTriggerInput): Promise<{ error?: string; id?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  // Próximo position = max + 1
  const { data: existing } = await supabaseAdmin
    .from("keyword_triggers")
    .select("position")
    .eq("tenant_id", session.user.tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = (existing?.position ?? -1) + 1

  const { data: created, error: dbErr } = await supabaseAdmin
    .from("keyword_triggers")
    .insert({
      tenant_id:           session.user.tenantId,
      name:                data.name,
      patterns:            data.patterns,
      match_type:          data.match_type,
      case_sensitive:      data.case_sensitive,
      response_text:       data.response_text,
      apply_tag_id:        data.apply_tag_id,
      cooldown_min:        data.cooldown_min,
      enabled:             data.enabled,
      pause_when_assigned: data.pause_when_assigned,
      position:            nextPosition,
      created_by:          session.user.id,
    })
    .select("id")
    .single()

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/palavras-chave")
  return { id: created.id }
}

export async function updateKeywordTrigger(id: string, input: KeywordTriggerInput): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  const { error: dbErr } = await supabaseAdmin
    .from("keyword_triggers")
    .update({
      name:                data.name,
      patterns:            data.patterns,
      match_type:          data.match_type,
      case_sensitive:      data.case_sensitive,
      response_text:       data.response_text,
      apply_tag_id:        data.apply_tag_id,
      cooldown_min:        data.cooldown_min,
      enabled:             data.enabled,
      pause_when_assigned: data.pause_when_assigned,
      updated_at:          new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/palavras-chave")
  return {}
}

export async function toggleKeywordTrigger(id: string, enabled: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("keyword_triggers")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/palavras-chave")
  return {}
}

export async function deleteKeywordTrigger(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("keyword_triggers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/palavras-chave")
  return {}
}

/**
 * Reordena triggers — recebe array de ids na ordem desejada e atualiza `position`.
 */
export async function reorderKeywordTriggers(orderedIds: string[]): Promise<{ error?: string }> {
  const session = await requireAdmin()

  // Atualiza em paralelo cada trigger com seu novo position
  const results = await Promise.all(
    orderedIds.map((id, position) =>
      supabaseAdmin
        .from("keyword_triggers")
        .update({ position, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", session.user.tenantId)
    )
  )

  const firstErr = results.find((r) => r.error)?.error
  if (firstErr) return { error: firstErr.message }

  revalidatePath("/automacao/palavras-chave")
  return {}
}
