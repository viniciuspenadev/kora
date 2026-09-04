"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { atendimentoBloqueado, checkTenantStatus } from "@/lib/auth/tenant-serviceable"
import { revalidatePath } from "next/cache"
import { randomBytes } from "crypto"
import { getProvider } from "@/lib/providers"
import { sendEmail, buildInviteEmail } from "@/lib/email/send"
import { logAudit } from "@/lib/audit"
import { createInviteWithAtomicSeat, reactivateMemberWithAtomicSeat } from "@/lib/user-seats"
import { normInventoryLevel, normAccessLevel, type InventoryAccessLevel, type AccessLevel } from "@/lib/visibility"

export type TenantRole = "owner" | "admin" | "agent"

/**
 * 📋 Trilha das ações de equipe (2026-08-03).
 *
 * 🔴 POR QUE ISTO EXISTE: até hoje este arquivo tinha **zero** `logAudit`. Desativar um
 *    colega, trocar papel, mudar nível de acesso a Contatos/Negócios, alterar quais números
 *    a pessoa enxerga — nada entrava na trilha. Num tenant com dois ou três admins, "quem
 *    me tirou o acesso?" não tinha resposta. E é o nível onde as coisas acontecem no dia a
 *    dia: a cascata de tenant (god mode) já era auditada; esta, que é mais usada, não.
 *
 * Best-effort por construção — `logAudit` engole o próprio erro e nunca lança, então
 * registrar não pode derrubar a ação que já aconteceu.
 */
/**
 * 🔒 REGRA ÚNICA de "quem pode mexer em QUEM" — `admin` só gerencia `agent`.
 *
 * 🔴 POR QUE VIROU HELPER (QA 2026-08-03). O H-06 fechou `updateMemberRole`, e depois eu
 *    fechei `setMemberActive` — duas portas, duas cópias. O QA percorreu as 30 exports e
 *    achou **onze** outras que um admin usa contra outro admin/owner. A mais grave:
 *    `setMemberCompanionAccess`, porque `companion_access` é o ÚNICO campo de
 *    `tenant_users` que o servidor checa **sem isenção de papel** (`ext-auth.ts:346`) —
 *    um admin derrubava a extensão do OWNER, a cada request, com um POST de server action.
 *    As outras dez eram pílula envenenada: `visibility.ts` anula tudo pra quem é admin,
 *    então zerar `contacts_access` de um admin não faz nada HOJE — mas o dano aparece no
 *    dia em que essa pessoa for rebaixada a agent, semanas depois, sem ninguém ligar os
 *    fatos. Regra única em vez de treze cópias, que é como isso vazou em primeiro lugar.
 *
 * ⚠️ Fail-CLOSED em erro de consulta: sem confirmar o papel do alvo, recusa. O padrão
 *    anterior (`data` sem checar `error`) deixava `target = null` e todas as guardas viravam
 *    no-op — o mesmo defeito de fundo que a §3 do access-revocation-design descreve.
 */
async function assertCanManageTarget(
  session: Awaited<ReturnType<typeof requireTenantAdmin>>,
  targetUserId: string,
): Promise<{ error?: string; role?: TenantRole; active?: boolean }> {
  const { data, error } = await supabaseAdmin
    .from("tenant_users")
    .select("role, active")
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", targetUserId)
    .maybeSingle()

  if (error) return { error: "Não foi possível validar o membro. Tente de novo." }
  if (!data) return { error: "Membro não encontrado" }

  const target = data as { role: TenantRole; active: boolean }
  if (session.user.role !== "owner" && target.role !== "agent") {
    return { error: "Apenas um owner pode gerenciar admins e owners." }
  }
  return { role: target.role, active: target.active }
}

async function auditTeam(
  session: Awaited<ReturnType<typeof requireTenantAdmin>>,
  action: string,
  targetUserId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await logAudit({
    tenantId:   session.user.tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     `team.${action}`,
    targetType: "tenant_user",
    targetId:   targetUserId,
    metadata,
  })
}

export interface TeamMember {
  user_id:       string
  email:         string
  full_name:     string | null
  role:          TenantRole
  active:        boolean
  view_all:      boolean
  see_pool:      boolean
  instance_ids:  string[] | null   // números que atende (Fase D); null/[] = todos
  department_id: string | null
  supervises_departments: string[]  // supervisão escopada: setores que vê por inteiro; [] = nenhum
  inventory_access: InventoryAccessLevel   // capability granular: none | view | manage
  deals_access:     AccessLevel            // Negócios: none | view | manage
  contacts_access:  AccessLevel            // Contatos: none | view | manage
  marketing_access: AccessLevel            // Marketing: none | view | manage
  catalog_access:   AccessLevel            // Catálogo: none | view | manage
  companion_access: boolean                // Extensão Chrome (Kora Companion): pode usar sobre o WhatsApp Web
  department:    { id: string; name: string; color: string } | null
  unit_id:       string | null
  unit:          { id: string; name: string; color: string } | null
  joined_at:     string
}

export interface TeamInvite {
  id:                    string
  email:                 string
  phone:                 string | null
  role:                  TenantRole
  token:                 string
  expires_at:            string
  created_at:            string
  invited_by:            string | null
  inviter_name:          string | null
  sent_via_whatsapp_at:  string | null
  sent_via_email_at:     string | null
}

export interface Department {
  id:     string
  name:   string
  color:  string
  user_count: number
}

export interface Unit {
  id:     string
  name:   string
  color:  string
  active: boolean
  user_count: number
  deal_count: number
  logo_path:  string | null   // logo da empresa (identidade visual em cotações/pedidos)
  // Ficha da empresa/filial (alimenta cabeçalho de cotações/pedidos em PDF)
  legal_name: string | null
  tax_id:     string | null
  phone:      string | null
  email:      string | null
  zip_code:   string | null
  street:     string | null
  number:     string | null
  complement: string | null
  district:   string | null
  city:       string | null
  state:      string | null
}

/** Campos opcionais da ficha da unidade (empresa + endereço). Todos livres. */
export interface UnitProfileInput {
  legal_name?: string | null
  tax_id?:     string | null
  phone?:      string | null
  email?:      string | null
  zip_code?:   string | null
  street?:     string | null
  number?:     string | null
  complement?: string | null
  district?:   string | null
  city?:       string | null
  state?:      string | null
}

const UNIT_PROFILE_FIELDS = [
  "legal_name", "tax_id", "phone", "email",
  "zip_code", "street", "number", "complement", "district", "city", "state",
] as const

/** Normaliza campos da ficha: trim, string vazia → null. Só inclui chaves presentes. */
function normalizeUnitProfile(input: UnitProfileInput): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const key of UNIT_PROFILE_FIELDS) {
    const raw = input[key]
    if (raw === undefined) continue
    const trimmed = typeof raw === "string" ? raw.trim() : raw
    out[key] = trimmed ? trimmed : null
  }
  return out
}

/** Unidade ativa (etiqueta de venda) — opção pros selects de membro/negócio. */
export interface UnitOption { id: string; name: string; color: string }

// ── Helpers ─────────────────────────────────────────────────────

async function requireTenantAdmin() {
  const session = await auth()
  if (!session?.user?.tenantId) throw new Error("Não autenticado")
  if (!["owner", "admin"].includes(session.user.role)) {
    throw new Error("Apenas owner ou admin podem gerenciar a equipe")
  }
  return session
}

// ── Listagem ────────────────────────────────────────────────────

export async function listTeamMembers(): Promise<TeamMember[]> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data, error } = await supabaseAdmin
    .from("tenant_users")
    .select(`
      user_id, role, active, view_all, see_pool, instance_ids, department_id, supervises_departments, inventory_access, deals_access, contacts_access, marketing_access, catalog_access, companion_access, unit_id, joined_at,
      profiles!tenant_users_user_id_fkey ( email, full_name ),
      tenant_departments ( id, name, color ),
      tenant_units ( id, name, color )
    `)
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("joined_at", { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { email: string; full_name: string | null } | null
    const dept    = row.tenant_departments as unknown as { id: string; name: string; color: string } | null
    const unit    = row.tenant_units as unknown as { id: string; name: string; color: string } | null
    return {
      user_id:       row.user_id,
      email:         profile?.email ?? "—",
      full_name:     profile?.full_name ?? null,
      role:          row.role as TenantRole,
      active:        row.active,
      view_all:      row.view_all,
      see_pool:      row.see_pool ?? true,
      instance_ids:  (row.instance_ids as string[] | null) ?? null,
      department_id: row.department_id,
      supervises_departments: (row.supervises_departments as string[] | null) ?? [],
      inventory_access: normInventoryLevel(row.inventory_access),
      deals_access: normAccessLevel(row.deals_access),
      contacts_access: normAccessLevel(row.contacts_access),
      marketing_access: normAccessLevel(row.marketing_access),
      catalog_access: normAccessLevel(row.catalog_access),
      companion_access: (row.companion_access as boolean | null) !== false,
      department:    dept,
      unit_id:       row.unit_id,
      unit,
      joined_at:     row.joined_at,
    }
  })
}

/** Um membro do tenant (pra página de perfil). Anti-IDOR pelo tenant do admin. */
export async function getTeamMember(userId: string): Promise<TeamMember | null> {
  const session = await requireTenantAdmin()
  const { data } = await supabaseAdmin
    .from("tenant_users")
    .select(`
      user_id, role, active, view_all, see_pool, instance_ids, department_id, supervises_departments, inventory_access, deals_access, contacts_access, marketing_access, catalog_access, companion_access, unit_id, joined_at,
      profiles!tenant_users_user_id_fkey ( email, full_name ),
      tenant_departments ( id, name, color ),
      tenant_units ( id, name, color )
    `)
    .eq("tenant_id", session.user.tenantId).eq("user_id", userId).maybeSingle()
  if (!data) return null
  const row = data as Record<string, unknown>
  const profile = row.profiles as unknown as { email: string; full_name: string | null } | null
  const dept    = row.tenant_departments as unknown as { id: string; name: string; color: string } | null
  const unit    = row.tenant_units as unknown as { id: string; name: string; color: string } | null
  return {
    user_id:       row.user_id as string,
    email:         profile?.email ?? "—",
    full_name:     profile?.full_name ?? null,
    role:          row.role as TenantRole,
    active:        row.active as boolean,
    view_all:      row.view_all as boolean,
    see_pool:      (row.see_pool as boolean | null) ?? true,
    instance_ids:  (row.instance_ids as string[] | null) ?? null,
    department_id: (row.department_id as string | null) ?? null,
    supervises_departments: (row.supervises_departments as string[] | null) ?? [],
    inventory_access: normInventoryLevel(row.inventory_access),
    deals_access:  normAccessLevel(row.deals_access),
    contacts_access: normAccessLevel(row.contacts_access),
    marketing_access: normAccessLevel(row.marketing_access),
    catalog_access: normAccessLevel(row.catalog_access),
    companion_access: (row.companion_access as boolean | null) !== false,
    department:    dept,
    unit_id:       (row.unit_id as string | null) ?? null,
    unit,
    joined_at:     row.joined_at as string,
  }
}

export async function listPendingInvites(): Promise<TeamInvite[]> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data, error } = await supabaseAdmin
    .from("invites")
    .select(`
      id, email, phone, role, token, expires_at, created_at, invited_by,
      sent_via_whatsapp_at, sent_via_email_at,
      profiles!invites_invited_by_fkey ( full_name )
    `)
    .eq("tenant_id", tenantId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const inviter = row.profiles as unknown as { full_name: string | null } | null
    return {
      id:                   row.id,
      email:                row.email,
      phone:                row.phone,
      role:                 row.role as TenantRole,
      token:                row.token,
      expires_at:           row.expires_at,
      created_at:           row.created_at,
      invited_by:           row.invited_by,
      inviter_name:         inviter?.full_name ?? null,
      sent_via_whatsapp_at: row.sent_via_whatsapp_at,
      sent_via_email_at:    row.sent_via_email_at,
    }
  })
}

// ── Convites ────────────────────────────────────────────────────

export async function inviteTeamMember(input: {
  email:          string
  role:           TenantRole
  department_id?: string | null
  phone?:         string | null
}): Promise<{ error?: string; token?: string; inviteId?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes("@")) return { error: "E-mail inválido" }
  if (!["owner", "admin", "agent"].includes(input.role)) return { error: "Papel inválido" }

  // H-06 + multi-owner: convidar OWNER ou ADMIN é privilégio de owner (owners co-iguais →
  // múltiplos owners permitidos; admin não cria admin/owner). Convidar agent segue admin.
  if ((input.role === "owner" || input.role === "admin") && session.user.role !== "owner") {
    return { error: "Apenas um owner pode convidar owner ou admin." }
  }

  const token = randomBytes(24).toString("hex")

  // Normaliza phone: digits only; se < 12 dígitos, assume Brasil e prepende 55
  let normalizedPhone: string | null = null
  if (input.phone) {
    const digits = input.phone.replace(/\D/g, "")
    if (digits.length >= 10) {
      normalizedPhone = digits.length < 12 ? `55${digits}` : digits
    }
  }

  // A RPC serializa no tenant e decide limite + insert na MESMA transação. A UI continua
  // validando cedo por ergonomia; a autoridade (incluindo ownership do departamento) é DB.
  const created = await createInviteWithAtomicSeat({
    tenantId,
    email,
    phone: normalizedPhone,
    role: input.role,
    token,
    invitedBy: session.user.id,
    departmentId: input.department_id ?? null,
  })
  if (!created.ok) return { error: created.error }

  revalidatePath("/configuracoes/equipe")
  return { token, inviteId: created.value.inviteId }
}

export async function cancelInvite(inviteId: string): Promise<void> {
  const session = await requireTenantAdmin()
  await supabaseAdmin
    .from("invites")
    .delete()
    .eq("id", inviteId)
    .eq("tenant_id", session.user.tenantId)
  revalidatePath("/configuracoes/equipe")
}

// ── Edição de membros ───────────────────────────────────────────

export async function updateMemberRole(userId: string, role: TenantRole): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  if (!["owner", "admin", "agent"].includes(role)) return { error: "Papel inválido" }

  const { data: target } = await supabaseAdmin
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!target) return { error: "Membro não encontrado" }

  // H-06 (pentest 2026-08-01) + multi-owner (owners CO-IGUAIS, decisão do owner 2026-08-01):
  // QUALQUER transição que envolva owner OU admin (papel atual OU novo) é privilégio de OWNER.
  // Antes, um admin promovia agent→admin / rebaixava admin (escalada horizontal). Agora admin
  // não gerencia papéis de admin/owner — só owner. Owners podem promover/rebaixar admins E
  // outros owners entre si.
  const involvesPrivileged =
    role === "owner" || role === "admin" || target.role === "owner" || target.role === "admin"
  if (involvesPrivileged && session.user.role !== "owner") {
    return { error: "Apenas um owner pode gerenciar papéis de admin/owner." }
  }

  // 🔒 Guarda-corpo: o tenant NUNCA pode ficar com ZERO owner (rebaixar o último owner).
  if (target.role === "owner" && role !== "owner") {
    const { count } = await supabaseAdmin
      .from("tenant_users").select("user_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("role", "owner").eq("active", true)
    if ((count ?? 0) <= 1) {
      return { error: "O tenant precisa ter ao menos um owner. Promova outro antes de rebaixar este." }
    }
  }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "role.change", userId, { from: target.role, to: role })
  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function updateMemberDepartment(userId: string, departmentId: string | null): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  const tenantId = session.user.tenantId

  if (departmentId) {
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", departmentId)
      .maybeSingle()
    if (!dept) return { error: "Departamento não encontrado" }
  }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ department_id: departmentId })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "department.set", userId, { department_id: departmentId })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/** Unidade de negócio do vendedor (etiqueta de venda). null = sem unidade. Anti-IDOR. */
export async function setMemberUnit(userId: string, unitId: string | null): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  const tenantId = session.user.tenantId

  if (unitId) {
    const { data: unit } = await supabaseAdmin
      .from("tenant_units")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", unitId)
      .maybeSingle()
    if (!unit) return { error: "Unidade não encontrada" }
  }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ unit_id: unitId })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "unit.set", userId, { unit_id: unitId })
  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function toggleMemberViewAll(userId: string, viewAll: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ view_all: viewAll })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "view_all.set", userId, { view_all: viewAll })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Liga/desliga se o atendente vê as conversas não atribuídas (pool).
 * Default true (vê). Desligado = só vê o atribuído a ele + participações;
 * depende da Distribuição/atribuição manual pra receber conversas novas.
 */
export async function toggleMemberSeePool(userId: string, seePool: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ see_pool: seePool })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "see_pool.set", userId, { see_pool: seePool })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Edita os DADOS da pessoa (nome). E-mail é o login e não muda por aqui.
 * Anti-IDOR: só edita quem é membro DO tenant do admin (profiles é global).
 */
export async function updateMemberProfile(userId: string, input: { fullName?: string }): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  // Escreve em `profiles` (nome exibido), não em `tenant_users` — mas ainda é o registro de
  // OUTRA pessoa. Mesma regra: admin só edita agent. Baixa severidade, guarda idêntica.
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }

  const patch: Record<string, unknown> = {}
  if (input.fullName !== undefined) {
    const n = input.fullName.trim()
    if (!n) return { error: "O nome não pode ficar vazio." }
    patch.full_name = n.slice(0, 80)
  }
  if (Object.keys(patch).length === 0) return {}

  const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", userId)
  if (error) return { error: error.message }
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Capability granular: nível de acesso de um AGENTE ao Estoque (none|view|edit|manage).
 * Owner/admin já têm manage via role. 1ª capability do padrão (financial_access, etc. virão).
 */
export async function setMemberInventoryAccess(userId: string, level: InventoryAccessLevel): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  if (!["none", "view", "edit", "manage"].includes(level)) return { error: "Nível inválido" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ inventory_access: level })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "access.inventory", userId, { level })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Extensão Chrome (Kora Companion): pode usar o Kora sobre o WhatsApp Web?
 * Vale pra QUALQUER role (a extensão respeita o alcance de cada um). O gate é
 * checado a cada request em /api/ext — desligar derruba a sessão na hora.
 */
export async function setMemberCompanionAccess(userId: string, enabled: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ companion_access: enabled === true })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)
  if (error) return { error: error.message }
  await auditTeam(session, "access.companion", userId, { enabled })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/** Nível de acesso ao módulo Catálogo (Ver/Gerenciar). Owner/admin = manage via role. */
export async function setMemberCatalogAccess(userId: string, level: AccessLevel): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  if (!["none", "view", "edit", "manage"].includes(level)) return { error: "Nível inválido" }
  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ catalog_access: level })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)
  if (error) return { error: error.message }
  await auditTeam(session, "access.catalog", userId, { level })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Nível de acesso ao módulo Negócios do atendente (escada Ver/Gerenciar; enum
 * permissivo). Owner/admin já têm manage via role. Espelha setMemberInventoryAccess.
 */
export async function setMemberDealsAccess(userId: string, level: AccessLevel): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  if (!["none", "view", "edit", "manage"].includes(level)) return { error: "Nível inválido" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ deals_access: level })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "access.deals", userId, { level })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Nível de acesso ao módulo Contatos do atendente (Ver = por relação · Gerenciar = base toda +
 * importar/mesclar). Owner/admin/supervisor = base via role. Espelha as demais.
 */
export async function setMemberContactsAccess(userId: string, level: AccessLevel): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  if (!["none", "view", "edit", "manage"].includes(level)) return { error: "Nível inválido" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ contacts_access: level })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "access.contacts", userId, { level })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Nível de acesso ao Marketing do atendente (Ver = ver campanhas/resultados · Gerenciar =
 * criar/disparar + configurar listas). Owner/admin = via role. Espelha as demais.
 */
export async function setMemberMarketingAccess(userId: string, level: AccessLevel): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  if (!["none", "view", "edit", "manage"].includes(level)) return { error: "Nível inválido" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ marketing_access: level })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "access.marketing", userId, { level })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Define os números (whatsapp_instances) que o atendente atende (Fase D).
 * Vazio = todos (sem restrição). Valida que cada id é instância DO tenant (anti-IDOR)
 * — id de outro tenant é rejeitado, nunca persistido.
 */
export async function updateMemberInstances(userId: string, instanceIds: string[]): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  const tenantId = session.user.tenantId

  let valid: string[] = []
  if (instanceIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", instanceIds)
    const ok = new Set((rows ?? []).map((r) => (r as { id: string }).id))
    valid = instanceIds.filter((id) => ok.has(id))
    if (valid.length !== instanceIds.length) return { error: "Número inválido para este tenant" }
  }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ instance_ids: valid.length > 0 ? valid : null })   // [] → null (= todos)
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "instances.set", userId, { count: instanceIds.length })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Supervisão ESCOPADA: os setores que o atendente supervisiona (vê por inteiro).
 * Valida que os ids pertencem ao tenant (anti-IDOR). [] → null (não supervisiona).
 * Ortogonal a view_all (= supervisão geral).
 */
export async function setMemberSupervises(userId: string, departmentIds: string[]): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const guard = await assertCanManageTarget(session, userId)
  if (guard.error) return { error: guard.error }
  const tenantId = session.user.tenantId

  let valid: string[] = []
  if (departmentIds.length > 0) {
    const { data: rows } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", departmentIds)
    const ok = new Set((rows ?? []).map((r) => (r as { id: string }).id))
    valid = departmentIds.filter((id) => ok.has(id))
    if (valid.length !== departmentIds.length) return { error: "Departamento inválido para este tenant" }
  }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ supervises_departments: valid.length > 0 ? valid : null })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  await auditTeam(session, "supervises.set", userId, { count: departmentIds.length })
  revalidatePath("/configuracoes/equipe")
  return {}
}

/** Números do tenant pra o seletor "Números que atende" (Fase D). */
export async function listTeamNumbers(): Promise<{ id: string; label: string; provider: string | null }[]> {
  const session = await requireTenantAdmin()
  const { data } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("id, display_name, phone_number, instance_name, provider, created_at")
    .eq("tenant_id", session.user.tenantId)
    .order("created_at", { ascending: true })
  return (data ?? []).map((r) => {
    const row = r as { id: string; display_name: string | null; phone_number: string | null; instance_name: string | null; provider: string | null }
    return { id: row.id, label: row.display_name || row.phone_number || row.instance_name || "Número", provider: row.provider }
  })
}

export async function setMemberActive(userId: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  // Não permite desativar o owner
  const { data: target } = await supabaseAdmin
    .from("tenant_users")
    .select("role, user_id, active")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single()

  // ⚠️ FAIL-CLOSED (QA 2026-08-03): sem confirmar o alvo, recusa. Antes o `error` do select
  //    era descartado e, num blip, `target` virava `null` — o que fazia **todas** as guardas
  //    abaixo virarem no-op de uma vez. É o mesmo defeito de fundo da §3 do design doc.
  if (!target) return { error: "Membro não encontrado" }

  // 🔒 H-06 POR OUTRA PORTA (achado 2026-08-03). O `updateMemberRole` exige OWNER pra
  //    qualquer mexida em papel de admin/owner — mas ESTA ação só exigia `requireTenantAdmin`.
  //    O admin A não conseguia REBAIXAR o admin B, mas conseguia DESATIVÁ-LO, que é pior.
  //    A mesma escalada horizontal, por uma porta que ninguém olhou.
  // ⚠️ Só na DESATIVAÇÃO — reativar devolve o que já era da pessoa, não é escalada.
  if (!active && target.role === "admin" && session.user.role !== "owner") {
    return { error: "Apenas um owner pode desativar um admin." }
  }

  // ⚠️ `!active &&` AQUI TAMBÉM (QA 2026-08-03): a guarda de owner era incondicional, e isso
  //    criava um beco sem saída. Um owner INATIVO (chega-se lá promovendo alguém já
  //    desativado — `updateMemberRole` não olha `active`) não podia ser reativado por esta
  //    linha, nem rebaixado, porque o guarda anti-zero-owner do `updateMemberRole` conta só
  //    owners ATIVOS e dispara com `count <= 1`. Ficava preso, resgatável só por SQL.
  if (!active && target.role === "owner") return { error: "Não é possível desativar o owner" }
  if (target.user_id === session.user.id) return { error: "Você não pode desativar a si mesmo" }

  if (active) {
    // Reativação aumenta o consumo em +1 e precisa disputar a vaga sob o mesmo lock usado
    // por convite/aceite/criação god. Desativação reduz consumo e não precisa do gate.
    const activation = await reactivateMemberWithAtomicSeat({
      tenantId,
      userId,
      actorId: session.user.id,
    })
    if (!activation.ok) return { error: activation.error }
  } else {
    const { error } = await supabaseAdmin
      .from("tenant_users")
      .update({ active: false })
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
    if (error) return { error: error.message }
  }

  // Agenda do agente acompanha o status: desativado → fora do ar (não roda paralelo);
  // reativado → volta. Best-effort (não derruba a desativação).
  await supabaseAdmin
    .from("tenant_resources")
    .update({ active })
    .eq("tenant_id", tenantId)
    .eq("assigned_agent_id", userId)

  let revoked: Record<string, unknown> | null = null

  // Desativado não recebe mais push: limpa as subscriptions DELE NESTE tenant
  // (escopado — não afeta o mesmo usuário em outros tenants).
  if (!active) {
    const push = await supabaseAdmin.from("push_subscriptions").delete().eq("tenant_id", tenantId).eq("user_id", userId).select("id")

    // Cascata do device trust (§7): desativar membro revoga confiança + sessões
    // + tokens de extensão. A sessão do navegador já cairia em ~5min pelo
    // revalidateAccess, mas a CONFIANÇA de 30d sobreviveria — reativar depois
    // deixaria o dispositivo pular o desafio. Escopado ao tenant (sessões e
    // tokens têm tenant_id; a confiança é por par device+user, revogamos toda —
    // aceitável: a pessoa perdeu acesso a este tenant e re-prova no próximo login).
    // 📊 CONTAGEM NA TRILHA (QA 2026-08-03): antes estes três passos descartavam o retorno,
    //    então "a cascata rodou?" não tinha resposta seis meses depois. É exatamente o que a
    //    §8 do access-revocation-design provou valer no nível de TENANT — e faltava aqui,
    //    que é o nível usado no dia a dia. Mesmo formato, de propósito.
    const nowIso = new Date().toISOString()
    const [trust, sess, toks] = await Promise.all([
      supabaseAdmin.from("auth_device_trust").update({ revoked_at: nowIso }).eq("user_id", userId).is("revoked_at", null).select("id"),
      supabaseAdmin.from("user_sessions").delete().eq("tenant_id", tenantId).eq("user_id", userId).select("id"),
      supabaseAdmin.from("device_tokens").update({ revoked_at: nowIso }).eq("tenant_id", tenantId).eq("user_id", userId).is("revoked_at", null).select("id"),
    ])
    revoked = {
      sessions:           sess.data?.length ?? 0,
      extension_tokens:   toks.data?.length ?? 0,
      push_subscriptions: push.data?.length ?? 0,
      device_trust:       trust.data?.length ?? 0,
      errors: [push.error, trust.error, sess.error, toks.error].filter(Boolean).map((e) => e!.message).join(" · ") || null,
    }
    if (revoked.errors) console.error("[team] cascata de desativação incompleta:", userId, revoked.errors)

    // 📧 E O E-MAIL — o único canal que continua chegando SEM login (achado 2026-08-03).
    //    `daily_report_emails` é lista de texto solto: se o endereço da pessoa foi digitado
    //    lá, desativá-la NÃO a tirava, e ela seguia recebendo o relatório do negócio
    //    (métricas, volume de atendimento) sem acesso ao sistema e sem ninguém perceber.
    //    Os outros destinatários (fallback de owners+admins e alerta de saúde) já filtravam
    //    `active=true`; a lista manual fazia curto-circuito antes de qualquer checagem.
    // ⚠️ Remove SÓ o endereço desta pessoa. A lista existe justamente pra aceitar quem NÃO
    //    é membro (contador, sócio que não usa o sistema) — esvaziá-la seria outro bug.
    await removeFromDailyReportRecipients(tenantId, userId)
  }

  await logAudit({
    tenantId,
    actorId:    session.user.id,
    actorEmail: session.user.email ?? null,
    action:     active ? "team.member.activate" : "team.member.deactivate",
    targetType: "tenant_user",
    targetId:   userId,
    metadata:   { role: target.role, revoked },
  })

  revalidatePath("/configuracoes/equipe")
  return {}
}

/**
 * Tira o e-mail de UM usuário da lista manual de destinatários do relatório diário.
 * Best-effort: falhar aqui não pode derrubar a desativação, que é a parte que importa —
 * mas grita no log, porque o resultado silencioso seria um ex-membro recebendo relatório.
 */
async function removeFromDailyReportRecipients(tenantId: string, userId: string): Promise<void> {
  try {
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("email").eq("id", userId).maybeSingle()
    const email = (prof as { email?: string } | null)?.email?.trim().toLowerCase()
    if (!email) return

    const { data: cfg } = await supabaseAdmin
      .from("tenant_config").select("daily_report_emails").eq("tenant_id", tenantId).maybeSingle()
    const list = ((cfg as { daily_report_emails?: string[] } | null)?.daily_report_emails ?? []) as string[]
    if (list.length === 0) return

    const kept = list.filter((e) => (e ?? "").trim().toLowerCase() !== email)
    if (kept.length === list.length) return   // não estava na lista — nada a fazer

    // 🔴 LISTA VAZIA NÃO É "NINGUÉM" — É O SINAL DE FALLBACK (achado do QA, 2026-08-03).
    //    `resolveRecipients` (reports/daily.ts) faz `if (customEmails.length > 0) return
    //    customEmails` e, com lista vazia, cai nos owners+admins ativos. Ou seja: remover a
    //    ÚNICA entrada não silenciava o relatório — **abria** ele pra todo mundo que o
    //    tenant tinha excluído ao configurar a lista. A correção anterior piorava o caso
    //    que ela existia pra resolver.
    //    Quando a pessoa removida era a única destinatária, a intenção do tenant ("só ela
    //    recebe") deixa de ser realizável: desligamos o relatório e deixamos a
    //    reconfiguração explícita pra quem administra. Silenciar é reversível; difundir não.
    const patch: Record<string, unknown> = { daily_report_emails: kept }
    if (kept.length === 0) {
      patch.daily_report_enabled = false
      console.warn(`[team] único destinatário do relatório diário removido — relatório DESLIGADO (tenant ${tenantId})`)
    }

    const { error } = await supabaseAdmin
      .from("tenant_config").update(patch).eq("tenant_id", tenantId)
    if (error) console.error("[team] falha ao remover e-mail do relatório diário:", tenantId, error.message)
  } catch (e) {
    console.error("[team] falha ao remover e-mail do relatório diário:", tenantId, (e as Error).message)
  }
}

// ── Envio do convite (WhatsApp / Email) ────────────────────────

const ROLE_LABEL_PT: Record<TenantRole, string> = {
  owner: "Owner",
  admin: "Admin",
  agent: "Atendente",
}

async function loadInviteContext(inviteId: string, tenantId: string) {
  const { data } = await supabaseAdmin
    .from("invites")
    .select("id, email, phone, role, token, expires_at, tenant_id")
    .eq("id", inviteId)
    .eq("tenant_id", tenantId)
    .is("accepted_at", null)
    .maybeSingle()

  if (!data) return null

  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .single()

  const baseUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? ""
  const inviteUrl = `${baseUrl.replace(/\/$/, "")}/invite/${data.token}`
  const expiresInDays = Math.max(0, Math.ceil(
    (new Date(data.expires_at).getTime() - Date.now()) / 86400000,
  ))

  return {
    invite:        data,
    tenantName:    tenant?.name ?? "Kora",
    inviteUrl,
    expiresInDays,
  }
}

export async function sendInviteViaWhatsApp(inviteId: string): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  // 🔒 Porta de envio, logo tem gate (achado do QA, 09/08). Esta action manda mensagem pelo
  //    número do tenant e só checava PAPEL — no degrau 3, enquanto a tela afirma
  //    "Atendimento pelo WhatsApp — pausado", o owner (que por política nunca perde a
  //    sessão) seguia emitindo por aqui. O texto é fixo e o destino é o telefone do
  //    convite, então o alcance é pequeno; o princípio é o mesmo das outras sete.
  if (atendimentoBloqueado(await checkTenantStatus(tenantId))) {
    return { error: "O acesso desta conta está pausado até a regularização do pagamento." }
  }

  const ctx = await loadInviteContext(inviteId, tenantId)
  if (!ctx) return { error: "Convite não encontrado ou já aceito" }

  if (!ctx.invite.phone) return { error: "Convite sem telefone. Edite o convite ou copie o link manualmente." }

  // Provider do tenant (default — 1ª instância; multi-instância: M2 dá a escolha)
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!instance) return { error: "WhatsApp não configurado no tenant" }
  if (instance.status !== "connected") {
    return { error: "WhatsApp não conectado. Conecte antes de enviar convite por aqui." }
  }

  // Mensagem
  const inviterName = session.user.name ?? "Alguém"
  const message =
    `Olá! Você foi convidado(a) pra entrar no *${ctx.tenantName}* no Kora ` +
    `como *${ROLE_LABEL_PT[ctx.invite.role as TenantRole]}*.\n\n` +
    `Convite gerado por ${inviterName}. Aceite no link abaixo ` +
    `(válido por ${ctx.expiresInDays} dias):\n\n${ctx.inviteUrl}\n\n` +
    `Se já tiver conta, é só clicar. Se não, você cria a senha em segundos.`

  try {
    const provider = getProvider(instance)
    await provider.sendText(ctx.invite.phone, message)
  } catch (err) {
    return { error: `Falha ao enviar pelo WhatsApp: ${(err as Error).message}` }
  }

  await supabaseAdmin
    .from("invites")
    .update({ sent_via_whatsapp_at: new Date().toISOString() })
    .eq("id", inviteId)

  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function sendInviteViaEmail(inviteId: string): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const ctx = await loadInviteContext(inviteId, tenantId)
  if (!ctx) return { error: "Convite não encontrado ou já aceito" }

  const { subject, html, text } = buildInviteEmail({
    inviteUrl:     ctx.inviteUrl,
    tenantName:    ctx.tenantName,
    roleLabel:     ROLE_LABEL_PT[ctx.invite.role as TenantRole],
    inviterName:   session.user.name,
    expiresInDays: ctx.expiresInDays,
  })

  const result = await sendEmail({
    to:           ctx.invite.email,
    subject,
    html,
    text,
    templateSlug: "invite",
    tenantId,
    metadata:     { invite_id: inviteId },
  })

  if (!result.ok) {
    if (!result.configured) {
      return { error: "Envio por email não configurado. Avise o admin do sistema (Kora) pra setar RESEND_API_KEY e EMAIL_FROM." }
    }
    return { error: result.error }
  }

  await supabaseAdmin
    .from("invites")
    .update({ sent_via_email_at: new Date().toISOString() })
    .eq("id", inviteId)

  revalidatePath("/configuracoes/equipe")
  return {}
}

// ── Departamentos ───────────────────────────────────────────────

export async function listDepartments(): Promise<Department[]> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data: depts, error } = await supabaseAdmin
    .from("tenant_departments")
    .select("id, name, color")
    .eq("tenant_id", tenantId)
    .order("name")

  if (error) throw new Error(error.message)

  // Conta usuários por departamento
  const { data: counts } = await supabaseAdmin
    .from("tenant_users")
    .select("department_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .not("department_id", "is", null)

  const countMap: Record<string, number> = {}
  for (const row of counts ?? []) {
    const did = row.department_id as string | null
    if (did) countMap[did] = (countMap[did] ?? 0) + 1
  }

  return (depts ?? []).map((d) => ({
    id:         d.id,
    name:       d.name,
    color:      d.color,
    user_count: countMap[d.id] ?? 0,
  }))
}

export async function createDepartment(name: string, color: string): Promise<{ error?: string; id?: string }> {
  const session = await requireTenantAdmin()
  const trimmed = name.trim()
  if (!trimmed) return { error: "Nome obrigatório" }

  const { data, error } = await supabaseAdmin
    .from("tenant_departments")
    .insert({ tenant_id: session.user.tenantId, name: trimmed, color })
    .select("id")
    .single()

  if (error) {
    if (error.message.includes("duplicate")) return { error: "Já existe um departamento com esse nome" }
    return { error: error.message }
  }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/departamentos")
  return { id: data.id }
}

export async function updateDepartment(id: string, input: { name?: string; color?: string }): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()

  const payload: Record<string, unknown> = {}
  if (input.name !== undefined)  payload.name = input.name.trim()
  if (input.color !== undefined) payload.color = input.color

  if (Object.keys(payload).length === 0) return {}

  const { error } = await supabaseAdmin
    .from("tenant_departments")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) {
    if (error.message.includes("duplicate")) return { error: "Já existe um departamento com esse nome" }
    return { error: error.message }
  }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/departamentos")
  return {}
}

export async function deleteDepartment(id: string): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()

  // FK em tenant_users.department_id usa ON DELETE SET NULL — usuários ficam sem departamento
  const { error } = await supabaseAdmin
    .from("tenant_departments")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/departamentos")
  return {}
}

// ── Unidades (etiqueta de venda — dimensão do CRM) ──────────────

/** Unidades ativas do tenant pros selects (ficha do membro / negócio). Auth-only
    (vendedor também escolhe unidade no negócio) — sem exigir admin. */
export async function listActiveUnits(): Promise<UnitOption[]> {
  const session = await auth()
  if (!session?.user?.tenantId) return []
  const { data } = await supabaseAdmin
    .from("tenant_units")
    .select("id, name, color")
    .eq("tenant_id", session.user.tenantId)
    .eq("active", true)
    .order("name")
  return (data ?? []) as UnitOption[]
}

export async function listUnits(): Promise<Unit[]> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data: units, error } = await supabaseAdmin
    .from("tenant_units")
    .select("id, name, color, active, logo_path, legal_name, tax_id, phone, email, zip_code, street, number, complement, district, city, state")
    .eq("tenant_id", tenantId)
    .order("name")

  if (error) throw new Error(error.message)

  // Contagens (membros + negócios carimbados) por unidade — coluna só, agrega em JS.
  const [{ data: userRows }, { data: dealRows }] = await Promise.all([
    supabaseAdmin.from("tenant_users").select("unit_id").eq("tenant_id", tenantId).not("unit_id", "is", null),
    supabaseAdmin.from("tenant_deals").select("unit_id").eq("tenant_id", tenantId).not("unit_id", "is", null),
  ])

  const userMap: Record<string, number> = {}
  for (const row of userRows ?? []) {
    const uid = row.unit_id as string | null
    if (uid) userMap[uid] = (userMap[uid] ?? 0) + 1
  }
  const dealMap: Record<string, number> = {}
  for (const row of dealRows ?? []) {
    const uid = row.unit_id as string | null
    if (uid) dealMap[uid] = (dealMap[uid] ?? 0) + 1
  }

  return (units ?? []).map((u) => ({
    id:         u.id,
    name:       u.name,
    color:      u.color,
    active:     u.active,
    user_count: userMap[u.id] ?? 0,
    deal_count: dealMap[u.id] ?? 0,
    logo_path:  u.logo_path ?? null,
    legal_name: u.legal_name ?? null,
    tax_id:     u.tax_id ?? null,
    phone:      u.phone ?? null,
    email:      u.email ?? null,
    zip_code:   u.zip_code ?? null,
    street:     u.street ?? null,
    number:     u.number ?? null,
    complement: u.complement ?? null,
    district:   u.district ?? null,
    city:       u.city ?? null,
    state:      u.state ?? null,
  }))
}

export async function createUnit(name: string, color: string, profile: UnitProfileInput = {}): Promise<{ error?: string; id?: string }> {
  const session = await requireTenantAdmin()
  const trimmed = name.trim()
  if (!trimmed) return { error: "Nome obrigatório" }

  const { data, error } = await supabaseAdmin
    .from("tenant_units")
    .insert({ tenant_id: session.user.tenantId, name: trimmed, color, ...normalizeUnitProfile(profile) })
    .select("id")
    .single()

  if (error) {
    if (error.message.includes("duplicate")) return { error: "Já existe uma unidade com esse nome" }
    return { error: error.message }
  }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/unidades")
  return { id: data.id }
}

export async function updateUnit(id: string, input: { name?: string; color?: string; active?: boolean } & UnitProfileInput): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()

  const payload: Record<string, unknown> = { ...normalizeUnitProfile(input) }
  if (input.name !== undefined)   payload.name = input.name.trim()
  if (input.color !== undefined)  payload.color = input.color
  if (input.active !== undefined) payload.active = input.active

  if (Object.keys(payload).length === 0) return {}

  const { error } = await supabaseAdmin
    .from("tenant_units")
    .update(payload)
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) {
    if (error.message.includes("duplicate")) return { error: "Já existe uma unidade com esse nome" }
    return { error: error.message }
  }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/unidades")
  return {}
}

export async function deleteUnit(id: string): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()

  // FK em tenant_users.unit_id e tenant_deals.unit_id usam ON DELETE SET NULL —
  // membros e negócios ficam "Sem unidade" (histórico não some, só perde a etiqueta).
  const { error } = await supabaseAdmin
    .from("tenant_units")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.user.tenantId)

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/unidades")
  return {}
}

// ── Logo da unidade (identidade visual em cotações/pedidos) ─────

const UNIT_LOGO_BUCKET = "chat-attachments"

/**
 * Sobe (ou troca) o logo da unidade. Anti-IDOR: valida que a unidade é DO tenant
 * do admin ANTES de tocar no storage. Espelha uploadMyAvatar (perfil).
 */
export async function uploadUnitLogo(unitId: string, formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data: unit } = await supabaseAdmin
    .from("tenant_units").select("id")
    .eq("id", unitId).eq("tenant_id", tenantId).maybeSingle()
  if (!unit) return { ok: false, error: "Unidade não encontrada" }

  const file = formData.get("file") as File | null
  if (!file || file.size === 0) return { ok: false, error: "Selecione uma imagem." }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return { ok: false, error: "Use uma imagem JPG, PNG ou WebP." }
  }
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "Imagem muito grande (máx. 2MB)." }

  const buffer = Buffer.from(await file.arrayBuffer())
  const path = `unit-logos/${tenantId}/${unitId}`
  const { error: upErr } = await supabaseAdmin.storage
    .from(UNIT_LOGO_BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: true })
  if (upErr) return { ok: false, error: upErr.message }

  await supabaseAdmin.from("tenant_units").update({ logo_path: path })
    .eq("id", unitId).eq("tenant_id", tenantId)

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/unidades")
  return { ok: true }
}

/** Remove o logo da unidade (storage + coluna). Anti-IDOR pelo tenant do admin. */
export async function removeUnitLogo(unitId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  const { data: unit } = await supabaseAdmin
    .from("tenant_units").select("id")
    .eq("id", unitId).eq("tenant_id", tenantId).maybeSingle()
  if (!unit) return { ok: false, error: "Unidade não encontrada" }

  await supabaseAdmin.storage
    .from(UNIT_LOGO_BUCKET).remove([`unit-logos/${tenantId}/${unitId}`]).catch(() => {})
  await supabaseAdmin.from("tenant_units").update({ logo_path: null })
    .eq("id", unitId).eq("tenant_id", tenantId)

  revalidatePath("/configuracoes/equipe")
  revalidatePath("/configuracoes/equipe/unidades")
  return { ok: true }
}
