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
import { provisionAgentAgenda } from "@/lib/agenda/provision"
import { seedTrustForCurrentDevice } from "@/lib/auth/trust"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { createTenantUserWithAtomicSeat } from "@/lib/user-seats"

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

  // Multi-owner permitido (owners co-iguais, decisão do owner 2026-08-01) — o god pode
  // criar owner mesmo que o tenant já tenha um.

  // Perfil: reusa por e-mail (NUNCA sobrescreve senha existente) ou cria.
  const { data: existing } = await supabaseAdmin
    .from("profiles").select("id").eq("email", email).maybeSingle()

  let passwordHash: string | null = null
  if (!existing) {
    const pwErr = validatePassword(input.password)
    if (pwErr) return { error: pwErr }
    passwordHash = await bcrypt.hash(input.password, 10)
  }

  // A criação de perfil (quando necessária), o vínculo e a reserva da vaga são uma única
  // transação serializada por tenant. `user_quota` não participa deste gate.
  const created = await createTenantUserWithAtomicSeat({
    tenantId: input.tenantId,
    fullName,
    email,
    passwordHash,
    role,
    actorId: session.user.id,
  })
  if (!created.ok) return { error: created.error }
  const profileId = created.value.user_id

  // Mesmos passos pós-vínculo do convite.
  await provisionAgentAgenda(input.tenantId, profileId)
  if (created.value.is_new_user) await seedTrustForCurrentDevice(profileId)

  await logAudit({
    tenantId:   input.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     "user.create_direct",
    targetType: "user",
    targetId:   profileId,
    after:      { email, role, linked_existing: !created.value.is_new_user },
    metadata:   { tenant_name: tenant.name, via: "god_mode" },
  })

  revalidatePath(`/admin/tenants/${input.tenantId}/usuarios`)
  return { ok: true, linkedExisting: !created.value.is_new_user }
}
