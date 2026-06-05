"use server"

import { supabaseAdmin } from "@/lib/supabase"
import { rateLimit } from "@/lib/rate-limit"
import bcrypt from "bcryptjs"

const BLOCKED = new Set(["pending_approval", "suspended", "deactivated"])

/**
 * Após um login FALHO, informa se o motivo é a conta estar BLOQUEADA (e qual) —
 * e SÓ quando a senha está CORRETA. Como exige a senha certa, o usuário provou
 * posse da conta → não é oráculo de enumeração (senha errada e conta-com-acesso
 * retornam ambos `{}`, indistinguíveis da resposta genérica).
 *
 * Usado pela tela de signin pra trocar "e-mail ou senha inválidos" por
 * "sua conta está em análise / suspensa" quando for o caso (UX do trial manual).
 */
export async function getSigninNotice(
  email: string,
  password: string,
): Promise<{ reason?: "pending_approval" | "suspended" }> {
  const e = String(email ?? "").toLowerCase().trim().slice(0, 254)
  if (!e || !password) return {}
  if (!rateLimit(`auth:notice:${e}`, 5, 15 * 60_000).ok) return {}

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("id, password_hash").eq("email", e).single()
  if (!profile?.password_hash) return {}
  if (!(await bcrypt.compare(password, profile.password_hash))) return {}

  const { data: memberships } = await supabaseAdmin
    .from("tenant_users").select("tenant_id").eq("user_id", profile.id).eq("active", true)
  if (!memberships?.length) return {}

  const { data: tens } = await supabaseAdmin
    .from("tenants").select("active, lifecycle_state").in("id", memberships.map((m) => m.tenant_id))

  // Tem ALGUM tenant acessível? Então o bloqueio não é o motivo — mantém genérico.
  const anyAccess = (tens ?? []).some((t) => t.active === true && !BLOCKED.has(t.lifecycle_state ?? ""))
  if (anyAccess) return {}

  const states = (tens ?? []).map((t) => t.lifecycle_state ?? "")
  if (states.includes("pending_approval")) return { reason: "pending_approval" }
  if (states.includes("suspended"))        return { reason: "suspended" }
  return {}
}
