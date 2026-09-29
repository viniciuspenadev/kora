"use server"

import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { validatePassword } from "@/lib/password"
import { provisionAgentAgenda } from "@/lib/agenda/provision"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"
import { headers } from "next/headers"
import { rateLimit } from "@/lib/rate-limit"

export async function acceptInvite(
  token: string,
  formData: FormData,
): Promise<{ error?: string; isNewUser?: boolean; email?: string; awaitingApproval?: boolean }> {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) return { error: "Convite inválido." }
  if (!rateLimit(`invite:accept:${token}`, 10, 15 * 60_000).ok) return { error: "Muitas tentativas. Aguarde alguns minutos." }
  const { data: invite } = await supabaseAdmin
    .from("invites")
    .select("id, tenant_id, email, role, expires_at, accepted_at, department_id")
    .eq("token", token)
    .maybeSingle()

  if (!invite) return { error: "Convite não encontrado." }
  if (invite.accepted_at) return { error: "Este convite já foi aceito." }
  if (new Date(invite.expires_at) < new Date()) return { error: "Este convite expirou." }

  const { data: existingProfile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id,password_hash")
    .eq("email", invite.email)
    .maybeSingle()
  if (profileError) return { error: "Não foi possível consultar sua conta. Tente novamente." }

  let fullName: string | null = null
  let passwordHash: string | null = null

  if (existingProfile) {
    const password = formData.get("password")
    if (typeof password !== "string" || password.length > 128 || !await bcrypt.compare(password, existingProfile.password_hash)) {
      return { error: "Informe a senha da sua conta Kora para aceitar o convite." }
    }
  }

  if (!existingProfile) {
    fullName = (formData.get("full_name") as string)?.trim()
    const password = formData.get("password") as string

    if (!fullName || !password) return { error: "Preencha nome e senha." }
    const pwErr = validatePassword(password)
    if (pwErr) return { error: pwErr }

    passwordHash = await bcrypt.hash(password, 10)
  }

  // Perfil, membership e aceite mudam juntos. O convite já ocupa uma vaga válida, então
  // pendente -> ativo tem delta líquido zero mesmo se o teto foi reduzido depois do envio.
  const h = await headers()
  const hops = Math.max(1, parseInt(process.env.XFF_TRUSTED_HOPS ?? "1", 10) || 1)
  const parts = (h.get("x-forwarded-for") ?? "").split(",").map(s => s.trim()).filter(Boolean)
  const ip = parts.length ? parts[Math.max(0, parts.length - hops)] : h.get("x-real-ip")
  const { data: value, error: acceptError } = await supabaseAdmin.rpc("aceitar_convite_cadastro_atomico", {
    p_token: token, p_name: fullName, p_password_hash: passwordHash,
    p_consent: formData.get("consent") === "on", p_ip: ip, p_expected_user: existingProfile?.id ?? null,
  })
  if (acceptError || !value?.user_id) return { error: acceptError?.message.includes("consent_required")
    ? "Aceite a política de privacidade para continuar." : "Não foi possível aceitar. O convite pode ter expirado ou já ter sido utilizado." }
  const accepted = { value: value as { tenant_id: string; user_id: string; email: string; is_new_user: boolean } }

  // Auto-provisão: agente novo já entra com a agenda dele (se o tenant usa agenda).
  await provisionAgentAgenda(accepted.value.tenant_id, accepted.value.user_id)

  // Device trust: usuário NOVO acabou de provar posse do e-mail (link do
  // convite) E definir a própria senha → semeia confiança neste dispositivo
  // (senão o auto-login da sequência cairia num 2º código — mesma prova, duas
  // vezes). Usuário EXISTENTE não: link de convite é encaminhável; ele paga um
  // desafio no próximo login e pronto.
  if (accepted.value.is_new_user) await seedTrustForCurrentDevice(accepted.value.user_id)

  return { isNewUser: accepted.value.is_new_user, email: accepted.value.email, awaitingApproval: value.awaiting_approval === true }
}

export async function rejectInvite(token: string): Promise<{ error?: string }> {
  // Endpoint público — qualquer um com o token pode recusar. Sem auth porque
  // o convidado pode não ter conta ainda. Token único é a credencial.
  const { data: invite } = await supabaseAdmin
    .from("invites")
    .select("id, accepted_at")
    .eq("token", token)
    .maybeSingle()

  if (!invite) return { error: "Convite não encontrado." }
  if (invite.accepted_at) return { error: "Este convite já foi aceito — não dá pra recusar agora." }

  // Decisão + delete no mesmo statement. Se um aceite concorrente vencer primeiro,
  // `accepted_at` deixa de ser nulo e a evidência do convite permanece.
  const { data: deleted, error } = await supabaseAdmin
    .from("invites")
    .delete()
    .eq("id", invite.id)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle()

  if (error) return { error: "Não foi possível recusar o convite." }
  if (!deleted) return { error: "Este convite já foi aceito — não dá pra recusar agora." }

  return {}
}
