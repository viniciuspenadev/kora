"use server"

import { auth } from "@/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidatePath } from "next/cache"
import { createHash, randomBytes } from "crypto"
import { createInviteWithAtomicSeat } from "@/lib/user-seats"
import { provisionTenant } from "@/lib/tenant-provisioning"
import { deliverOwnerInvite } from "@/lib/tenant-invitations"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  return session
}

export async function createTenant(formData: FormData): Promise<{ error?: string; tenantId?: string; inviteSent?: boolean; canEdit?: boolean }> {
  const session = await requireAdmin()
  const field = (key: string) => { const value = formData.get(key); return typeof value === "string" ? value.trim() : "" }
  const requestId = field("request_id")
  const input = {
    name: field("name"), slug: field("slug").toLowerCase(), plan: field("plan_id"),
    mode: field("billing_mode"), access: field("access"), ownerName: field("owner_name"),
    email: field("owner_email").toLowerCase(), phone: field("owner_phone").replace(/\D/g, ""),
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuid.test(requestId) || !uuid.test(input.plan)) return { error: "Cadastro ou plano inválido. Reabra o formulário.", canEdit: true }
  if (input.name.length < 2 || input.name.length > 120 || input.ownerName.length < 2 || input.ownerName.length > 120) return { error: "Informe empresa e responsável (2 a 120 caracteres).", canEdit: true }
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(input.slug)) return { error: "Identificador inválido. Use 3 a 40 letras minúsculas, números e hífens.", canEdit: true }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || input.email.length > 254 || !/^[0-9]{10,13}$/.test(input.phone)) return { error: "Confira o e-mail e telefone do responsável.", canEdit: true }
  if (!['manual','gateway'].includes(input.mode) || (input.mode === 'manual' ? !['authorized','pending'].includes(input.access) : input.access !== 'plan')) return { error: "Modalidade ou condição de acesso inválida.", canEdit: true }
  const result = await provisionTenant("godmode", {
    p_request: requestId, p_actor: session.user.id,
    p_fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    p_name: input.name, p_slug: input.slug, p_plan: input.plan, p_mode: input.mode,
    p_access: input.access, p_owner_name: input.ownerName, p_email: input.email, p_phone: input.phone,
    p_token: randomBytes(24).toString("hex"),
  })
  if (!result.ok) return { error: result.error, canEdit: result.canEdit }
  const inviteSent = !!result.value.invite_id && await deliverOwnerInvite(result.value.tenant_id, result.value.invite_id)
  revalidatePath("/admin/tenants")
  return { tenantId: result.value.tenant_id, inviteSent }
}

export async function createInvite(formData: FormData): Promise<{ error?: string } | void> {
  const session = await requireAdmin()

  const tenantId = formData.get("tenant_id") as string
  const email    = (formData.get("email") as string)?.trim().toLowerCase()
  const role     = (formData.get("role") as string) || "agent"

  if (!tenantId || !email) return { error: "Selecione tenant e informe email" }
  if (!["owner", "admin", "agent"].includes(role)) return { error: "Papel inválido" }

  const token = randomBytes(24).toString("hex")

  const created = await createInviteWithAtomicSeat({
    tenantId,
    email,
    phone: null,
    role: role as "owner" | "admin" | "agent",
    token,
    invitedBy: session.user.id,
    departmentId: null,
  })
  if (!created.ok) return { error: created.error }

  revalidatePath("/admin/invites")
}

export async function deleteInvite(inviteId: string): Promise<void> {
  await requireAdmin()
  await supabaseAdmin.from("invites").delete().eq("id", inviteId)
  revalidatePath("/admin/invites")
}
