"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ═══════════════════════════════════════════════════════════════
// Kora Companion — dispositivos (tokens da extensão)
// ═══════════════════════════════════════════════════════════════
// Cada login da extensão cria uma linha em device_tokens. Aqui: listar e
// revogar. Regra: cada um gerencia os PRÓPRIOS dispositivos; admin/owner
// gerencia os de qualquer membro do tenant (anti-IDOR por tenant_id sempre).
// Revogação é imediata — o pipeline /api/ext checa revoked_at a cada request.

export interface ExtensionDevice {
  id:           string
  label:        string
  created_at:   string
  last_used_at: string | null
}

async function requireSession() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  return session
}

/** Lista dispositivos ativos (não-revogados). Sem userId = os meus. */
export async function listExtensionDevices(userId?: string): Promise<ExtensionDevice[]> {
  const session = await requireSession()
  const isAdmin = ["owner", "admin"].includes(session.user.role)
  const target = userId && userId !== session.user.id ? userId : session.user.id
  if (target !== session.user.id && !isAdmin) throw new Error("Sem permissão")

  const { data, error } = await supabaseAdmin
    .from("device_tokens")
    .select("id, label, created_at, last_used_at")
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", target)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ExtensionDevice[]
}

/** Revoga um dispositivo. Dono revoga o próprio; admin revoga qualquer um do tenant. */
export async function revokeExtensionDevice(deviceId: string): Promise<{ error?: string }> {
  const session = await requireSession()
  const isAdmin = ["owner", "admin"].includes(session.user.role)

  let q = supabaseAdmin
    .from("device_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", session.user.tenantId)
    .eq("id", deviceId)
    .is("revoked_at", null)
  if (!isAdmin) q = q.eq("user_id", session.user.id)

  const { data, error } = await q.select("id")
  if (error) return { error: error.message }
  if (!data?.length) return { error: "Dispositivo não encontrado." }
  return {}
}
