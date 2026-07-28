"use server"

// ═══════════════════════════════════════════════════════════════
// God Mode — criar usuário DIRETO num tenant (sem convite)
// ═══════════════════════════════════════════════════════════════
// Caso de uso: implantação — o platform admin cria o acesso na hora e entrega
// as credenciais ao cliente. Espelha o acceptInvite (fonte canônica) SEM a
// etapa de e-mail/token:
//   • perfil por e-mail é REUSADO (nunca sobrescreve a senha de quem já existe);
//   • owner único por tenant continua valendo;
//   • limite de usuários continua valendo (god ajusta na aba Limites se precisar);
//   • agente novo ganha agenda provisionada (mesmo passo do convite);
//   • trust de dispositivo só pra PERFIL NOVO (deste device — god acabou de
//     definir a senha; conta pré-existente de terceiro NÃO ganha trust daqui);
//   • tudo no audit_log.

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { validatePassword } from "@/lib/password"
import { checkLimit } from "@/lib/limits"
import { provisionAgentAgenda } from "@/lib/agenda/provision"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

const ROLES = ["owner", "admin", "agent"] as const
type Role = (typeof ROLES)[number]

export interface CreateTenantUserInput {
  tenantId: string
  fullName: string
  email:    string
  password: string
  role:     Role
}

export async function createTenantUser(
  input: CreateTenantUserInput,
): Promise<{ ok: true; linkedExisting: boolean } | { error: string }> {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) return { error: "Acesso negado — apenas platform admin" }

  const fullName = input.fullName?.trim()
  const email    = input.email?.trim().toLowerCase()
  const role     = input.role
  if (!input.tenantId || !fullName || !email) return { error: "Preencha nome e e-mail." }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "E-mail inválido." }
  if (!ROLES.includes(role)) return { error: "Papel inválido." }

  const { data: tenant } = await supabaseAdmin
    .from("tenants").select("id, name").eq("id", input.tenantId).maybeSingle()
  if (!tenant) return { error: "Tenant não encontrado." }

  // Owner único por tenant — regra do produto vale até pro god.
  if (role === "owner") {
    const { count: owners } = await supabaseAdmin
      .from("tenant_users").select("user_id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId).eq("role", "owner").eq("active", true)
    if ((owners ?? 0) > 0) return { error: "Este tenant já tem um owner (owner é único). Crie como Admin." }
  }

  // Limite de usuários — mesmo gate do convite; god resolve na aba Limites.
  const { count: activeCount } = await supabaseAdmin
    .from("tenant_users").select("user_id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId).eq("active", true)
  const usage = await checkLimit(input.tenantId, "users")
  if (usage.max !== null && (activeCount ?? 0) >= usage.max) {
    return { error: `Limite de usuários atingido (${activeCount}/${usage.max}). Aumente na aba Limites e tente de novo.` }
  }

  // Perfil: reusa por e-mail (NUNCA sobrescreve senha existente) ou cria.
  const { data: existing } = await supabaseAdmin
    .from("profiles").select("id").eq("email", email).maybeSingle()

  let profileId: string
  const isNewUser = !existing
  if (existing) {
    profileId = existing.id
  } else {
    const pwErr = validatePassword(input.password)
    if (pwErr) return { error: pwErr }
    const passwordHash = await bcrypt.hash(input.password, 10)
    const { data: created, error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({ email, full_name: fullName, password_hash: passwordHash })
      .select("id").single()
    if (profileError) return { error: `Erro ao criar perfil: ${profileError.message}` }
    profileId = created.id
  }

  const { error: linkError } = await supabaseAdmin.from("tenant_users").insert({
    tenant_id: input.tenantId,
    user_id:   profileId,
    role,
    active:    true,
  })
  if (linkError) {
    if (linkError.code === "23505") return { error: "Este e-mail já é membro deste tenant." }
    return { error: `Erro ao vincular ao tenant: ${linkError.message}` }
  }

  // Mesmos passos pós-vínculo do convite.
  await provisionAgentAgenda(input.tenantId, profileId)
  if (isNewUser) await seedTrustForCurrentDevice(profileId)

  await logAudit({
    tenantId:   input.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "user.create_direct",
    targetType: "user",
    targetId:   profileId,
    after:      { email, role, linked_existing: !isNewUser },
    metadata:   { tenant_name: tenant.name, via: "god_mode" },
  })

  revalidatePath(`/admin/tenants/${input.tenantId}/usuarios`)
  return { ok: true, linkedExisting: !isNewUser }
}
