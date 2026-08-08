"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) throw new Error("Sem permissão")
  return session
}

const WELCOME_TRIGGERS = ["first_ever", "after_resolved", "always"] as const
type WelcomeTrigger = typeof WELCOME_TRIGGERS[number]

interface AutomationConfigInput {
  welcome_enabled?:         boolean
  welcome_message?:         string | null
  welcome_trigger?:         WelcomeTrigger
  welcome_reopen_days?:     number
  business_hours_enabled?:  boolean
  business_hours_message?:  string | null
  business_hours_schedule?: Record<string, { start: string; end: string } | null>
  business_hours_timezone?: string
}

export async function updateAutomationConfig(data: AutomationConfigInput): Promise<{ ok: true } | { error: string }> {
  const session = await requireAdmin()

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (data.welcome_enabled         !== undefined) payload.welcome_enabled         = data.welcome_enabled
  if (data.welcome_message         !== undefined) payload.welcome_message         = data.welcome_message
  if (data.welcome_trigger         !== undefined) {
    if (!WELCOME_TRIGGERS.includes(data.welcome_trigger)) return { error: "Trigger inválido" }
    payload.welcome_trigger = data.welcome_trigger
  }
  if (data.welcome_reopen_days     !== undefined) {
    payload.welcome_reopen_days = Math.max(1, Math.min(365, data.welcome_reopen_days))
  }
  if (data.business_hours_enabled  !== undefined) payload.business_hours_enabled  = data.business_hours_enabled
  if (data.business_hours_message  !== undefined) payload.business_hours_message  = data.business_hours_message
  if (data.business_hours_schedule !== undefined) payload.business_hours_schedule = data.business_hours_schedule
  if (data.business_hours_timezone !== undefined) payload.business_hours_timezone = data.business_hours_timezone

  const { error } = await supabaseAdmin
    .from("tenant_config")
    .upsert({ tenant_id: session.user.tenantId, ...payload }, { onConflict: "tenant_id" })

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/whatsapp")
  return { ok: true }
}

export async function getAutomationConfig() {
  const session = await auth()
  if (!session?.user.tenantId) return null

  const { data } = await supabaseAdmin
    .from("tenant_config")
    .select(`
      welcome_enabled, welcome_message, welcome_trigger, welcome_reopen_days,
      business_hours_enabled, business_hours_message, business_hours_schedule, business_hours_timezone
    `)
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  return data
}
