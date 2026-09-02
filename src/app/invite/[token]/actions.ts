"use server"

import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { validatePassword } from "@/lib/password"
import { provisionAgentAgenda } from "@/lib/agenda/provision"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"
import { acceptInviteWithAtomicSeat } from "@/lib/user-seats"

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

  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", invite.email)
    .maybeSingle()

  let fullName: string | null = null
  let passwordHash: string | null = null

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
  const accepted = await acceptInviteWithAtomicSeat({ token, fullName, passwordHash })
  if (!accepted.ok) return { error: accepted.error }

  // Auto-provisão: agente novo já entra com a agenda dele (se o tenant usa agenda).
  await provisionAgentAgenda(accepted.value.tenant_id, accepted.value.user_id)

  // Device trust: usuário NOVO acabou de provar posse do e-mail (link do
  // convite) E definir a própria senha → semeia confiança neste dispositivo
  // (senão o auto-login da sequência cairia num 2º código — mesma prova, duas
  // vezes). Usuário EXISTENTE não: link de convite é encaminhável; ele paga um
  // desafio no próximo login e pronto.
  if (accepted.value.is_new_user) await seedTrustForCurrentDevice(accepted.value.user_id)

  return { isNewUser: accepted.value.is_new_user, email: accepted.value.email }
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
