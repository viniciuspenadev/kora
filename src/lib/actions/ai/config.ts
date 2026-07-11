"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import type { AIConfig, AIConfigInput } from "@/types/ai"

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

export async function getAIConfig(): Promise<AIConfig | null> {
  const session = await requireMember()

  const { data, error } = await supabaseAdmin
    .from("ai_config")
    .select("*")
    .eq("tenant_id", session.user.tenantId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

function sanitize(input: AIConfigInput): AIConfigInput {
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

export async function updateAIConfig(input: AIConfigInput): Promise<{ error?: string }> {
  const session = await requireAdmin()
  const data    = sanitize(input)

  const { error: dbErr } = await supabaseAdmin
    .from("ai_config")
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

  revalidatePath("/automacao/ia")
  revalidatePath("/automacao/ia/persona")
  return {}
}

export async function setAIEnabled(enabled: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin()

  const { error: dbErr } = await supabaseAdmin
    .from("ai_config")
    .upsert(
      {
        tenant_id:  session.user.tenantId,
        ai_enabled: enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id" },
    )

  if (dbErr) return { error: dbErr.message }

  revalidatePath("/automacao/ia")
  return {}
}
