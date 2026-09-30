import "server-only"

import { supabaseAdmin } from "@/lib/supabase"

export type SeatRole = "owner" | "admin" | "agent"

interface AtomicInviteRow {
  invite_id: string
}

interface AtomicAcceptRow {
  tenant_id: string
  user_id: string
  email: string
  is_new_user: boolean
}

interface AtomicCreateUserRow {
  user_id: string
  is_new_user: boolean
}

interface AtomicActivationRow {
  changed: boolean
  member_role: SeatRole
}

export type SeatMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

function rpcErrorMessage(error: { message?: string | null }): string {
  const message = error.message ?? ""
  if (message.includes("seat_limit_reached")) return "Limite de usuários atingido. Aumente o teto de usuários e tente novamente."
  if (message.includes("invite_not_found")) return "Convite não encontrado."
  if (message.includes("invite_already_accepted")) return "Este convite já foi aceito."
  if (message.includes("invite_expired")) return "Este convite expirou."
  if (message.includes("pending_invite_exists")) return "Já existe convite pendente pra esse e-mail."
  if (message.includes("active_member_exists")) return "Este e-mail já é membro ativo do tenant."
  if (message.includes("member_exists")) return "Este e-mail já é membro deste tenant."
  if (message.includes("member_not_found")) return "Membro não encontrado."
  if (message.includes("invalid_department")) return "Departamento inválido para este tenant."
  if (message.includes("invalid_credentials")) return "Preencha nome e senha."
  if (message.includes("invalid_input")) return "Dados inválidos."
  if (message.includes("forbidden")) return "Acesso negado."
  return "Não foi possível atualizar os usuários. Tente novamente."
}

function oneRow<T>(data: unknown): T | null {
  if (!Array.isArray(data) || data.length !== 1) return null
  return data[0] as T
}

export async function createInviteWithAtomicSeat(input: {
  tenantId: string
  email: string
  phone: string | null
  role: SeatRole
  token: string
  invitedBy: string
  departmentId: string | null
}): Promise<SeatMutationResult<{ inviteId: string }>> {
  const { data, error } = await supabaseAdmin.rpc("criar_convite_com_assento_atomico", {
    p_tenant_id: input.tenantId,
    p_email: input.email,
    p_phone: input.phone,
    p_role: input.role,
    p_token: input.token,
    p_invited_by: input.invitedBy,
    p_department_id: input.departmentId,
  })
  if (error) return { ok: false, error: rpcErrorMessage(error) }
  const row = oneRow<AtomicInviteRow>(data)
  if (!row?.invite_id) return { ok: false, error: "Não foi possível gerar o convite." }
  return { ok: true, value: { inviteId: row.invite_id } }
}

export async function acceptInviteWithAtomicSeat(input: {
  token: string
  fullName: string | null
  passwordHash: string | null
}): Promise<SeatMutationResult<AtomicAcceptRow>> {
  const { data, error } = await supabaseAdmin.rpc("aceitar_convite_com_assento_atomico", {
    p_token: input.token,
    p_full_name: input.fullName,
    p_password_hash: input.passwordHash,
  })
  if (error) return { ok: false, error: rpcErrorMessage(error) }
  const row = oneRow<AtomicAcceptRow>(data)
  if (!row?.tenant_id || !row.user_id || !row.email) {
    return { ok: false, error: "Não foi possível aceitar o convite." }
  }
  return { ok: true, value: row }
}

export async function createTenantUserWithAtomicSeat(input: {
  tenantId: string
  fullName: string
  email: string
  passwordHash: string | null
  role: SeatRole
  actorId: string
}): Promise<SeatMutationResult<AtomicCreateUserRow>> {
  const { data, error } = await supabaseAdmin.rpc("criar_usuario_tenant_com_assento_atomico", {
    p_tenant_id: input.tenantId,
    p_full_name: input.fullName,
    p_email: input.email,
    p_password_hash: input.passwordHash,
    p_role: input.role,
    p_actor_id: input.actorId,
  })
  if (error) return { ok: false, error: rpcErrorMessage(error) }
  const row = oneRow<AtomicCreateUserRow>(data)
  if (!row?.user_id) return { ok: false, error: "Não foi possível criar o usuário." }
  return { ok: true, value: row }
}

export async function reactivateMemberWithAtomicSeat(input: {
  tenantId: string
  userId: string
  actorId: string
}): Promise<SeatMutationResult<AtomicActivationRow>> {
  const { data, error } = await supabaseAdmin.rpc("reativar_membro_com_assento_atomico", {
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_actor_id: input.actorId,
  })
  if (error) return { ok: false, error: rpcErrorMessage(error) }
  const row = oneRow<AtomicActivationRow>(data)
  if (!row?.member_role) return { ok: false, error: "Não foi possível reativar o membro." }
  return { ok: true, value: row }
}
