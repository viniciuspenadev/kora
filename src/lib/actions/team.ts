"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { randomBytes } from "crypto"
import { getProvider } from "@/lib/providers"
import { sendEmail, buildInviteEmail } from "@/lib/email/send"
import { checkLimit } from "@/lib/limits"

export type TenantRole = "owner" | "admin" | "agent"

export interface TeamMember {
  user_id:       string
  email:         string
  full_name:     string | null
  role:          TenantRole
  active:        boolean
  view_all:      boolean
  department_id: string | null
  department:    { id: string; name: string; color: string } | null
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
      user_id, role, active, view_all, department_id, joined_at,
      profiles!tenant_users_user_id_fkey ( email, full_name ),
      tenant_departments ( id, name, color )
    `)
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("joined_at", { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { email: string; full_name: string | null } | null
    const dept    = row.tenant_departments as unknown as { id: string; name: string; color: string } | null
    return {
      user_id:       row.user_id,
      email:         profile?.email ?? "—",
      full_name:     profile?.full_name ?? null,
      role:          row.role as TenantRole,
      active:        row.active,
      view_all:      row.view_all,
      department_id: row.department_id,
      department:    dept,
      joined_at:     row.joined_at,
    }
  })
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

  // ⛔ Bloqueia se o tenant atingiu o limite de usuários (ativos + convites pendentes)
  const usage = await checkLimit(tenantId, "users")
  if (!usage.ok) {
    return {
      error: `Limite de usuários atingido (${usage.used}/${usage.max}). ` +
             `Solicite aumento ao administrador da plataforma antes de convidar mais.`,
    }
  }

  const email = input.email.trim().toLowerCase()
  if (!email || !email.includes("@")) return { error: "E-mail inválido" }
  if (!["owner", "admin", "agent"].includes(input.role)) return { error: "Papel inválido" }

  // Só owner pode criar outro owner (e há regra de 1 owner — confirmação)
  if (input.role === "owner") {
    if (session.user.role !== "owner") return { error: "Apenas o owner atual pode criar outro owner" }
    return { error: "Apenas 1 owner por tenant. Transfira a posse em vez de criar outro." }
  }

  // Já é membro ativo?
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle()

  if (existingProfile) {
    const { data: existingMember } = await supabaseAdmin
      .from("tenant_users")
      .select("id, active")
      .eq("tenant_id", tenantId)
      .eq("user_id", existingProfile.id)
      .maybeSingle()
    if (existingMember?.active) return { error: "Este e-mail já é membro ativo do tenant" }
  }

  // Convite pendente?
  const { data: pending } = await supabaseAdmin
    .from("invites")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (pending) return { error: "Já existe convite pendente pra esse e-mail" }

  const token = randomBytes(24).toString("hex")

  // Normaliza phone: digits only; se < 12 dígitos, assume Brasil e prepende 55
  let normalizedPhone: string | null = null
  if (input.phone) {
    const digits = input.phone.replace(/\D/g, "")
    if (digits.length >= 10) {
      normalizedPhone = digits.length < 12 ? `55${digits}` : digits
    }
  }

  // Valida departamento (se passado)
  let validDepartmentId: string | null = null
  if (input.department_id) {
    const { data: dept } = await supabaseAdmin
      .from("tenant_departments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", input.department_id)
      .maybeSingle()
    if (dept) validDepartmentId = input.department_id
  }

  const { data: created, error: insertErr } = await supabaseAdmin
    .from("invites")
    .insert({
      tenant_id:     tenantId,
      email,
      phone:         normalizedPhone,
      role:          input.role,
      token,
      invited_by:    session.user.id,
      department_id: validDepartmentId,
    })
    .select("id")
    .single()

  if (insertErr || !created) return { error: insertErr?.message ?? "Erro ao gerar convite" }

  revalidatePath("/configuracoes/equipe")
  return { token, inviteId: created.id }
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

  // Apenas owner pode promover/rebaixar
  if (role === "owner") {
    if (session.user.role !== "owner") return { error: "Apenas o owner pode promover outro owner" }
    return { error: "Apenas 1 owner por tenant. Use 'Transferir posse' em vez de promover." }
  }

  // Não permite rebaixar o owner (precisa transferir posse primeiro)
  const { data: target } = await supabaseAdmin
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single()

  if (target?.role === "owner") return { error: "Não é possível rebaixar o owner. Transfira a posse antes." }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ role })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function updateMemberDepartment(userId: string, departmentId: string | null): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
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

  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function toggleMemberViewAll(userId: string, viewAll: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ view_all: viewAll })
    .eq("tenant_id", session.user.tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/equipe")
  return {}
}

export async function setMemberActive(userId: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireTenantAdmin()
  const tenantId = session.user.tenantId

  // Não permite desativar o owner
  const { data: target } = await supabaseAdmin
    .from("tenant_users")
    .select("role, user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single()

  if (target?.role === "owner") return { error: "Não é possível desativar o owner" }
  if (target?.user_id === session.user.id) return { error: "Você não pode desativar a si mesmo" }

  const { error } = await supabaseAdmin
    .from("tenant_users")
    .update({ active })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)

  if (error) return { error: error.message }

  revalidatePath("/configuracoes/equipe")
  return {}
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

  const ctx = await loadInviteContext(inviteId, tenantId)
  if (!ctx) return { error: "Convite não encontrado ou já aceito" }

  if (!ctx.invite.phone) return { error: "Convite sem telefone. Edite o convite ou copie o link manualmente." }

  // Provider do tenant
  const { data: instance } = await supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", tenantId)
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
  return {}
}
