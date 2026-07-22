"use server"

import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { checkLimit } from "@/lib/limits"
import { validatePassword } from "@/lib/password"
import { provisionAgentAgenda } from "@/lib/agenda/provision"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"

export async function acceptInvite(
  token: string,
  formData: FormData,
): Promise<{ error?: string; isNewUser?: boolean; email?: string }> {
  const { data: invite } = await supabaseAdmin
    .from("invites")
    .select("id, tenant_id, email, role, expires_at, accepted_at, department_id")
    .eq("token", token)
    .maybeSingle()

  if (!invite) return { error: "Convite não encontrado." }
  if (invite.accepted_at) return { error: "Este convite já foi aceito." }
  if (new Date(invite.expires_at) < new Date()) return { error: "Este convite expirou." }

  // ⛔ Defense-in-depth: bloqueia aceitação se tenant excede limite agora
  // (admin pode ter convidado dentro do limite e DEPOIS o super-admin reduziu).
  // Conta usuários ATIVOS (não conta o convite atual ainda — esse vira ativo só após este insert)
  const { count: activeCount } = await supabaseAdmin
    .from("tenant_users")
    .select("user_id", { count: "exact", head: true })
    .eq("tenant_id", invite.tenant_id)
    .eq("active", true)
  const usage = await checkLimit(invite.tenant_id, "users")
  if (usage.max !== null && (activeCount ?? 0) >= usage.max) {
    return {
      error: `Esse tenant atingiu o limite de usuários (${activeCount}/${usage.max}). ` +
             `Peça ao administrador pra remover algum membro ou solicitar aumento.`,
    }
  }

  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle()

  let profileId: string
  const isNewUser = !existingProfile

  if (existingProfile) {
    profileId = existingProfile.id
  } else {
    const fullName = (formData.get("full_name") as string)?.trim()
    const password = formData.get("password") as string

    if (!fullName || !password) return { error: "Preencha nome e senha." }
    const pwErr = validatePassword(password)
    if (pwErr) return { error: pwErr }

    const passwordHash = await bcrypt.hash(password, 10)

    const { data: newProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({ email: invite.email, full_name: fullName, password_hash: passwordHash })
      .select("id")
      .single()

    if (profileError) return { error: `Erro ao criar perfil: ${profileError.message}` }
    profileId = newProfile.id
  }

  const { error: linkError } = await supabaseAdmin.from("tenant_users").insert({
    tenant_id:     invite.tenant_id,
    user_id:       profileId,
    role:          invite.role,
    active:        true,
    department_id: invite.department_id ?? null,
  })

  if (linkError && linkError.code !== "23505") {
    return { error: `Erro ao vincular ao tenant: ${linkError.message}` }
  }

  await supabaseAdmin
    .from("invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: profileId })
    .eq("id", invite.id)

  // Auto-provisão: agente novo já entra com a agenda dele (se o tenant usa agenda).
  await provisionAgentAgenda(invite.tenant_id, profileId)

  // Device trust: usuário NOVO acabou de provar posse do e-mail (link do
  // convite) E definir a própria senha → semeia confiança neste dispositivo
  // (senão o auto-login da sequência cairia num 2º código — mesma prova, duas
  // vezes). Usuário EXISTENTE não: link de convite é encaminhável; ele paga um
  // desafio no próximo login e pronto.
  if (isNewUser) await seedTrustForCurrentDevice(profileId)

  return { isNewUser, email: invite.email }
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

  await supabaseAdmin.from("invites").delete().eq("id", invite.id)

  return {}
}
