"use server"

// ═══════════════════════════════════════════════════════════════
// Kora Studio (IA v2) — actions de config/persona
// ═══════════════════════════════════════════════════════════════
// Espelha o padrão do v1 (ai/config.ts), alvo studio_config. owner/admin
// edita; qualquer membro lê. supabaseAdmin (service role) — RLS bypassed
// no servidor; o gate de papel é explícito aqui.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import type { StudioConfig, StudioConfigInput } from "@/types/studio"

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

export async function getStudioConfig(): Promise<StudioConfig | null> {
  const session = await requireMember()
  const { data, error } = await supabaseAdmin
    .from("studio_config")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

function sanitize(input: StudioConfigInput): StudioConfigInput {
  return {
    ai_enabled:               !!input.ai_enabled,
    ai_name:                  input.ai_name?.trim() || null,
    ai_tone:                  input.ai_tone,
    ai_language:              input.ai_language?.trim() || "pt-BR",
    identity_text:            input.identity_text?.trim() || null,
    communication_style_text: input.communication_style_text?.trim() || null,
    anti_patterns_text:       input.anti_patterns_text?.trim() || null,
  }
}

export async function updateStudioConfig(input: StudioConfigInput): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)

  const { error: dbErr } = await supabaseAdmin
    .from("studio_config")
    .upsert(
      {
        tenant_id:                session.user.tenantId,
        ai_enabled:               data.ai_enabled,
        ai_name:                  data.ai_name,
        ai_tone:                  data.ai_tone,
        ai_language:              data.ai_language,
        identity_text:            data.identity_text,
        communication_style_text: data.communication_style_text,
        anti_patterns_text:       data.anti_patterns_text,
        updated_at:               new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    )

  if (dbErr) return { error: dbErr.message }
  revalidatePath("/studio")
  revalidatePath("/studio/persona")
  return {}
}

export async function setStudioEnabled(enabled: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const { error: dbErr } = await supabaseAdmin
    .from("studio_config")
    .upsert(
      { tenant_id: session.user.tenantId, ai_enabled: enabled, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id" },
    )
  if (dbErr) return { error: dbErr.message }
  revalidatePath("/studio")
  return {}
}
