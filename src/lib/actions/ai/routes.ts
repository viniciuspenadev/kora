"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import type { AIRoute, AIRouteInput, AIRouteRequiredField } from "@/types/ai"

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

function sanitizeField(f: AIRouteRequiredField): AIRouteRequiredField {
  return {
    key:   f.key.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, ""),
    label: f.label.trim(),
    type:  f.type,
  }
}

function sanitize(input: AIRouteInput): AIRouteInput {
  return {
    department_id:    input.department_id,
    when_description: input.when_description.trim(),
    required_fields:  (input.required_fields ?? []).map(sanitizeField).filter((f) => f.key && f.label),
    handoff_message:  input.handoff_message?.trim() || null,
  }
}

function validate(input: AIRouteInput): string | null {
  if (!input.department_id)    return "Selecione um departamento"
  if (!input.when_description) return "Diga em que situação a IA deve usar essa rota"
  return null
}

export async function listRoutes(): Promise<AIRoute[]> {
  const session = await requireMember()

  const { data, error } = await supabaseAdmin
    .from("ai_routes")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as AIRoute[]
}

/**
 * Cria ou atualiza a rota do tenant pra um department.
 * UNIQUE(tenant_id, department_id) — não dá pra ter 2 rotas pro mesmo dept.
 */
export async function upsertRoute(input: AIRouteInput): Promise<{ error?: string; id?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)
  const err     = validate(data)
  if (err) return { error: err }

  // Confere que o departamento é do tenant (defesa em profundidade)
  const { data: dept } = await supabaseAdmin
    .from("tenant_departments")
    .select("id")
    .eq("id", data.department_id)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()
  if (!dept) return { error: "Departamento inválido" }

  const { data: row, error: dbErr } = await supabaseAdmin
    .from("ai_routes")
    .upsert(
      {
        tenant_id:        session.user.tenantId,
        department_id:    data.department_id,
        when_description: data.when_description,
        required_fields:  data.required_fields,
        handoff_message:  data.handoff_message,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: "tenant_id,department_id" },
    )
    .select("id")
    .single()

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia/rotas")
  return { id: row.id }
}

export async function deleteRoute(id: string): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("ai_routes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia/rotas")
  return {}
}
