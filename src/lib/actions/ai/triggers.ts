"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import type { AITrigger, AITriggerInput, Condition } from "@/types/ai"

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

function sanitizeCondition(c: Condition): Condition {
  return {
    attribute: c.attribute,
    operator:  c.operator,
    value:     c.value ?? null,
  }
}

function sanitize(input: AITriggerInput): AITriggerInput {
  // Qualificação só faz sentido ao encaminhar. Mantém só regras com nível.
  const qualification =
    input.action_type === "route_to_department"
      ? (input.qualification ?? [])
          .map((q) => ({ level: q.level.trim(), tag_id: q.tag_id || null, stage_id: q.stage_id || null }))
          .filter((q) => q.level && (q.tag_id || q.stage_id))
      : []

  return {
    name:             input.name.trim(),
    priority:         Math.max(0, Math.min(9999, Math.floor(input.priority || 100))),
    active:           !!input.active,
    conditions:       (input.conditions ?? []).map(sanitizeCondition),
    context_payload:  input.context_payload ?? [],
    instruction:      input.instruction?.trim() || null,
    action_type:      input.action_type,
    action_target_id: input.action_target_id,
    qualification,
  }
}

function validate(input: AITriggerInput): string | null {
  if (!input.name) return "Dê um nome ao trigger"
  if (input.action_type === "route_to_department" && !input.action_target_id) {
    return "Quando a ação é 'rotear', escolha o departamento de destino"
  }
  return null
}

export async function listTriggers(): Promise<AITrigger[]> {
  const session = await requireMember()

  const { data, error } = await supabaseAdmin
    .from("ai_triggers")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as AITrigger[]
}

export async function getTrigger(id: string): Promise<AITrigger | null> {
  const session = await requireMember()

  const { data, error } = await supabaseAdmin
    .from("ai_triggers")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as AITrigger | null
}

export async function createTrigger(input: AITriggerInput): Promise<{ error?: string; id?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  // Se a ação é rotear, confere que o target é dept do tenant
  if (data.action_type === "route_to_department" && data.action_target_id) {
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("id", data.action_target_id)
      .eq("tenant_id", session.user.tenantId)
      .maybeSingle()
    if (!dept) return { error: "Departamento inválido" }
  }

  const { data: created, error: dbErr } = await supabaseAdmin
    .from("ai_triggers")
    .insert({
      tenant_id:        session.user.tenantId,
      name:             data.name,
      priority:         data.priority,
      active:           data.active,
      conditions:       data.conditions,
      context_payload:  data.context_payload,
      instruction:      data.instruction,
      action_type:      data.action_type,
      action_target_id: data.action_target_id,
      qualification:    data.qualification,
    })
    .select("id")
    .single()

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia")
  return { id: created.id }
}

export async function updateTrigger(
  id: string,
  input: AITriggerInput,
): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  if (data.action_type === "route_to_department" && data.action_target_id) {
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("id", data.action_target_id)
      .eq("tenant_id", session.user.tenantId)
      .maybeSingle()
    if (!dept) return { error: "Departamento inválido" }
  }

  const { error: dbErr } = await supabaseAdmin
    .from("ai_triggers")
    .update({
      name:             data.name,
      priority:         data.priority,
      active:           data.active,
      conditions:       data.conditions,
      context_payload:  data.context_payload,
      instruction:      data.instruction,
      action_type:      data.action_type,
      action_target_id: data.action_target_id,
      qualification:    data.qualification,
      updated_at:       new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia")
  revalidatePath(`/automacao/ia/triggers/${id}`)
  return {}
}

export async function deleteTrigger(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("ai_triggers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia")
  return {}
}

export async function toggleTriggerActive(
  id: string,
  active: boolean,
): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("ai_triggers")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia")
  return {}
}

/**
 * Reordena triggers — recebe ids na ordem desejada (1ª prioridade primeiro)
 * e seta `priority = index * 10` (espaço pra inserções futuras).
 */
export async function reorderTriggers(orderedIds: string[]): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabaseAdmin
        .from("ai_triggers")
        .update({ priority: idx * 10, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", session.user.tenantId),
    ),
  )

  const firstErr = results.find((r) => r.error)?.error
  if (firstErr) return { error: firstErr.message }

  revalidatePath("/automacao/ia")
  return {}
}
