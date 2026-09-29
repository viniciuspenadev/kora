"use server"

import { auth } from "@/auth"
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { deliverOwnerInvite } from "@/lib/tenant-invitations"
import { revalidatePath } from "next/cache"

export async function resendOwnerInvite(tenantId: string): Promise<{ error?: string; sent?: boolean }> {
  const session = await auth()
  if (!session?.user.isPlatformAdmin) throw new Error("Acesso negado")
  const { data, error } = await supabaseAdmin.rpc("renovar_convite_cadastro_atomico", {
    p_tenant: tenantId, p_actor: session.user.id, p_token: randomBytes(24).toString("hex"),
  })
  if (error || typeof data !== "string") return { error: error?.message.includes("resend_throttled")
    ? "Aguarde um minuto entre envios." : "Confira se já existe um responsável ativo e se o plano possui vaga disponível." }
  const sent = await deliverOwnerInvite(tenantId, data)
  revalidatePath(`/admin/tenants/${tenantId}/cobranca`)
  return { sent }
}
